import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { ErrorCodes } from '../common/constants';

/**
 * Admin oversight:
 *  - creates serviceman/admin logins (service men get strictly read access);
 *  - full account preview: transactions, SMS, wallets, bills, audit trail;
 *  - computational review of collections / disbursements / balances for the
 *    current day, current month, or a custom range — designed to surface
 *    fraud ("prevent floud"): ledger reconciliation + success ratios;
 *  - analytics summary and trace inspection (no trace data is ever dropped).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly wallets: WalletsService,
  ) {}

  // ----------------------------- Staff ---------------------------------

  async createStaff(dto: { name: string; email: string; password: string; role: UserRole }, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const exists = await this.prisma.staffUser.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (exists) throw new ConflictException({ code: ErrorCodes.CONFLICT, message: 'A user with this email already exists' });
    const passwordHash = await this.auth.hashPassword(dto.password, this.config.get('bcryptRounds') ?? 12);
    const user = await this.prisma.staffUser.create({
      data: { name: dto.name.trim(), email: dto.email.toLowerCase(), passwordHash, role: dto.role },
    });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name,
      action: 'staff.created', entity: 'StaffUser', entityId: user.id,
      changes: { email: user.email, role: user.role }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
  }

  async listStaff() {
    return this.prisma.staffUser.findMany({ select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  }

  // --------------------------- Account preview --------------------------

  /** "Preview all accounts data": transactions, SMS, wallets, bills, audit. */
  async accountOverview(accountId: string, params: { txSkip: number; txTake: number; smsSkip: number; smsTake: number }) {
    // accepts the public accountId (ACC-XXXXXXXX) or the internal row id
    const resolved = await this.prisma.resolveAccountId(accountId);
    const account = resolved
      ? await this.prisma.account.findUnique({
          where: { id: resolved },
          include: {
            permissions: true,
            wallets: true,
            apiKeys: { select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true } },
            accountPlan: { include: { plan: true } },
            webhookEndpoints: { select: { id: true, url: true, events: true, isActive: true } },
          },
        })
      : null;
    if (!account) return null;
    const id = account.id;

    const [collections, payouts, batches, sms, bills, audits] = await this.prisma.$transaction([
      this.prisma.collection.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, skip: params.txSkip, take: params.txTake }),
      this.prisma.payout.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, skip: params.txSkip, take: params.txTake }),
      this.prisma.disbursementBatch.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.smsMessage.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, skip: params.smsSkip, take: params.smsTake }),
      this.prisma.bill.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.auditLog.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    return { account, collections, payouts, batches, sms, bills, audits };
  }

  // -------------------------- Computational review -----------------------

  /**
   * Range resolution per spec: default current month; `preset=day` current
   * day; `preset=custom` requires from/to.
   */
  resolveRange(query: { preset?: string; from?: string; to?: string }): { from: Date; to: Date; preset: string } {
    const now = new Date();
    const preset = query.preset ?? 'month';
    if (preset === 'day') {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return { from, to, preset };
    }
    if (preset === 'custom') {
      if (!query.from || !query.to) {
        throw new ConflictException({ code: ErrorCodes.VALIDATION_FAILED, message: 'preset=custom requires from and to (YYYY-MM-DD)' });
      }
      const from = new Date(`${query.from}T00:00:00.000Z`);
      const to = new Date(`${query.to}T23:59:59.999Z`);
      return { from, to, preset };
    }
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = now;
    return { from, to, preset };
  }

  async computations(accountId: string, range: { from: Date; to: Date }) {
    const { from, to } = range;
    // accepts the public accountId (ACC-XXXXXXXX) or the internal row id
    const resolved = await this.prisma.resolveAccountId(accountId);
    const account = resolved ? await this.prisma.account.findUnique({ where: { id: resolved }, include: { wallets: true } }) : null;
    if (!account) return null;
    const id = account.id;

    const [collections, payouts, batches, sms, bills] = await this.prisma.$transaction([
      this.prisma.collection.groupBy({ by: ['status'], where: { accountId: id, createdAt: { gte: from, lte: to } }, orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { amount: true, collectedAmount: true } }),
      this.prisma.payout.groupBy({ by: ['status'], where: { accountId: id, createdAt: { gte: from, lte: to } }, orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.disbursementBatch.findMany({ where: { accountId: id, createdAt: { gte: from, lte: to } }, select: { status: true, totalCount: true, successCount: true, failedCount: true, totalAmount: true } }),
      this.prisma.smsMessage.groupBy({ by: ['status'], where: { accountId: id, createdAt: { gte: from, lte: to } }, orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { cost: true } }),
      this.prisma.bill.groupBy({ by: ['status'], where: { accountId: id, createdAt: { gte: from, lte: to } }, orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { amount: true } }),
    ]);

    // wallet reconciliation (fraud detection): opening + credits - debits == closing
    const wallets = [];
    for (const wallet of account.wallets) {
      const txs = await this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
      });
      const credits = txs.filter((t) => t.amount.greaterThan(0)).reduce((s, t) => s.plus(t.amount), new Prisma.Decimal(0));
      const debits = txs.filter((t) => t.amount.lessThan(0)).reduce((s, t) => s.plus(t.amount), new Prisma.Decimal(0));
      const opening = txs.length > 0 ? new Prisma.Decimal(txs[0].balanceBefore) : new Prisma.Decimal(wallet.balance);
      const closing = txs.length > 0 ? new Prisma.Decimal(txs[txs.length - 1].balanceAfter) : opening;
      const expected = opening.plus(credits).plus(debits); // debits are negative
      const consistent = expected.eq(closing);
      wallets.push({
        walletType: wallet.type,
        currency: wallet.currency,
        status: wallet.status,
        openingBalance: opening.toFixed(2),
        totalCredited: credits.toFixed(2),
        totalDebited: debits.abs().toFixed(2),
        closingBalance: closing.toFixed(2),
        liveBalance: new Prisma.Decimal(wallet.balance).toFixed(2),
        ledgerConsistent: consistent && closing.eq(new Prisma.Decimal(wallet.balance)),
        discrepancy: new Prisma.Decimal(wallet.balance).minus(closing).toFixed(2),
        movements: txs.length,
      });
    }

    const sumBy = (rows: any[]): string =>
      rows.reduce((s, r) => s.plus(r?._sum?.amount ?? 0), new Prisma.Decimal(0)).toFixed(2);
    const countBy = (rows: any[]): number => rows.reduce((s, r) => s + (r?._count?._all ?? 0), 0);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      collection: {
        byStatus: collections.map((c: any) => ({ status: c.status, count: (c._count as any)._all, amount: (c._sum.amount ?? 0).toString() })),
        totalAmount: sumBy(collections),
        totalCount: countBy(collections),
      },
      disbursement: {
        byStatus: payouts.map((p: any) => ({ status: p.status, count: (p._count as any)._all, amount: (p._sum.amount ?? 0).toString() })),
        totalAmount: sumBy(payouts),
        totalCount: countBy(payouts),
      },
      batches: {
        count: batches.length,
        totals: batches.reduce((acc, b) => ({ items: acc.items + b.totalCount, success: acc.success + b.successCount, failed: acc.failed + b.failedCount, amount: acc.amount + Number(b.totalAmount) }), { items: 0, success: 0, failed: 0, amount: 0 }),
      },
      sms: {
        byStatus: sms.map((s: any) => ({ status: s.status, count: (s._count as any)._all })),
        totalCount: countBy(sms),
      },
      bills: {
        byStatus: bills.map((b: any) => ({ status: b.status, count: (b._count as any)._all, amount: (b._sum.amount ?? 0).toString() })),
        outstanding: bills.filter((b: any) => b.status === 'PENDING').reduce((s: Prisma.Decimal, b: any) => s.plus(b._sum.amount ?? 0), new Prisma.Decimal(0)).toFixed(2),
      },
      wallets,
      // success ratios for quick fraud scanning
      ratios: {
        collectionSuccessRate: ratio((collections.find((c: any) => c.status === 'SUCCESS')?._count as any)?._all ?? 0, countBy(collections)),
        payoutSuccessRate: ratio((payouts.find((p: any) => p.status === 'SUCCESS')?._count as any)?._all ?? 0, countBy(payouts)),
        netFlow: (Number(sumBy(collections)) - Number(sumBy(payouts))).toFixed(2),
      },
    };
  }

  // ----------------------------- Traces ---------------------------------

  async traces(filters: { traceId?: string; reference?: string; accountId?: string; component?: string; skip: number; take: number }) {
    let traceId = filters.traceId;
    if (!traceId && filters.reference) {
      // resolve a service reference (20 chars) to its trace
      const [collection, payout, sms, batch] = await Promise.all([
        this.prisma.collection.findFirst({ where: { reference: filters.reference }, select: { traceId: true } }),
        this.prisma.payout.findFirst({ where: { reference: filters.reference }, select: { traceId: true } }),
        this.prisma.smsMessage.findFirst({ where: { reference: filters.reference }, select: { traceId: true } }),
        this.prisma.disbursementBatch.findFirst({ where: { reference: filters.reference }, select: { traceId: true } }),
      ]);
      traceId = collection?.traceId ?? payout?.traceId ?? sms?.traceId ?? batch?.traceId ?? undefined;
      if (!traceId) return { items: [], total: 0, resolvedTraceId: null };
    }
    const where: Prisma.TraceSpanWhereInput = {
      ...(traceId ? { traceId } : {}),
      ...(filters.component ? { component: filters.component } : {}),
    };
    // NOTE: trace lookups by account require join via analytics/audit; spans
    // carry the traceId used across the whole operation chain.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.traceSpan.findMany({ where, orderBy: { createdAt: 'asc' }, skip: filters.skip, take: filters.take }),
      this.prisma.traceSpan.count({ where }),
    ]);
    return { items, total, resolvedTraceId: traceId ?? null };
  }
}

function ratio(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 1000) / 10;
}
