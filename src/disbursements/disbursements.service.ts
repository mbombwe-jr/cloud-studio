import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PayoutChannel, TxStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { TxnStatusService } from '../webhooks/txn-status.service';
import { FeesService } from '../fees/fees.service';
import { PAYOUT_PROVIDER } from '../providers/provider.types';
import { PayoutProvider } from '../providers/provider.types';
import { buildReference } from '../common/utils/reference.util';
import { ErrorCodes } from '../common/constants';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiQueueService } from '../iii/queue.service';
import { IiiTracingService } from '../iii/tracing.service';
import { normalizePhoneNumber, detectMobileOperator } from '../common/utils/phone.util';

/**
 * Money disbursement (mobile money + bank) via ClickPesa, single & batch.
 *
 * Money-safety model:
 *  - single payout: the DISBURSEMENT wallet is debited atomically at request
 *    time (PAYOUT_DEBIT); provider failures refund automatically;
 *  - batch: the full total is held at creation (BATCH_HOLD) and every failed
 *    item is refunded to the wallet (REFUND) as the queue processes items.
 */
@Injectable()
export class DisbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly wallets: WalletsService,
    private readonly txnStatus: TxnStatusService,
    private readonly fees: FeesService,
    private readonly analytics: IiiAnalyticsService,
    private readonly queue: IiiQueueService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  // ------------------------------- Single -------------------------------

  /**
   * Mobile money payout preview (requirement #7) — mirrors the collection
   * USSD push preview: validates the destination, detects the operator from
   * the phone prefix, computes the exact platform fee and returns the
   * provider's active-method list when the provider supports a payout
   * preview. Nothing is executed and no wallet is debited.
   */
  async previewMobileMoneyPayout(
    accountId: string,
    dto: { amount: string; currency?: string; phoneNumber: string },
    traceId?: string,
  ) {
    return this.tracing.traceCall('payout.preview-mobile-money', 'disbursements', async (span) => {
      const phone = normalizePhoneNumber(dto.phoneNumber ?? '');
      if (!phone) {
        throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'A valid Tanzanian phoneNumber is required (07XXXXXXXX / 2557XXXXXXXX)' });
      }
      const amount = new Prisma.Decimal(dto.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Amount must be greater than zero' });
      }

      const fee = await this.fees.computeFee('DISBURSEMENT', accountId, amount);
      const operator = detectMobileOperator(phone);
      span.event('preview-computed', { operator, fee: fee.feeAmount, feeBps: fee.feeBps });

      // Provider-level preview is best-effort: when the provider exposes a
      // payout preview endpoint we merge its active methods; on any provider
      // gap we degrade gracefully to the locally computed preview.
      let providerPreview: { activeMethods?: Array<{ name: string; status: string; fee?: number; message?: unknown }>; error?: string } | null = null;
      const providerResult = await this.provider.previewMnoPayout?.({
        amount: Number(amount),
        currency: 'TZS',
        orderReference: 'PREVIEW-ONLY',
        phoneNumber: phone,
      });
      if (providerResult?.ok && providerResult.data) {
        providerPreview = providerResult.data;
        span.event('provider-preview-ok', {});
      } else {
        providerPreview = { error: providerResult?.error ?? 'provider preview unavailable' };
        span.event('provider-preview-degraded', { error: providerResult?.error });
      }

      return {
        channel: 'MOBILE_MONEY',
        phoneNumber: phone,
        operator,
        amount: amount.toFixed(2),
        currency: dto.currency ?? 'TZS',
        fee: {
          amount: fee.feeAmount,
          bps: fee.feeBps,
          tier: fee.thresholdApplied,
        },
        totalDebit: amount.plus(fee.feeAmount).toFixed(2),
        beneficiaryReceives: amount.toFixed(2),
        activeMethods:
          providerPreview?.activeMethods ??
          (operator
            ? [{ name: operator, status: 'AVAILABLE', fee: 0, message: '' }]
            : [{ name: 'MOBILE MONEY', status: 'AVAILABLE', fee: 0, message: '' }]),
        providerPreviewError: providerPreview && !providerPreview.activeMethods ? providerPreview.error : undefined,
        executed: false,
      };
    });
  }

  async createPayout(
    accountId: string,
    channel: PayoutChannel,
    dto: { amount: string; reference?: string; phoneNumber?: string; accountNumber?: string; accountName?: string; bic?: string; transferType?: string },
    traceId?: string,
  ) {
    return this.tracing.traceCall('payout.create', 'disbursements', async (span) => {
      const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { sourceCode: true, id: true } });
      if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });

      let reference: string;
      try {
        reference = buildReference(account.sourceCode, dto.reference);
      } catch {
        throw new BadRequestException({ code: ErrorCodes.INVALID_REFERENCE, message: 'Client reference must be 1-15 alphanumeric characters' });
      }

      if (dto.reference) {
        const dupe = await this.prisma.payout.findFirst({ where: { accountId, clientReference: dto.reference.toUpperCase() }, select: { id: true } });
        if (dupe) throw new ConflictException({ code: ErrorCodes.DUPLICATE_REFERENCE, message: 'A payout with this client reference already exists' });
      }

      const payload: Record<string, unknown> = {
        channel,
        reference,
        clientReference: dto.reference?.toUpperCase(),
        amount: new Prisma.Decimal(dto.amount),
        currency: 'TZS',
      };
      if (channel === PayoutChannel.MOBILE_MONEY) {
        payload.phoneNumber = dto.phoneNumber;
      } else {
        payload.accountNumber = dto.accountNumber;
        payload.accountName = dto.accountName;
        payload.bic = dto.bic;
        payload.transferType = dto.transferType;
      }

      // Platform fee (requirement #3): the DISBURSEMENT wallet is debited
      // amount + fee; failed payouts refund the same total.
      const fee = await this.fees.computeFee('DISBURSEMENT', accountId, dto.amount);
      const totalDebit = new Prisma.Decimal(dto.amount).plus(fee.feeAmount);

      // atomic debit — throws INSUFFICIENT_FUNDS / WALLET_FROZEN on violation
      await this.wallets.move({
        accountId,
        type: 'DISBURSEMENT',
        txType: 'PAYOUT_DEBIT',
        amount: totalDebit.toFixed(2),
        description: `Payout held (${reference}, fee ${fee.feeAmount} TZS @ ${fee.feeBps} bps)`,
        reference,
        actorType: 'API_KEY',
        actorId: accountId,
        traceId: traceId ?? this.tracing.currentTraceId(),
        metadata: { channel, status: 'held at request time', feeAmount: fee.feeAmount, feeBps: fee.feeBps },
      });

      const payout = await this.prisma.payout.create({
        data: {
          accountId,
          channel,
          reference,
          clientReference: dto.reference?.toUpperCase(),
          sourceWallet: 'DISBURSEMENT',
          payoutKind: 'CUSTOMER',
          amount: new Prisma.Decimal(dto.amount),
          currency: 'TZS',
          feeAmount: new Prisma.Decimal(fee.feeAmount),
          feeBps: fee.feeBps,
          phoneNumber: channel === PayoutChannel.MOBILE_MONEY ? normalizePhoneNumber(dto.phoneNumber ?? '') ?? dto.phoneNumber : null,
          accountNumber: channel === PayoutChannel.BANK ? dto.accountNumber : null,
          accountName: channel === PayoutChannel.BANK ? dto.accountName : null,
          bic: channel === PayoutChannel.BANK ? dto.bic : null,
          transferType: channel === PayoutChannel.BANK ? dto.transferType : null,
          status: TxStatus.PENDING,
          walletDebitedAt: new Date(),
          rawRequest: payload as Prisma.InputJsonValue,
          traceId: traceId ?? this.tracing.currentTraceId(),
        },
      });

      await this.queue.enqueue('payout.process', { payoutId: payout.id, traceId: payout.traceId });
      span.event('payout-queued', { reference, fee: fee.feeAmount, feeBps: fee.feeBps });
      this.analytics.track('payout.initiated', { accountId, value: Number(dto.amount), traceId: payout.traceId ?? undefined, dimensions: { channel, feeBps: String(fee.feeBps) } });

      return payout;
    });
  }

  /** Queue handler — calls the provider (respecting the 60s provider limit). */
  async processPayoutJob(payload: { payoutId: string }): Promise<void> {
    const payout = await this.prisma.payout.findUnique({ where: { id: payload.payoutId } });
    if (!payout || payout.status !== TxStatus.PENDING) return;

    const spacingMs = this.config.get('mockProviders') ? 0 : this.config.get('clickpesa.payoutMinIntervalMs', 61000);
    const result = await this.tracing.traceCall('payout.provider-create', 'clickpesa', async (span) => {
      span.event('provider-request', { reference: payout.reference, channel: payout.channel, amount: String(payout.amount) });
      if (spacingMs > 0) await new Promise((r) => setTimeout(r, spacingMs));
      if (payout.channel === PayoutChannel.MOBILE_MONEY) {
        return this.provider.createMobileMoneyPayout({
          amount: Number(payout.amount),
          currency: 'TZS',
          orderReference: payout.reference,
          phoneNumber: payout.phoneNumber!,
        });
      }
      return this.provider.createBankPayout({
        amount: Number(payout.amount),
        accountNumber: payout.accountNumber!,
        accountName: payout.accountName!,
        orderReference: payout.reference,
        bic: payout.bic!,
        accountCurrency: 'TZS',
        currency: 'TZS',
        transferType: (payout.transferType as 'ACH' | 'RTGS') ?? undefined,
      });
    });

    if (result.ok && result.data) {
      await this.txnStatus.applyPayoutUpdate(payout.reference, { ...result.data, status: result.data.status ?? 'PENDING' }, 'webhook');
    } else {
      // provider rejected the request -> mark failed + refund via status engine
      await this.txnStatus.applyPayoutUpdate(payout.reference, { status: 'FAILED', message: result.error }, 'webhook');
      this.logger.error('payout failed at provider', { module: 'disbursements', reference: payout.reference, error: result.error });
    }
  }

  // ------------------------------- Batch --------------------------------

  async createBatch(
    accountId: string,
    dto: { name: string; items: Array<{ channel: PayoutChannel; amount: string; reference?: string; phoneNumber?: string; accountNumber?: string; accountName?: string; bic?: string; transferType?: string }>; metadata?: Record<string, unknown> },
    traceId?: string,
  ) {
    return this.tracing.traceCall('batch.create', 'disbursements', async (span) => {
      const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { sourceCode: true } });
      if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });

      // validate items per channel
      for (const [i, item] of dto.items.entries()) {
        if (item.channel === PayoutChannel.MOBILE_MONEY && !item.phoneNumber) {
          throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: `items[${i}]: phoneNumber is required for MOBILE_MONEY` });
        }
        if (item.channel === PayoutChannel.BANK && (!item.accountNumber || !item.accountName || !item.bic)) {
          throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: `items[${i}]: accountNumber, accountName and bic are required for BANK` });
        }
      }

      const total = dto.items.reduce((sum, i) => sum.plus(i.amount), new Prisma.Decimal(0));
      const reference = buildReference(account.sourceCode);

      // hold the whole batch amount atomically
      await this.wallets.move({
        accountId,
        type: 'DISBURSEMENT',
        txType: 'BATCH_HOLD',
        amount: total.toFixed(2),
        description: `Batch hold (${dto.name})`,
        reference,
        actorType: 'API_KEY',
        actorId: accountId,
        traceId: traceId ?? this.tracing.currentTraceId(),
        metadata: { items: dto.items.length },
      });

      const batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.disbursementBatch.create({
          data: {
            accountId,
            name: dto.name.trim(),
            reference,
            status: 'PROCESSING',
            totalCount: dto.items.length,
            totalAmount: total,
            metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue,
            traceId: traceId ?? this.tracing.currentTraceId(),
          },
        });
        const rows = dto.items.map((item) => ({
          accountId,
          batchId: created.id,
          channel: item.channel,
          reference: buildReference(account.sourceCode, item.reference ?? undefined),
          clientReference: item.reference?.toUpperCase() ?? null,
          amount: new Prisma.Decimal(item.amount),
          currency: 'TZS',
          phoneNumber: item.channel === PayoutChannel.MOBILE_MONEY ? normalizePhoneNumber(item.phoneNumber ?? '') ?? item.phoneNumber ?? null : null,
          accountNumber: item.channel === PayoutChannel.BANK ? item.accountNumber ?? null : null,
          accountName: item.channel === PayoutChannel.BANK ? item.accountName ?? null : null,
          bic: item.channel === PayoutChannel.BANK ? item.bic ?? null : null,
          transferType: item.channel === PayoutChannel.BANK ? item.transferType ?? null : null,
          status: TxStatus.PENDING,
          walletDebitedAt: new Date(),
          traceId: traceId ?? this.tracing.currentTraceId(),
        }));
        await tx.payout.createMany({ data: rows });
        return created;
      });

      // process the batch through the queue (items sequential, provider-spaced)
      const items = await this.prisma.payout.findMany({ where: { batchId: batch.id }, select: { id: true }, orderBy: { createdAt: 'asc' } });
      await this.queue.enqueue('batch.process', { batchId: batch.id, payoutIds: items.map((i) => i.id), traceId: batch.traceId });

      span.event('batch-queued', { reference, items: dto.items.length, total: total.toFixed(2) });
      this.analytics.track('batch.created', { accountId, value: Number(total), traceId: batch.traceId ?? undefined, dimensions: { items: dto.items.length } });
      return batch;
    });
  }

  /** Queue handler: processes batch items sequentially with provider spacing. */
  async processBatchJob(payload: { batchId: string; payoutIds: string[] }): Promise<void> {
    const spacingMs = this.config.get('mockProviders') ? 0 : this.config.get('clickpesa.payoutMinIntervalMs', 61000);
    for (const payoutId of payload.payoutIds) {
      const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (!payout || payout.status !== TxStatus.PENDING) continue;
      const result =
        payout.channel === PayoutChannel.MOBILE_MONEY
          ? await this.provider.createMobileMoneyPayout({
              amount: Number(payout.amount),
              currency: 'TZS',
              orderReference: payout.reference,
              phoneNumber: payout.phoneNumber!,
            })
          : await this.provider.createBankPayout({
              amount: Number(payout.amount),
              accountNumber: payout.accountNumber!,
              accountName: payout.accountName!,
              orderReference: payout.reference,
              bic: payout.bic!,
              accountCurrency: 'TZS',
              currency: 'TZS',
            });
      if (result.ok && result.data) {
        await this.txnStatus.applyPayoutUpdate(payout.reference, { ...result.data }, 'webhook');
      } else {
        await this.txnStatus.applyPayoutUpdate(payout.reference, { status: 'FAILED', message: result.error }, 'webhook');
      }
      if (spacingMs > 0) await new Promise((r) => setTimeout(r, spacingMs));
    }
  }

  // ------------------------------- Queries -------------------------------

  async getPayout(accountId: string, reference: string) {
    const payout = await this.prisma.payout.findFirst({ where: { reference, accountId }, include: { batch: { select: { reference: true, name: true } } } });
    if (!payout) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: `Payout ${reference} not found` });
    return payout;
  }

  async listPayouts(accountId: string, params: { skip: number; take: number; status?: string; batchId?: string }) {
    const where: Prisma.PayoutWhereInput = {
      accountId,
      ...(params.status ? { status: params.status.toUpperCase() as TxStatus } : {}),
      ...(params.batchId ? { batchId: params.batchId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.payout.count({ where }),
    ]);
    return { items, total };
  }

  async getBatch(accountId: string, reference: string) {
    const batch = await this.prisma.disbursementBatch.findFirst({ where: { reference, accountId } });
    if (!batch) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: `Batch ${reference} not found` });
    const payouts = await this.prisma.payout.findMany({ where: { batchId: batch.id }, orderBy: { createdAt: 'asc' } });
    return { ...batch, payouts };
  }

  async listBatches(accountId: string, params: { skip: number; take: number }) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.disbursementBatch.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.disbursementBatch.count({ where: { accountId } }),
    ]);
    return { items, total };
  }

  /** Cron: poll pending payouts (missed webhooks). */
  async pollPending(): Promise<void> {
    const afterMs = this.config.get('statusPoll.afterMs', 45000);
    const batchSize = this.config.get('statusPoll.batchSize', 50);
    const cutoff = new Date(Date.now() - afterMs);
    const pending = await this.prisma.payout.findMany({
      where: { status: { in: [TxStatus.PENDING, TxStatus.PROCESSING] }, createdAt: { lte: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { reference: true },
    });
    for (const { reference } of pending) {
      const result = await this.provider.queryPayout(reference);
      if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
        await this.txnStatus.applyPayoutUpdate(reference, result.data[0], 'poll');
      }
    }
    if (pending.length > 0) this.logger.info('payout status poll complete', { module: 'disbursements', polled: pending.length });
  }
}
