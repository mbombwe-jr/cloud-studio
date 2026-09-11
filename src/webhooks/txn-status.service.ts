import { Injectable } from '@nestjs/common';
import { Prisma, TxStatus, WebhookEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { WebhookEndpointsService } from './webhooks.service';
import { FeesService } from '../fees/fees.service';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';

/**
 * Maps provider payment/payout statuses to internal TxStatus values.
 * Accepts the full ClickPesa status vocabulary (SUCCESSFUL, COMPLETED, ...)
 * as well as the short internal forms (SUCCESS, FAILED).
 */
export function mapProviderStatus(status?: string | null): TxStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESS':
    case 'SUCCESSFUL':
    case 'SETTLED':
    case 'COMPLETED':
    case 'PAID':
    case 'ACCEPTED':
      return TxStatus.SUCCESS;
    case 'PROCESSING':
    case 'IN_PROGRESS':
    case 'ONGOING':
      return TxStatus.PROCESSING;
    case 'FAILED':
    case 'REJECTED':
    case 'CANCELLED':
    case 'CANCELED':
    case 'ERROR':
      return TxStatus.FAILED;
    case 'REFUNDED':
      return TxStatus.REFUNDED;
    case 'REVERSED':
      return TxStatus.REVERSED;
    case 'EXPIRED':
    case 'TIMEOUT':
      return TxStatus.EXPIRED;
    default:
      return TxStatus.PENDING;
  }
}

const TERMINAL_FAIL: TxStatus[] = [TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED];
const FINAL_STATUSES: TxStatus[] = [TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED];

/**
 * Central, idempotent transaction status engine. Every path that observes a
 * status change — provider webhooks AND cron status polling — flows through
 * here, guaranteeing exactly-once wallet movements and one webhook fan-out.
 */
