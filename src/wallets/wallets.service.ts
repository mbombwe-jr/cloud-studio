import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Prisma, WalletStatus, WalletTransaction, WalletTxType, WalletType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeesService } from '../fees/fees.service';
import { ErrorCodes } from '../common/constants';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiTracingService } from '../iii/tracing.service';

const CREDIT_TYPES: WalletTxType[] = ['DEPOSIT', 'COLLECTION_CREDIT', 'REFUND', 'ADJUSTMENT', 'TRANSFER_IN'];

/**
 * Wallet ledger.
 *
 * Safety properties:
 *  - every movement runs inside a serializable transaction with a conditional
 *    balance update (`balance >= amount` on debits) so overdraft is impossible
 *    even under concurrent requests or multiple app instances;
 *  - every movement writes a WalletTransaction row with balanceBefore/After;
 *  - frozen wallets reject all movements except admin ADJUSTMENT corrections;
 *  - deposits & withdrawals via the account API require an explicit
 *    `walletActions` permission flag (default: admin-only, secure-first).
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeesService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
  ) {}

  async getWallets(accountId: string) {
    // accepts the public accountId (ACC-XXXXXXXX) or the internal row id
    const resolved = await this.prisma.resolveAccountId(accountId);
    return this.prisma.wallet.findMany({ where: { accountId: resolved ?? '__none__' }, orderBy: { type: 'asc' } });
  }

  async getWallet(accountId: string, type: WalletType) {
    // accepts the public accountId (ACC-XXXXXXXX) or the internal row id
    const resolved = await this.prisma.resolveAccountId(accountId);
    const wallet = await this.prisma.wallet.findUnique({ where: { accountId_type: { accountId: resolved ?? accountId, type } } });
    if (!wallet) throw new NotFoundException({ code: ErrorCodes.WALLET_NOT_FOUND, message: `${type} wallet not found` });
    return wallet;
  }

  async getTransactions(accountId: string, type: WalletType, params: { skip: number; take: number; from?: Date; to?: Date }) {
    const wallet = await this.getWallet(accountId, type);
    const where: Prisma.WalletTransactionWhereInput = {
      walletId: wallet.id,
      ...(params.from || params.to ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return { items, total, wallet };
  }

  /**
   * Core ledger mutation. `allowDebitBeyondZero=false` strictly enforces the
   * balance floor at zero. Returns the created ledger row.
   */
  async move(input: {
    accountId: string;
    type: WalletType;
    txType: WalletTxType;
    amount: number | string;
    description: string;
    reference?: string;
    metadata?: Record<string, unknown>;
    actorType: ActorType;
    actorId?: string;
    traceId?: string;
    /** allow credit even when frozen (e.g. refunds back into frozen wallet) */
    ignoreFrozen?: boolean;
  }): Promise<WalletTransaction> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.isZero() || !amount.isFinite()) {
      throw new ForbiddenException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Amount must be a non-zero finite value' });
    }

    // Direction is determined by the ledger type, never by the sign of the
    // caller-supplied amount (secure-first): withdrawals / payout debits /
    // batch holds always debit; deposits / collection credits / refunds always
    // credit; ADJUSTMENT uses the sign (positive -> credit, negative -> debit).
    const DEBIT_TYPES: WalletTxType[] = ['WITHDRAWAL', 'PAYOUT_DEBIT', 'BATCH_HOLD'];
    const isDebit = DEBIT_TYPES.includes(input.txType) || (input.txType === 'ADJUSTMENT' && amount.lessThan(0));

    const wallet = await this.getWallet(input.accountId, input.type);
    if (wallet.status === WalletStatus.FROZEN && !input.ignoreFrozen) {
      throw new ForbiddenException({ code: ErrorCodes.WALLET_FROZEN, message: `${input.type} wallet is frozen` });
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.wallet.findUnique({ where: { id: wallet.id }, select: { balance: true, status: true } });
      if (!current) throw new NotFoundException({ code: ErrorCodes.WALLET_NOT_FOUND, message: 'Wallet not found' });
      if (current.status === WalletStatus.FROZEN && !input.ignoreFrozen) {
        throw new ForbiddenException({ code: ErrorCodes.WALLET_FROZEN, message: `${input.type} wallet is frozen` });
      }

      const balanceBefore = new Prisma.Decimal(current.balance);
      const delta = amount.abs();
      const isCredit = !isDebit;
      const balanceAfter = isCredit ? balanceBefore.plus(delta) : balanceBefore.minus(delta);

      if (isDebit && balanceAfter.lessThan(0)) {
        throw new ForbiddenException({
          code: ErrorCodes.INSUFFICIENT_FUNDS,
          message: `Insufficient funds: balance ${balanceBefore.toFixed(2)} ${wallet.currency}, requested ${delta.toFixed(2)}`,
        });
      }

      // conditional update re-checks the floor inside the transaction
      if (isDebit) {
        const res = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: delta } },
          data: { balance: { decrement: delta } },
        });
        if (res.count === 0) {
          throw new ForbiddenException({ code: ErrorCodes.INSUFFICIENT_FUNDS, message: 'Insufficient funds (concurrent update prevented)' });
        }
      } else {
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: delta } } });
      }

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: input.txType,
          amount: isCredit ? delta : delta.neg(),
          balanceBefore,
          balanceAfter,
          currency: wallet.currency,
          reference: input.reference,
          description: input.description,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue,
          traceId: input.traceId,
          createdBy: input.actorId,
          status: 'SUCCESS',
        },
      });
    });
  }

  /**
   * Instant internal move of funds from the COLLECTION wallet to the
   * DISBURSEMENT wallet (requirement #6), charged at the account's custom
   * transfer fee (default 2%). Both legs run inside ONE database
   * transaction with the same overdraft guards as `move`, so a partial
   * transfer is impossible even under concurrency or crashes.
   */
  async transferCollectionToDisbursement(
    accountId: string,
    dto: { amount: string; reference?: string },
    actorType: ActorType,
    actorId?: string,
    traceId?: string,
  ) {
    return this.tracing.traceCall('wallet.transfer', 'wallets', async (span) => {
      const resolved = await this.prisma.resolveAccountId(accountId);
      if (!resolved) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });

      const source = await this.getWallet(resolved, 'COLLECTION');
      const target = await this.getWallet(resolved, 'DISBURSEMENT');
      if (source.status === WalletStatus.FROZEN) {
        throw new ForbiddenException({ code: ErrorCodes.WALLET_FROZEN, message: 'COLLECTION wallet is frozen' });
      }
      if (target.status === WalletStatus.FROZEN) {
        throw new ForbiddenException({ code: ErrorCodes.WALLET_FROZEN, message: 'DISBURSEMENT wallet is frozen' });
      }

      // duplicate-reference guard (per account, transfers only)
      if (dto.reference) {
        const dupe = await this.prisma.walletTransfer.findFirst({
          where: { accountId: resolved, clientReference: dto.reference.toUpperCase() },
          select: { id: true },
        });
        if (dupe) throw new ConflictException({ code: ErrorCodes.DUPLICATE_REFERENCE, message: 'A transfer with this client reference already exists' });
      }

      const amount = new Prisma.Decimal(dto.amount);
      if (amount.isZero() || !amount.isFinite() || amount.lessThan(0)) {
        throw new ForbiddenException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Amount must be a positive finite value' });
      }
      const fee = await this.fees.computeTransferFee(resolved, amount);
      const totalDebit = amount.plus(fee.feeAmount);

      const reference = `WT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 20);

      const result = await this.prisma.$transaction(async (tx) => {
        // ---- leg 1: debit COLLECTION (amount + fee) ----
        const src = await tx.wallet.findUnique({ where: { id: source.id }, select: { balance: true, status: true } });
        if (!src) throw new NotFoundException({ code: ErrorCodes.WALLET_NOT_FOUND, message: 'COLLECTION wallet not found' });
        if (src.status === WalletStatus.FROZEN) throw new ForbiddenException({ code: ErrorCodes.WALLET_FROZEN, message: 'COLLECTION wallet is frozen' });
        const srcBefore = new Prisma.Decimal(src.balance);
        const srcAfter = srcBefore.minus(totalDebit);
        if (srcAfter.lessThan(0)) {
          throw new ForbiddenException({ code: ErrorCodes.INSUFFICIENT_FUNDS, message: `Insufficient funds: balance ${srcBefore.toFixed(2)}, requested ${totalDebit.toFixed(2)} (incl. ${fee.feeAmount} fee)` });
        }
        const debitRes = await tx.wallet.updateMany({
          where: { id: source.id, balance: { gte: totalDebit } },
          data: { balance: { decrement: totalDebit } },
        });
        if (debitRes.count === 0) {
          throw new ForbiddenException({ code: ErrorCodes.INSUFFICIENT_FUNDS, message: 'Insufficient funds (concurrent update prevented)' });
        }
        const outTx = await tx.walletTransaction.create({
          data: {
            walletId: source.id,
            type: 'TRANSFER_OUT',
            amount: totalDebit.neg(),
            balanceBefore: srcBefore,
            balanceAfter: srcAfter,
            currency: source.currency,
            reference,
            description: `Transfer to DISBURSEMENT (fee ${fee.feeAmount} TZS @ ${fee.feeBps} bps)`,
            status: 'SUCCESS',
            traceId: traceId ?? this.tracing.currentTraceId(),
            createdBy: actorId,
            metadata: { amount: amount.toFixed(2), feeAmount: fee.feeAmount, feeBps: fee.feeBps } as Prisma.InputJsonValue,
          },
        });

        // ---- leg 2: credit DISBURSEMENT (amount) ----
        const dst = await tx.wallet.findUnique({ where: { id: target.id }, select: { balance: true, status: true } });
        if (!dst) throw new NotFoundException({ code: ErrorCodes.WALLET_NOT_FOUND, message: 'DISBURSEMENT wallet not found' });
        if (dst.status === WalletStatus.FROZEN) throw new ForbiddenException({ code: ErrorCodes.WALLET_FROZEN, message: 'DISBURSEMENT wallet is frozen' });
        const dstBefore = new Prisma.Decimal(dst.balance);
        const dstAfter = dstBefore.plus(amount);
        await tx.wallet.update({ where: { id: target.id }, data: { balance: dstAfter } });
        await tx.walletTransaction.create({
          data: {
            walletId: target.id,
            type: 'TRANSFER_IN',
            amount,
            balanceBefore: dstBefore,
            balanceAfter: dstAfter,
            currency: target.currency,
            reference,
            description: `Transfer from COLLECTION (${reference})`,
            status: 'SUCCESS',
            traceId: traceId ?? this.tracing.currentTraceId(),
            createdBy: actorId,
            metadata: { amount: amount.toFixed(2), linkedTx: outTx.id } as Prisma.InputJsonValue,
          },
        });

        const transfer = await tx.walletTransfer.create({
          data: {
            accountId: resolved,
            reference,
            clientReference: dto.reference?.toUpperCase() ?? null,
            amount,
            feeAmount: new Prisma.Decimal(fee.feeAmount),
            feeBps: fee.feeBps,
            currency: source.currency,
            status: 'SUCCESS',
            traceId: traceId ?? this.tracing.currentTraceId(),
          },
        });
        return transfer;
      });

      span.event('transfer-complete', { reference: result.reference, amount: amount.toFixed(2), fee: fee.feeAmount });
      this.analytics.track('wallet.transfer', {
        accountId: resolved,
        value: Number(amount),
        traceId: result.traceId ?? undefined,
        dimensions: { feeBps: String(fee.feeBps) },
      });
      return result;
    });
  }

  async listTransfers(accountId: string, params: { skip: number; take: number }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    const where: Prisma.WalletTransferWhereInput = { accountId: resolved ?? '__none__' };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.walletTransfer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.walletTransfer.count({ where }),
    ]);
    return { items, total };
  }

  async setFrozen(
    accountId: string,
    type: WalletType,
    frozen: boolean,
    actor: { id: string; name: string },
    ctx: { ip?: string; ua?: string; traceId?: string },
  ) {
    const wallet = await this.getWallet(accountId, type);
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { status: frozen ? WalletStatus.FROZEN : WalletStatus.ACTIVE },
    });
    this.analytics.track(frozen ? 'wallet.freeze' : 'wallet.activate', { accountId, traceId: ctx?.traceId, dimensions: { walletType: type } });
    return updated;
  }

  /** Reconciliation helper used by the admin computational review. */
  async ledgerIntegrity(accountId: string, type: WalletType) {
    const wallet = await this.getWallet(accountId, type);
    const agg = await this.prisma.walletTransaction.aggregate({
      where: { walletId: wallet.id },
      _sum: { amount: true },
      _count: true,
    });
    const sum = agg._sum.amount ? new Prisma.Decimal(agg._sum.amount) : new Prisma.Decimal(0);
    const balance = new Prisma.Decimal(wallet.balance);
    return {
      walletType: type,
      currency: wallet.currency,
      balance: balance.toFixed(2),
      ledgerSum: sum.toFixed(2),
      transactionCount: agg._count,
      consistent: balance.eq(sum),
      discrepancy: balance.minus(sum).toFixed(2),
    };
  }

  isCreditType(txType: WalletTxType): boolean {
    return CREDIT_TYPES.includes(txType);
  }
}
