import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorType, PayoutChannel, Prisma, SettlementType, TxStatus, WalletType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { FeesService } from '../fees/fees.service';
import { IiiQueueService } from '../iii/queue.service';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';
import { buildReference } from '../common/utils/reference.util';
import { normalizePhoneNumber } from '../common/utils/phone.util';
import { ErrorCodes } from '../common/constants';

export interface SettlementInput {
  type: 'MOBILE' | 'BANK';
  method?: 'AIRTEL' | 'TIGO' | 'VODACOM' | 'HALOPESA';
  phoneNumber?: string;
  bankName?: string;
  bankInitials?: string;
  accountNumber?: string;
  accountName?: string;
}

/**
 * Customer settlement accounts + collection-wallet settlement lifecycle
 * (requirements #1, #4, #5).
 *
 *  - Settlement details captured at onboarding (mobile: method + phone;
 *    bank: number + bank name + initials) and used for ALL settlement —
 *    there is no custom/manual settlement method.
 *  - Auto-sweep (default ON): every day at 00:00 Africa/Dar_es_Salaam the
 *    COLLECTION wallet balance is swept into the default settlement account
 *    via the payout rail (bank -> bank payout, phone -> mobile payout).
 *  - Manual withdrawal: settles a specific amount the same way.
 *
 * Money-safety: withdrawals/sweeps debit the COLLECTION wallet atomically
 * (amount + fee for withdrawals, full balance with fee deducted from the
 * payout for sweeps); failed provider attempts refund to the same wallet.
 */
