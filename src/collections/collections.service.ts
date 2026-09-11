import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { WebhookEndpointsService } from '../webhooks/webhooks.service';
import { TxnStatusService, mapProviderStatus } from '../webhooks/txn-status.service';
import { COLLECTION_PROVIDER } from '../providers/provider.types';
import { CollectionProvider } from '../providers/provider.types';
import { buildReference } from '../common/utils/reference.util';
import { ErrorCodes } from '../common/constants';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';
import { ConfigService } from '@nestjs/config';

/**
 * Money collection via ClickPesa USSD push (mobile money).
 * Flow: preview (optional) -> initiate -> provider webhook/poll -> wallet credit.
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly wallets: WalletsService,
    private readonly webhooks: WebhookEndpointsService,
    private readonly txnStatus: TxnStatusService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
    @Inject(COLLECTION_PROVIDER) private readonly provider: CollectionProvider,
  ) {}

  async preview(accountId: string, dto: { amount: string; currency?: string; phoneNumber: string; fetchSenderDetails?: boolean; reference?: string }, traceId?: string) {
    return this.tracing.traceCall('collection.preview', 'collections', async (span) => {
      span.event('preview-request', { amount: dto.amount, phone: dto.phoneNumber });
      const result = await this.provider.previewUssdPush({
        amount: dto.amount,
        currency: dto.currency ?? 'TZS',
        orderReference: buildReference(await this.sourceCode(accountId), dto.reference),
        phoneNumber: dto.phoneNumber,
        fetchSenderDetails: dto.fetchSenderDetails,
      });
      span.event('preview-result', { ok: result.ok });
      if (!result.ok) throw new ForbiddenException({ code: ErrorCodes.PROVIDER_ERROR, message: result.error ?? 'Preview failed' });
      return result.data;
    });
  }

  async initiate(accountId: string, dto: { amount: string; currency?: string; phoneNumber: string; reference?: string }, traceId?: string) {
    return this.tracing.traceCall('collection.initiate', 'collections', async (span) => {
      const sourceCode = await this.sourceCode(accountId);
      let reference: string;
      try {
        reference = buildReference(sourceCode, dto.reference);
      } catch {
        throw new ForbiddenException({ code: ErrorCodes.INVALID_REFERENCE, message: 'Client reference must be 1-15 alphanumeric characters' });
      }

      // idempotency: reject a repeated client reference for the same account
      if (dto.reference) {
        const dupe = await this.prisma.collection.findFirst({
          where: { accountId, clientReference: dto.reference.toUpperCase() },
          select: { id: true },
        });
        if (dupe) throw new ConflictException({ code: ErrorCodes.DUPLICATE_REFERENCE, message: 'A collection with this client reference already exists' });
      }

      const amount = dto.amount;
      const currency = dto.currency ?? 'TZS';
      const orderRef = buildReference(sourceCode, dto.reference);
      span.event('initiate-request', { reference: orderRef, amount, currency });

      const result = await this.provider.initiateUssdPush({
        amount,
        currency,
        orderReference: orderRef,
        phoneNumber: dto.phoneNumber,
      });

      const collection = await this.prisma.collection.create({
        data: {
          accountId,
          reference: orderRef,
          clientReference: dto.reference?.toUpperCase(),
          channel: 'MOBILE_MONEY',
          provider: this.provider.name,
          amount: new Prisma.Decimal(amount),
          currency,
          phoneNumber: dto.phoneNumber,
          status: result.ok ? mapProviderStatus(result.data?.status) : TxStatus.PENDING,
          providerTxId: result.data?.id,
          providerStatus: result.data?.status,
          rawRequest: { amount, currency, orderReference: orderRef, phoneNumber: dto.phoneNumber } as Prisma.InputJsonValue,
          rawResponse: (result.data ?? { error: result.error }) as Prisma.InputJsonValue,
          traceId: traceId ?? this.tracing.currentTraceId(),
        },
      });

      if (!result.ok) {
        span.event('provider-error', { error: result.error });
        this.logger.error('collection initiation failed at provider', { module: 'collections', reference: orderRef, error: result.error });
        await this.prisma.collection.update({
          where: { id: collection.id },
          data: { status: TxStatus.FAILED, failureReason: result.error ?? 'provider error', message: result.error },
        });
        throw new ForbiddenException({ code: ErrorCodes.PROVIDER_ERROR, message: result.error ?? 'Provider rejected the collection request' });
      }

      this.analytics.track('collection.initiated', { accountId, value: Number(amount), traceId: collection.traceId ?? undefined, dimensions: { channel: 'MOBILE_MONEY' } });
      return collection;
    });
  }

  async get(accountId: string, reference: string) {
    const collection = await this.prisma.collection.findFirst({ where: { reference, accountId } });
    if (!collection) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: `Collection ${reference} not found` });
    return collection;
  }

  async list(accountId: string, params: { skip: number; take: number; status?: string }) {
    const where: Prisma.CollectionWhereInput = {
      accountId,
      ...(params.status ? { status: params.status.toUpperCase() as TxStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.collection.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.collection.count({ where }),
    ]);
    return { items, total };
  }

  /** Manual status refresh (client-initiated). */
  async refreshStatus(accountId: string, reference: string) {
    const collection = await this.get(accountId, reference);
    if (([TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED] as TxStatus[]).includes(collection.status)) {
      return collection;
    }
    const result = await this.provider.queryPayment(collection.reference);
    if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
      await this.txnStatus.applyCollectionUpdate(collection.reference, result.data[0], 'poll');
      return this.get(accountId, reference);
    }
    return collection;
  }

  /** Cron: poll pending collections whose webhook may never arrive. */
  async pollPending(): Promise<number> {
    const afterMs = this.config.get('statusPoll.afterMs', 45000);
    const batchSize = this.config.get('statusPoll.batchSize', 50);
    const cutoff = new Date(Date.now() - afterMs);
    const pending = await this.prisma.collection.findMany({
      where: { status: { in: [TxStatus.PENDING, TxStatus.PROCESSING] }, createdAt: { lte: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { reference: true },
    });
    let updated = 0;
    for (const { reference } of pending) {
      const collection = await this.prisma.collection.findUnique({ where: { reference } });
      if (!collection) continue;
      const result = await this.provider.queryPayment(reference);
      if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
        const before = collection.status;
        await this.txnStatus.applyCollectionUpdate(reference, result.data[0], 'poll');
        if (before !== collection.status) updated++;
      }
    }
    if (pending.length > 0) {
      this.logger.info('collection status poll complete', { module: 'collections', polled: pending.length, updated });
    }
    return pending.length;
  }

  private async sourceCode(accountId: string): Promise<string> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { sourceCode: true } });
    if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    return account.sourceCode;
  }
}