@Injectable()
export class TxnStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly webhooks: WebhookEndpointsService,
    private readonly fees: FeesService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
  ) {}

  // ------------------------------ Collections --------------------------

  async applyCollectionUpdate(orderReference: string, record: Record<string, any>, source: 'webhook' | 'poll'): Promise<{ handled: boolean; status?: TxStatus }> {
    return this.tracing.traceCall('collection.status-apply', 'collections', async (span) => {
      span.event('input', { orderReference, source, status: record?.status });
      const collection = await this.prisma.collection.findUnique({ where: { reference: orderReference } });
      if (!collection) {
        span.event('unknown-reference', { orderReference });
        return { handled: false };
      }

      const nextStatus = mapProviderStatus(record.status);
      const alreadyFinal = ([TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED] as TxStatus[]).includes(collection.status);
      span.event('mapped', { nextStatus, alreadyFinal });
      if (alreadyFinal && collection.status === nextStatus) return { handled: true, status: nextStatus };

      const collectedAmount = record.collectedAmount ?? undefined;
      const shouldCredit = nextStatus === TxStatus.SUCCESS && !collection.walletCreditedAt;

      // Platform fee (requirement #3): charged on every successful collection;
      // the wallet receives the net amount, the fee is stored on the row.
      let feeAmount: string | undefined;
      let feeBps: number | undefined;
      if (shouldCredit) {
        const fee = await this.fees.computeFee('COLLECTION', collection.accountId, String(collectedAmount ?? collection.amount));
        feeAmount = fee.feeAmount;
        feeBps = fee.feeBps;
      }

      const updated = await this.prisma.collection.update({
        where: { id: collection.id },
        data: {
          status: nextStatus,
          providerStatus: record.status,
          providerTxId: record.id ?? collection.providerTxId,
          paymentReference: record.paymentReference ?? collection.paymentReference,
          collectedAmount: collectedAmount !== undefined ? String(collectedAmount) : collection.collectedAmount,
          collectedCurrency: record.collectedCurrency ?? collection.collectedCurrency,
          feeAmount: feeAmount !== undefined ? new Prisma.Decimal(feeAmount) : collection.feeAmount,
          feeBps: feeBps ?? collection.feeBps,
          message: record.message ?? collection.message,
          customer: (record.customer ?? collection.customer) as Prisma.InputJsonValue,
          walletCreditedAt: shouldCredit ? new Date() : collection.walletCreditedAt,
          updatedAt: new Date(),
        },
      });

      if (shouldCredit) {
        const gross = new Prisma.Decimal(String(updated.collectedAmount ?? updated.amount));
        const net = gross.minus(feeAmount ?? 0);
        await this.wallets.move({
          accountId: collection.accountId,
          type: 'COLLECTION',
          txType: 'COLLECTION_CREDIT',
          amount: net.toFixed(2),
          description: `Collection received (${collection.reference}, fee ${feeAmount} TZS @ ${feeBps} bps)`,
          reference: collection.reference,
          actorType: 'SYSTEM',
          traceId: this.tracing.currentTraceId(),
          ignoreFrozen: true,
          metadata: { source, provider: collection.provider, channel: collection.channel, gross: gross.toFixed(2), feeAmount: feeAmount, feeBps: feeBps, net: net.toFixed(2) },
        });
      }

      if (!alreadyFinal) {
        await this.webhooks.dispatch(WebhookEvent.COLLECTION_STATUS, collection.accountId, collection.reference, {
          status: nextStatus,
          reference: collection.reference,
          clientReference: collection.clientReference,
          amount: updated.amount,
          collectedAmount: updated.collectedAmount,
          currency: updated.currency,
          providerStatus: record.status,
          message: updated.message,
          customer: updated.customer,
          channel: collection.channel,
          feeAmount: updated.feeAmount,
          feeBps: updated.feeBps,
          walletCredited: shouldCredit,
        }, this.tracing.currentTraceId());
      }

      this.analytics.track(nextStatus === TxStatus.SUCCESS ? 'collection.succeeded' : `collection.${String(nextStatus).toLowerCase()}`, {
        accountId: collection.accountId,
        value: Number(updated.amount),
        traceId: collection.traceId ?? undefined,
        dimensions: { source, channel: collection.channel },
      });

      return { handled: true, status: nextStatus };
    });
  }

  // ------------------------------ Deposits ------------------------------

  /**
   * Deposit status engine (requirement #2): mirrors the collection engine
   * but credits the DISBURSEMENT wallet via the DEPOSIT ledger type. No
   * platform fee is charged on deposits. Idempotent like all status paths.
   */
  async applyDepositUpdate(orderReference: string, record: Record<string, any>, source: 'webhook' | 'poll'): Promise<{ handled: boolean; status?: TxStatus }> {
    return this.tracing.traceCall('deposit.status-apply', 'deposits', async (span) => {
      span.event('input', { orderReference, source, status: record?.status });
      const deposit = await this.prisma.deposit.findUnique({ where: { reference: orderReference } });
      if (!deposit) {
        span.event('unknown-reference', { orderReference });
        return { handled: false };
      }

      const nextStatus = mapProviderStatus(record.status);
      const alreadyFinal = ([TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED] as TxStatus[]).includes(deposit.status);
      span.event('mapped', { nextStatus, alreadyFinal });
      if (alreadyFinal && deposit.status === nextStatus) return { handled: true, status: nextStatus };

      const collectedAmount = record.collectedAmount ?? undefined;
      const shouldCredit = nextStatus === TxStatus.SUCCESS && !deposit.walletCreditedAt;

      const updated = await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          status: nextStatus,
          providerStatus: record.status,
          providerTxId: record.id ?? deposit.providerTxId,
          paymentReference: record.paymentReference ?? deposit.paymentReference,
          collectedAmount: collectedAmount !== undefined ? String(collectedAmount) : deposit.collectedAmount,
          collectedCurrency: record.collectedCurrency ?? deposit.collectedCurrency,
          message: record.message ?? deposit.message,
          customer: (record.customer ?? deposit.customer) as Prisma.InputJsonValue,
          walletCreditedAt: shouldCredit ? new Date() : deposit.walletCreditedAt,
          updatedAt: new Date(),
        },
      });

      if (shouldCredit) {
        await this.wallets.move({
          accountId: deposit.accountId,
          type: 'DISBURSEMENT',
          txType: 'DEPOSIT',
          amount: String(updated.collectedAmount ?? updated.amount),
          description: `Deposit received (${deposit.reference})`,
          reference: deposit.reference,
          actorType: 'SYSTEM',
          traceId: this.tracing.currentTraceId(),
          ignoreFrozen: true,
          metadata: { source, provider: deposit.provider, channel: deposit.channel },
        });
      }

      if (!alreadyFinal) {
        await this.webhooks.dispatch(WebhookEvent.DEPOSIT_STATUS, deposit.accountId, deposit.reference, {
          status: nextStatus,
          reference: deposit.reference,
          clientReference: deposit.clientReference,
          amount: updated.amount,
          collectedAmount: updated.collectedAmount,
          currency: updated.currency,
          providerStatus: record.status,
          message: updated.message,
          customer: updated.customer,
          targetWallet: 'DISBURSEMENT',
          walletCredited: shouldCredit,
        }, this.tracing.currentTraceId());
      }

      this.analytics.track(nextStatus === TxStatus.SUCCESS ? 'deposit.succeeded' : `deposit.${String(nextStatus).toLowerCase()}`, {
        accountId: deposit.accountId,
        value: Number(updated.amount),
        traceId: deposit.traceId ?? undefined,
        dimensions: { source, channel: deposit.channel },
      });

      return { handled: true, status: nextStatus };
    });
  }

  // ------------------------------ Payouts -------------------------------

  async applyPayoutUpdate(orderReference: string, record: Record<string, any>, source: 'webhook' | 'poll'): Promise<{ handled: boolean; status?: TxStatus }> {
    return this.tracing.traceCall('payout.status-apply', 'disbursements', async (span) => {
      span.event('input', { orderReference, source, status: record?.status });
      const payout = await this.prisma.payout.findUnique({ where: { reference: orderReference } });
      if (!payout) {
        span.event('unknown-reference', { orderReference });
        return { handled: false };
      }

      const nextStatus = mapProviderStatus(record.status);
      const alreadyFinal = ([TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.REVERSED, TxStatus.REFUNDED] as TxStatus[]).includes(payout.status);
      if (alreadyFinal && payout.status === nextStatus) return { handled: true, status: nextStatus };

      const shouldRefund = (TERMINAL_FAIL as TxStatus[]).includes(nextStatus) && payout.walletDebitedAt !== null && payout.refundedAt === null;
      const providerFee = record.fee !== undefined && record.fee !== null ? String(record.fee) : undefined;

      const updated = await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: nextStatus,
          providerStatus: record.status,
          providerTxId: record.id ?? payout.providerTxId,
          fee: providerFee ?? payout.fee,
          message: record.message ?? payout.message,
          refundedAt: shouldRefund ? new Date() : payout.refundedAt,
          updatedAt: new Date(),
        },
      });

      if (shouldRefund) {
        // refunds ALWAYS return the full wallet debit (amount + platform fee)
        // to the wallet that funded the payout — no fee is retained on
        // provider-rejected payouts. (CUSTOMER payouts debit DISBURSEMENT;
        // sweeps/withdrawals debit COLLECTION.)
        const refundAmount = payout.feeAmount
          ? new Prisma.Decimal(payout.amount).plus(payout.feeAmount)
          : payout.amount;
        await this.wallets.move({
          accountId: payout.accountId,
          type: payout.sourceWallet,
          txType: 'REFUND',
          amount: refundAmount.toFixed(2),
          description: `Payout refund (${payout.reference})`,
          reference: payout.reference,
          actorType: 'SYSTEM',
          traceId: this.tracing.currentTraceId(),
          ignoreFrozen: true,
          metadata: { source, reason: nextStatus, providerMessage: record.message, sourceWallet: payout.sourceWallet, payoutKind: payout.payoutKind },
        });
      }

      if (!alreadyFinal) {
        const event: WebhookEvent = payout.batchId ? WebhookEvent.BATCH_STATUS : WebhookEvent.DISBURSEMENT_STATUS;
        await this.webhooks.dispatch(event, payout.accountId, payout.batchId ?? payout.reference, {
          payoutReference: payout.reference,
          payoutStatus: nextStatus,
          batchReference: payout.batchId ? (await this.batchReference(payout.batchId)) ?? undefined : undefined,
          amount: updated.amount,
          currency: updated.currency,
          channel: payout.channel,
          providerStatus: record.status,
          message: updated.message,
          refunded: shouldRefund,
        }, this.tracing.currentTraceId());
      }

      if (payout.batchId) {
        await this.updateBatchCounters(payout.batchId);
      }

      this.analytics.track(nextStatus === TxStatus.SUCCESS ? 'payout.succeeded' : `payout.${String(nextStatus).toLowerCase()}`, {
        accountId: payout.accountId,
        value: Number(payout.amount),
        traceId: payout.traceId ?? undefined,
        dimensions: { source, channel: payout.channel },
      });

      return { handled: true, status: nextStatus };
    });
  }

  private async batchReference(batchId: string): Promise<string | null> {
    const batch = await this.prisma.disbursementBatch.findUnique({ where: { id: batchId }, select: { reference: true } });
    return batch?.reference ?? null;
  }

  /** Recomputes batch counters/status from its payout rows (source of truth). */
  async updateBatchCounters(batchId: string): Promise<void> {
    const payouts = await this.prisma.payout.findMany({
      where: { batchId },
      select: { status: true },
    });
    const success = payouts.filter((p) => p.status === TxStatus.SUCCESS).length;
    const failed = payouts.filter((p) => (TERMINAL_FAIL as TxStatus[]).includes(p.status)).length;
    const done = success + failed;
    const total = payouts.length;

    let status: 'PROCESSING' | 'COMPLETED' | 'PARTIALLY_FAILED' | 'FAILED' = 'PROCESSING';
    if (done === total) {
      if (success === total) status = 'COMPLETED';
      else if (success === 0) status = 'FAILED';
      else status = 'PARTIALLY_FAILED';
    }

    const batch = await this.prisma.disbursementBatch.update({
      where: { id: batchId },
      data: { successCount: success, failedCount: failed, status },
    });

    if (status !== 'PROCESSING') {
      await this.webhooks.dispatch(WebhookEvent.BATCH_STATUS, batch.accountId, batch.reference, {
        batchReference: batch.reference,
        name: batch.name,
        status,
        totalCount: batch.totalCount,
        successCount: batch.successCount,
        failedCount: batch.failedCount,
        totalAmount: batch.totalAmount,
      }, this.tracing.currentTraceId());
      this.analytics.track('batch.completed', {
        accountId: batch.accountId,
        dimensions: { status, batch: batch.reference },
      });
    }
  }
}