@Injectable()
export class SettlementsService {
  /** Provider payouts below this amount are rejected (TZS). */
  private readonly minPayout: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly wallets: WalletsService,
    private readonly fees: FeesService,
    private readonly queue: IiiQueueService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
  ) {
    this.minPayout = parseInt(process.env.MIN_PAYOUT_TZS || '1000', 10);
  }

  // ------------------------- Settlement accounts -------------------------

  async listSettlementAccounts(accountId: string) {
    return this.prisma.settlementAccount.findMany({
      where: { accountId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getDefaultSettlementAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, status: true },
    });
    if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const row = await this.prisma.settlementAccount.findFirst({
      where: { accountId, isActive: true, isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    return row;
  }

  /** Validates channel-specific fields and normalises the phone number. */
  private validateSettlementInput(input: SettlementInput): Required<Pick<Prisma.SettlementAccountUncheckedCreateInput, 'type'>> & Record<string, unknown> {
    if (input.type === SettlementType.MOBILE) {
      if (!input.method) throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Mobile settlement requires a method (AIRTEL, TIGO, VODACOM or HALOPESA)' });
      const phone = normalizePhoneNumber(input.phoneNumber ?? '');
      if (!phone) throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Mobile settlement requires a valid Tanzanian phoneNumber' });
      return { type: SettlementType.MOBILE, method: input.method, phoneNumber: phone };
    }
    if (!input.accountNumber || !input.bankName) {
      throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Bank settlement requires accountNumber and bankName' });
    }
    return {
      type: SettlementType.BANK,
      bankName: input.bankName.trim(),
      bankInitials: input.bankInitials?.trim().toUpperCase() ?? null,
      accountNumber: input.accountNumber.trim(),
      accountName: input.accountName?.trim() ?? null,
    };
  }

  /** Creates a settlement account for an account (default: becomes the default). */
  async upsertSettlementAccount(
    accountId: string,
    input: SettlementInput,
    opts: { isDefault?: boolean; actorType: ActorType; actorId?: string; traceId?: string } = { actorType: ActorType.ADMIN },
  ) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const data = this.validateSettlementInput(input) as Prisma.SettlementAccountUncheckedCreateInput;
    const isDefault = opts.isDefault !== false;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.settlementAccount.updateMany({ where: { accountId: resolved }, data: { isDefault: false } });
      }
      return tx.settlementAccount.create({
        data: { ...data, accountId: resolved, isDefault } as Prisma.SettlementAccountUncheckedCreateInput,
      });
    });
  }

  async updateSettlementAccount(
    accountId: string,
    settlementId: string,
    patch: SettlementInput & { isActive?: boolean; isDefault?: boolean },
  ) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const row = await this.prisma.settlementAccount.findFirst({ where: { id: settlementId, accountId: resolved } });
    if (!row) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Settlement account not found' });

    if (patch.isDefault) {
      await this.prisma.settlementAccount.updateMany({ where: { accountId: resolved }, data: { isDefault: false } });
    }
    const data: Prisma.SettlementAccountUncheckedUpdateInput = {};
    if (patch.type) Object.assign(data, this.validateSettlementInput(patch));
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.isDefault !== undefined) data.isDefault = patch.isDefault;
    return this.prisma.settlementAccount.update({ where: { id: row.id }, data });
  }

  // --------------------------- Withdrawal (#5) ---------------------------

  /**
   * Manually settles a specific amount from the COLLECTION wallet into the
   * account's default settlement account (bank -> bank payout, phone ->
   * mobile payout). The disbursement fee schedule applies; the wallet is
   * debited `amount + fee` atomically and provider failures refund here.
   */
  async createWithdrawal(
    accountId: string,
    dto: { amount: string; reference?: string; settlementAccountId?: string },
    actorType: ActorType,
    actorId?: string,
    traceId?: string,
  ) {
    return this.tracing.traceCall('settlement.withdraw', 'settlements', async (span) => {
      const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { id: true, sourceCode: true, status: true } });
      if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });

      const settlement = dto.settlementAccountId
        ? await this.prisma.settlementAccount.findFirst({ where: { id: dto.settlementAccountId, accountId, isActive: true } })
        : await this.getDefaultSettlementAccount(accountId);
      if (!settlement) {
        throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'No active settlement account configured for this customer' });
      }

      const amount = new Prisma.Decimal(dto.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Amount must be greater than zero' });
      }
      const fee = await this.fees.computeFee('DISBURSEMENT', accountId, amount);
      const totalDebit = amount.plus(fee.feeAmount);
      if (totalDebit.lessThan(this.minPayout)) {
        throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: `Withdrawal must be at least ${this.minPayout} TZS including fees` });
      }

      const reference = buildReference(account.sourceCode, dto.reference);
      const channel = settlement.type === SettlementType.BANK ? PayoutChannel.BANK : PayoutChannel.MOBILE_MONEY;

      // atomic debit of the COLLECTION wallet (amount + fee)
      await this.wallets.move({
        accountId,
        type: WalletType.COLLECTION,
        txType: 'WITHDRAWAL',
        amount: totalDebit.toFixed(2),
        description: `Settlement withdrawal (${reference})`,
        reference,
        actorType,
        actorId,
        traceId: traceId ?? this.tracing.currentTraceId(),
        metadata: { payoutKind: 'WITHDRAWAL', feeAmount: fee.feeAmount, feeBps: fee.feeBps, settlementId: settlement.id },
      });

      const payout = await this.prisma.payout.create({
        data: {
          accountId,
          channel,
          reference,
          clientReference: dto.reference?.toUpperCase() ?? null,
          sourceWallet: WalletType.COLLECTION,
          payoutKind: 'WITHDRAWAL',
          amount,
          currency: 'TZS',
          feeAmount: new Prisma.Decimal(fee.feeAmount),
          feeBps: fee.feeBps,
          phoneNumber: settlement.type === SettlementType.MOBILE ? settlement.phoneNumber : null,
          accountNumber: settlement.type === SettlementType.BANK ? settlement.accountNumber : null,
          accountName: settlement.type === SettlementType.BANK ? settlement.accountName ?? account.sourceCode : null,
          bic: settlement.type === SettlementType.BANK ? settlement.bankInitials : null,
          transferType: settlement.type === SettlementType.BANK ? 'ACH' : null,
          status: TxStatus.PENDING,
          walletDebitedAt: new Date(),
          rawRequest: { kind: 'WITHDRAWAL', settlementId: settlement.id, settlementType: settlement.type, fee: fee.feeAmount } as Prisma.InputJsonValue,
          traceId: traceId ?? this.tracing.currentTraceId(),
        },
      });

      await this.queue.enqueue('payout.process', { payoutId: payout.id, traceId: payout.traceId });
      span.event('withdrawal-queued', { reference, channel, amount: String(amount), fee: fee.feeAmount });
      this.analytics.track('settlement.withdrawal', {
        accountId,
        value: Number(amount),
        traceId: payout.traceId ?? undefined,
        dimensions: { channel, feeBps: String(fee.feeBps) },
      });
      return payout;
    });
  }

  /** Lists withdrawal/settlement payouts for an account (newest first). */
  async listWithdrawals(accountId: string, params: { skip: number; take: number }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    const where: Prisma.PayoutWhereInput = {
      accountId: resolved ?? '__none__',
      payoutKind: { in: ['WITHDRAWAL', 'AUTO_SWEEP'] },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.payout.count({ where }),
    ]);
    return { items, total };
  }

  // --------------------------- Auto sweep (#4) ---------------------------

  /** Toggles the daily 00:00 auto-sweep for an account (default: on). */
  async setAutoSweep(accountId: string, enabled: boolean) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    return this.prisma.account.update({
      where: { id: resolved },
      data: { autoSweep: enabled === true },
      select: { id: true, accountId: true, autoSweep: true },
    });
  }

  /**
   * Daily 00:00 (Africa/Dar_es_Salaam) sweep: settles the full COLLECTION
   * wallet balance into each eligible account's default settlement account.
   * The fee is deducted from the swept amount (the wallet is debited the
   * full balance). Skips accounts already swept today.
   *
   * @returns number of sweep payouts created
   */
  async runAutoSweep(options: { dryRun?: boolean } = {}): Promise<{ created: number; skipped: number; details: Array<{ accountId: string; reference?: string; amount?: string; reason?: string }> }> {
    return this.tracing.traceCall('settlement.auto-sweep', 'settlements', async (span) => {
      const accounts = await this.prisma.account.findMany({
        where: { status: 'ACTIVE', autoSweep: true },
        select: { id: true, sourceCode: true },
      });
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const details: Array<{ accountId: string; reference?: string; amount?: string; reason?: string }> = [];
      let created = 0;
      let skipped = 0;

      for (const account of accounts) {
        try {
          const settlement = await this.getDefaultSettlementAccount(account.id);
          if (!settlement) {
            skipped++;
            details.push({ accountId: account.id, reason: 'no settlement account' });
            continue;
          }
          const wallet = await this.prisma.wallet.findUnique({
            where: { accountId_type: { accountId: account.id, type: WalletType.COLLECTION } },
          });
          const balance = wallet ? new Prisma.Decimal(wallet.balance) : new Prisma.Decimal(0);
          if (balance.lessThanOrEqualTo(0)) {
            skipped++;
            details.push({ accountId: account.id, reason: 'empty collection wallet' });
            continue;
          }
          const alreadySwept = await this.prisma.payout.findFirst({
            where: { accountId: account.id, payoutKind: 'AUTO_SWEEP', createdAt: { gte: startOfToday }, status: { not: TxStatus.FAILED } },
            select: { id: true },
          });
          if (alreadySwept) {
            skipped++;
            details.push({ accountId: account.id, reason: 'already swept today' });
            continue;
          }

          const fee = await this.fees.computeFee('DISBURSEMENT', account.id, balance);
          const payoutAmount = balance.minus(fee.feeAmount);
          if (payoutAmount.lessThan(this.minPayout)) {
            skipped++;
            details.push({ accountId: account.id, reason: `balance below minimum payout (${payoutAmount.toFixed(2)} after fee)` });
            continue;
          }

          const reference = buildReference(account.sourceCode);
          const channel = settlement.type === SettlementType.BANK ? PayoutChannel.BANK : PayoutChannel.MOBILE_MONEY;

          if (options.dryRun) {
            details.push({ accountId: account.id, reference, amount: payoutAmount.toFixed(2), reason: 'dry-run' });
            continue;
          }

          await this.wallets.move({
            accountId: account.id,
            type: WalletType.COLLECTION,
            txType: 'WITHDRAWAL',
            amount: balance.toFixed(2),
            description: `Auto-sweep (${reference})`,
            reference,
            actorType: ActorType.SYSTEM,
            traceId: this.tracing.currentTraceId(),
            metadata: { payoutKind: 'AUTO_SWEEP', swept: balance.toFixed(2), feeAmount: fee.feeAmount, feeBps: fee.feeBps, payoutAmount: payoutAmount.toFixed(2) },
          });

          const payout = await this.prisma.payout.create({
            data: {
              accountId: account.id,
              channel,
              reference,
              clientReference: 'AUTO-SWEEP',
              sourceWallet: WalletType.COLLECTION,
              payoutKind: 'AUTO_SWEEP',
              amount: payoutAmount,
              currency: 'TZS',
              feeAmount: new Prisma.Decimal(fee.feeAmount),
              feeBps: fee.feeBps,
              phoneNumber: settlement.type === SettlementType.MOBILE ? settlement.phoneNumber : null,
              accountNumber: settlement.type === SettlementType.BANK ? settlement.accountNumber : null,
              accountName: settlement.type === SettlementType.BANK ? settlement.accountName ?? account.sourceCode : null,
              bic: settlement.type === SettlementType.BANK ? settlement.bankInitials : null,
              transferType: settlement.type === SettlementType.BANK ? 'ACH' : null,
              status: TxStatus.PENDING,
              walletDebitedAt: new Date(),
              rawRequest: { kind: 'AUTO_SWEEP', settlementId: settlement.id, fee: fee.feeAmount, sweptBalance: balance.toFixed(2) } as Prisma.InputJsonValue,
              traceId: this.tracing.currentTraceId(),
            },
          });

          await this.queue.enqueue('payout.process', { payoutId: payout.id, traceId: payout.traceId });
          created++;
          details.push({ accountId: account.id, reference, amount: payoutAmount.toFixed(2) });
          this.analytics.track('settlement.auto_sweep', {
            accountId: account.id,
            value: Number(payoutAmount),
            traceId: payout.traceId ?? undefined,
            dimensions: { channel },
          });
          span.event('sweep-created', { accountId: account.id, reference, amount: payoutAmount.toFixed(2) });
        } catch (err: any) {
          skipped++;
          details.push({ accountId: account.id, reason: err?.message ?? 'sweep error' });
          this.logger.error('auto-sweep leg failed', { module: 'settlements', accountId: account.id, error: err?.message });
        }
      }

      span.event('sweep-summary', { accounts: accounts.length, created, skipped });
      this.logger.info('auto-sweep run complete', { module: 'settlements', accounts: accounts.length, created, skipped });
      return { created, skipped, details };
    });
  }

  /** Admin "sweep now" — immediate single-account sweep (same guarantees). */
  async sweepNow(accountId: string, traceId?: string) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const result = await this.runAutoSweepSubset(resolved, traceId);
    return result;
  }

  private async runAutoSweepSubset(accountId: string, traceId?: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { id: true, sourceCode: true, status: true, autoSweep: true } });
    if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const settlement = await this.getDefaultSettlementAccount(account.id);
    if (!settlement) throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'No active settlement account configured for this customer' });
    const wallet = await this.prisma.wallet.findUnique({ where: { accountId_type: { accountId: account.id, type: WalletType.COLLECTION } } });
    const balance = wallet ? new Prisma.Decimal(wallet.balance) : new Prisma.Decimal(0);
    if (balance.lessThanOrEqualTo(0)) throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Collection wallet is empty — nothing to sweep' });

    const fee = await this.fees.computeFee('DISBURSEMENT', account.id, balance);
    const payoutAmount = balance.minus(fee.feeAmount);
    if (payoutAmount.lessThan(this.minPayout)) {
      throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: `Balance after fee (${payoutAmount.toFixed(2)} TZS) is below the ${this.minPayout} TZS payout minimum` });
    }

    const reference = buildReference(account.sourceCode);
    const channel = settlement.type === SettlementType.BANK ? PayoutChannel.BANK : PayoutChannel.MOBILE_MONEY;

    await this.wallets.move({
      accountId: account.id,
      type: WalletType.COLLECTION,
      txType: 'WITHDRAWAL',
      amount: balance.toFixed(2),
      description: `Manual sweep (${reference})`,
      reference,
      actorType: ActorType.ADMIN,
      traceId: traceId ?? this.tracing.currentTraceId(),
      metadata: { payoutKind: 'AUTO_SWEEP', swept: balance.toFixed(2), feeAmount: fee.feeAmount, payoutAmount: payoutAmount.toFixed(2) },
    });

    const payout = await this.prisma.payout.create({
      data: {
        accountId: account.id,
        channel,
        reference,
        clientReference: 'AUTO-SWEEP',
        sourceWallet: WalletType.COLLECTION,
        payoutKind: 'AUTO_SWEEP',
        amount: payoutAmount,
        currency: 'TZS',
        feeAmount: new Prisma.Decimal(fee.feeAmount),
        feeBps: fee.feeBps,
        phoneNumber: settlement.type === SettlementType.MOBILE ? settlement.phoneNumber : null,
        accountNumber: settlement.type === SettlementType.BANK ? settlement.accountNumber : null,
        accountName: settlement.type === SettlementType.BANK ? settlement.accountName ?? account.sourceCode : null,
        bic: settlement.type === SettlementType.BANK ? settlement.bankInitials : null,
        transferType: settlement.type === SettlementType.BANK ? 'ACH' : null,
        status: TxStatus.PENDING,
        walletDebitedAt: new Date(),
        rawRequest: { kind: 'AUTO_SWEEP', settlementId: settlement.id, fee: fee.feeAmount, sweptBalance: balance.toFixed(2), trigger: 'admin' } as Prisma.InputJsonValue,
        traceId: traceId ?? this.tracing.currentTraceId(),
      },
    });
    await this.queue.enqueue('payout.process', { payoutId: payout.id, traceId: payout.traceId });
    this.analytics.track('settlement.sweep_now', { accountId: account.id, value: Number(payoutAmount), traceId: payout.traceId ?? undefined, dimensions: { channel } });
    return { payout, swept: balance.toFixed(2), feeAmount: fee.feeAmount, payoutAmount: payoutAmount.toFixed(2), settlement: { id: settlement.id, type: settlement.type } };
  }
}
