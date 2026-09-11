import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEndpointsService } from '../webhooks/webhooks.service';
import { TxnStatusService, mapProviderStatus } from '../webhooks/txn-status.service';
import { COLLECTION_PROVIDER } from '../providers/provider.types';
import { CollectionProvider } from '../providers/provider.types';
import { buildReference } from '../common/utils/reference.util';
import { ErrorCodes } from '../common/constants';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';

/**
 * Wallet deposits processed exactly like collections (requirement #2):
 * preview/initiate a USSD push to the payer, ClickPesa authorises the
 * amount (webhook or cron poll), and the value is credited to the
 * DISBURSEMENT wallet — never the collection wallet.
 */
@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly webhooks: WebhookEndpointsService,
    private readonly txnStatus: TxnStatusService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
    @Inject(COLLECTION_PROVIDER) private readonly provider: CollectionProvider,
  ) {}

  /** Optional pre-check that mirrors the collection USSD push preview. */
  async preview(accountId: string, dto: { amount: string; currency?: string; phoneNumber: string; reference?: string }, traceId?: string) {
    return this.tracing.traceCall('deposit.preview', 'deposits', async (span) => {
      span.event('preview-request', { amount: dto.amount, phone: dto.phoneNumber });
      const result = await this.provider.previewUssdPush({
        amount: dto.amount,
        currency: dto.currency ?? 'TZS',
        orderReference: buildReference(await this.sourceCode(accountId), dto.reference),
        phoneNumber: dto.phoneNumber,
      });
      span.event('preview-result', { ok: result.ok });
      if (!result.ok) throw new ForbiddenException({ code: ErrorCodes.PROVIDER_ERROR, message: result.error ?? 'Preview failed' });
      return result.data;
    });
  }

  /** Initiates the USSD push that funds the DISBURSEMENT wallet on authorisation. */
  async initiate(accountId: string, dto: { amount: string; currency?: string; phoneNumber: string; reference?: string }, traceId?: string) {
    return this.tracing.traceCall('deposit.initiate', 'deposits', async (span) => {
      const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { sourceCode: true, id: true } });
      if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
      const wallet = await this.prisma.wallet.findUnique({ where: { accountId_type: { accountId, type: 'DISBURSEMENT' } } });
      if (!wallet) throw new NotFoundException({ code: ErrorCodes.WALLET_NOT_FOUND, message: 'DISBURSEMENT wallet not found' });

      let reference: string;
      try {
        reference = buildReference(account.sourceCode, dto.reference);
      } catch {
        throw new ForbiddenException({ code: ErrorCodes.INVALID_REFERENCE, message: 'Client reference must be 1-15 alphanumeric characters' });
      }

      // idempotency: reject a repeated client reference for the same account
      if (dto.reference) {
        const dupe = await this.prisma.deposit.findFirst({
          where: { accountId, clientReference: dto.reference.toUpperCase() },
          select: { id: true },
        });
        if (dupe) throw new ConflictException({ code: ErrorCodes.DUPLICATE_REFERENCE, message: 'A deposit with this client reference already exists' });
      }

      const amount = dto.amount;
      const currency = dto.currency ?? 'TZS';
      span.event('initiate-request', { reference, amount, currency });

      const result = await this.provider.initiateUssdPush({
        amount,
        currency,
        orderReference: reference,
        phoneNumber: dto.phoneNumber,
      });

      const deposit = await this.prisma.deposit.create({
        data: {
          accountId,
          walletId: wallet.id,
          reference,
          clientReference: dto.reference?.toUpperCase(),
          channel: 'MOBILE_MONEY',
          provider: this.provider.name,
          amount: new Prisma.Decimal(amount),
          currency,
          phoneNumber: dto.phoneNumber,
          status: result.ok ? mapProviderStatus(result.data?.status) : TxStatus.PENDING,
          providerTxId: result.data?.id,
          providerStatus: result.data?.status,
          rawRequest: { amount, currency, orderReference: reference, phoneNumber: dto.phoneNumber, targetWallet: 'DISBURSEMENT' } as Prisma.InputJsonValue,
          rawResponse: (result.data ?? { error: result.error }) as Prisma.InputJsonValue,
          traceId: traceId ?? this.tracing.currentTraceId(),
        },
      });

      if (!result.ok) {
        span.event('provider-error', { error: result.error });
        this.logger.error('deposit initiation failed at provider', { module: 'deposits', reference, error: result.error });
        await this.prisma.deposit.update({
          where: { id: deposit.id },
          data: { status: TxStatus.FAILED, failureReason: result.error ?? 'provider error', message: result.error },
        });
        throw new ForbiddenException({ code: ErrorCodes.PROVIDER_ERROR, message: result.error ?? 'Provider rejected the deposit request' });
      }

      this.analytics.track('deposit.initiated', { accountId, value: Number(amount), traceId: deposit.traceId ?? undefined, dimensions: { targetWallet: 'DISBURSEMENT' } });
      return deposit;
    });
  }

  async get(accountId: string, reference: string) {
    const deposit = await this.prisma.deposit.findFirst({ where: { reference, accountId } });
    if (!deposit) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: `Deposit ${reference} not found` });
    return deposit;
  }

  async list(accountId: string, params: { skip: number; take: number; status?: string }) {
    const where: Prisma.DepositWhereInput = {
      accountId,
      ...(params.status ? { status: params.status.toUpperCase() as TxStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.deposit.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.deposit.count({ where }),
    ]);
    return { items, total };
  }

  /** Manual status refresh (client-initiated). */
  async refreshStatus(accountId: string, reference: string) {
    const deposit = await this.get(accountId, reference);
    if (([TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED] as TxStatus[]).includes(deposit.status)) {
      return deposit;
    }
    const result = await this.provider.queryPayment(deposit.reference);
    if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
      await this.txnStatus.applyDepositUpdate(deposit.reference, result.data[0], 'poll');
      return this.get(accountId, reference);
    }
    return deposit;
  }

  /** Cron: poll pending deposits whose webhook may never arrive. */
  async pollPending(): Promise<number> {
    const afterMs = this.config.get('statusPoll.afterMs', 45_000);
    const batchSize = this.config.get('statusPoll.batchSize', 50);
    const cutoff = new Date(Date.now() - afterMs);
    const pending = await this.prisma.deposit.findMany({
      where: { status: { in: [TxStatus.PENDING, TxStatus.PROCESSING] }, createdAt: { lte: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { reference: true },
    });
    let updated = 0;
    for (const { reference } of pending) {
      const deposit = await this.prisma.deposit.findUnique({ where: { reference } });
      if (!deposit) continue;
      const result = await this.provider.queryPayment(reference);
      if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
        const before = deposit.status;
        await this.txnStatus.applyDepositUpdate(reference, result.data[0], 'poll');
        if (before !== deposit.status) updated++;
      }
    }
    if (pending.length > 0) {
      this.logger.info('deposit status poll complete', { module: 'deposits', polled: pending.length, updated });
    }
    return pending.length;
  }

  private async sourceCode(accountId: string): Promise<string> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { sourceCode: true } });
    if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    return account.sourceCode;
  }
}
