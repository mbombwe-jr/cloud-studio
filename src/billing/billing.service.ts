import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BillStatus, BillType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiTracingService } from '../iii/tracing.service';
import { ErrorCodes } from '../common/constants';
import { CreateBillDto, CreatePlanDto } from './dto/billing.dto';

/**
 * Billing: plans (recurring subscriptions), manual bills, and pay-as-you-go
 * bills. Per spec: some accounts operate without bills and NO automatic
 * suspension ever happens for unpaid bills — suspension is admin-only.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
  ) {}

  async createPlan(dto: CreatePlanDto, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const name = dto.name.trim();
    const clash = await this.prisma.plan.findUnique({ where: { name } });
    if (clash) {
      throw new ConflictException({ code: ErrorCodes.VALIDATION_FAILED, message: 'A plan with this name already exists' });
    }
    const plan = await this.prisma.plan.create({
      data: {
        name,
        description: dto.description,
        services: dto.services,
        recurringAmount: new Prisma.Decimal(dto.recurringAmount),
        periodDays: dto.periodDays ?? 30,
      },
    });
    this.audit.record({ actorType: 'ADMIN', actorId: admin.id, actorName: admin.name, action: 'plan.created', entity: 'Plan', entityId: plan.id, changes: { name: plan.name }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId });
    return plan;
  }

  async listPlans() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Assigns the current plan & recurring amount to the account. */
  async assignPlan(accountId: string, planId: string, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Plan not found' });
    const resolved = await this.prisma.resolveAccountId(accountId);
    const account = resolved ? await this.prisma.account.findUnique({ where: { id: resolved } }) : null;
    if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const id = resolved as string;

    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + plan.periodDays);

    const accountPlan = await this.prisma.accountPlan.upsert({
      where: { accountId: id },
      create: {
        accountId: id,
        planId,
        recurringAmount: plan.recurringAmount,
        periodDays: plan.periodDays,
        nextBillingDate,
        status: BillStatus.PENDING,
      },
      update: { planId, recurringAmount: plan.recurringAmount, periodDays: plan.periodDays, nextBillingDate },
      include: { plan: true },
    });

    // keep the account-level billing mode in sync (recurring subscription)
    await this.prisma.account.update({ where: { id }, data: { billingMode: 'SUBSCRIPTION' } });

    // first recurring bill
    await this.prisma.bill.create({
      data: {
        accountId: id,
        type: BillType.SUBSCRIPTION,
        title: `Subscription: ${plan.name}`,
        description: plan.description ?? undefined,
        amount: plan.recurringAmount,
        currency: 'TZS',
        isRecurring: true,
        periodDays: plan.periodDays,
        dueDate: nextBillingDate,
        issuedBy: admin.id,
        metadata: { planId } as Prisma.InputJsonValue,
      },
    });

    this.audit.record({ actorType: 'ADMIN', actorId: admin.id, actorName: admin.name, accountId: id, action: 'account.plan_assigned', entity: 'AccountPlan', entityId: accountPlan.id, changes: { plan: plan.name, recurring: plan.recurringAmount }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId });
    return accountPlan;
  }

  /** Admin manually assigns a bill to the account. */
  async createBill(accountId: string, dto: CreateBillDto, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    const account = resolved ? await this.prisma.account.findUnique({ where: { id: resolved } }) : null;
    if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });
    const id = resolved as string;
    if (dto.type === BillType.SUBSCRIPTION) {
      throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'Subscription bills are generated via plan assignment or the recurring job' });
    }
    const bill = await this.prisma.bill.create({
      data: {
        accountId: id,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        currency: 'TZS',
        isRecurring: dto.isRecurring ?? false,
        periodDays: dto.isRecurring ? dto.periodDays ?? 30 : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        issuedBy: admin.id,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
    this.audit.record({ actorType: 'ADMIN', actorId: admin.id, actorName: admin.name, accountId: id, action: 'bill.created', entity: 'Bill', entityId: bill.id, changes: { amount: dto.amount, type: dto.type, title: dto.title }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId });
    return bill;
  }

  async markBillPaid(accountId: string, billId: string, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    const bill = resolved
      ? await this.prisma.bill.findFirst({ where: { id: billId, accountId: resolved } })
      : null;
    if (!bill) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Bill not found' });
    const updated = await this.prisma.bill.update({
      where: { id: billId },
      data: { status: BillStatus.PAID, paidAt: new Date() },
    });
    this.audit.record({ actorType: 'ADMIN', actorId: admin.id, actorName: admin.name, accountId: resolved as string, action: 'bill.paid', entity: 'Bill', entityId: billId, changes: { amount: String(bill.amount) }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId });
    return updated;
  }

  async listBills(accountId: string, params: { skip: number; take: number; status?: BillStatus }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    const where: Prisma.BillWhereInput = { accountId: resolved ?? '__none__', ...(params.status ? { status: params.status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bill.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.bill.count({ where }),
    ]);
    return { items, total };
  }

  /** Cron: issues the next recurring subscription bill for due accounts. */
  async runRecurringBilling(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.accountPlan.findMany({
      where: { nextBillingDate: { lte: now } },
      include: { plan: true },
      take: 200,
    });
    for (const ap of due) {
      await this.prisma.bill.create({
        data: {
          accountId: ap.accountId,
          type: BillType.SUBSCRIPTION,
          title: `Subscription: ${ap.plan.name}`,
          amount: ap.recurringAmount,
          currency: 'TZS',
          isRecurring: true,
          periodDays: ap.periodDays,
          dueDate: ap.nextBillingDate ?? now,
          issuedBy: 'system',
          metadata: { planId: ap.planId } as Prisma.InputJsonValue,
        },
      });
      const next = new Date(ap.nextBillingDate ?? now);
      next.setDate(next.getDate() + ap.periodDays);
      await this.prisma.accountPlan.update({
        where: { id: ap.id },
        data: { nextBillingDate: next },
      });
      this.analytics.track('bill.issued', { accountId: ap.accountId, value: Number(ap.recurringAmount), dimensions: { type: 'SUBSCRIPTION' } });
    }
    return due.length;
  }
}
