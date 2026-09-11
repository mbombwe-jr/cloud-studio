import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, ActorType, BillingMode, Prisma, ServiceKey, SettlementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateSourceCode } from '../common/utils/reference.util';
import { createRandomId, generateApiKey } from '../common/utils/api-key.util';
import { normalizePhoneNumber } from '../common/utils/phone.util';
import { AuditService } from '../audit/audit.service';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiTracingService } from '../iii/tracing.service';
import { CreateAccountDto, SuspendAccountDto, UpdateAccountDto } from './dto/account.dto';
import { PermissionItemDto, SetPermissionsDto } from './dto/permission.dto';

const ACCOUNT_INCLUDE = {
  permissions: true,
  wallets: { select: { id: true, type: true, balance: true, currency: true, status: true } },
  apiKeys: { select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true } },
  accountPlan: { include: { plan: true } },
  settlementAccounts: true,
  feeConfig: true,
} satisfies Prisma.AccountInclude;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly analytics: IiiAnalyticsService,
    private readonly tracing: IiiTracingService,
  ) {}

  /**
   * Admin opens the account on behalf of the account owner:
   *  - generates the public accountId (ACC-XXXXXXXX) and the unique 5-char
   *    sourceCode that prefixes all of the account's service references;
   *  - provisions both wallets (COLLECTION & DISBURSEMENT);
   *  - creates permission rows for every service, all denied until granted.
   */
  async create(dto: CreateAccountDto, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const sourceCode = await this.uniqueSourceCode();
    const accountId = `ACC-${createRandomId(8)}`;

    // validated settlement payload (requirement #1)
    let settlement: Prisma.SettlementAccountUncheckedCreateInput | undefined;
    if (dto.settlement) {
      if (dto.settlement.type === SettlementType.MOBILE) {
        if (!dto.settlement.method || !dto.settlement.phoneNumber) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Mobile settlement requires method (AIRTEL/TIGO/VODACOM/HALOPESA) and phoneNumber' });
        }
        const phone = normalizePhoneNumber(dto.settlement.phoneNumber);
        if (!phone) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Settlement phoneNumber is not a valid Tanzanian mobile number' });
        settlement = { type: 'MOBILE', method: dto.settlement.method, phoneNumber: phone, accountId: '' } as Prisma.SettlementAccountUncheckedCreateInput;
      } else {
        if (!dto.settlement.accountNumber || !dto.settlement.bankName) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Bank settlement requires accountNumber and bankName' });
        }
        settlement = {
          type: 'BANK',
          bankName: dto.settlement.bankName.trim(),
          bankInitials: dto.settlement.bankInitials?.trim().toUpperCase() ?? null,
          accountNumber: dto.settlement.accountNumber.trim(),
          accountName: dto.settlement.accountName?.trim() ?? null,
          accountId: '',
        } as Prisma.SettlementAccountUncheckedCreateInput;
      }
    }

    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          accountName: dto.accountName.trim(),
          accountId,
          sourceCode,
          contactEmail: dto.contactEmail?.toLowerCase().trim(),
          contactPhone: dto.contactPhone,
          billingMode: dto.billingMode ?? BillingMode.NONE,
          autoSweep: dto.autoSweep ?? true,
        },
      });
      await tx.wallet.createMany({
        data: [
          { accountId: created.id, type: 'COLLECTION' },
          { accountId: created.id, type: 'DISBURSEMENT' },
        ],
      });
      await tx.servicePermission.createMany({
        data: (Object.values(ServiceKey) as string[]).map((service) => ({
          accountId: created.id,
          service: service as ServiceKey,
          granted: false,
          grantedBy: admin.id,
        })),
      });
      if (settlement) {
        await tx.settlementAccount.create({ data: { ...settlement, accountId: created.id, isDefault: true } as Prisma.SettlementAccountUncheckedCreateInput });
      }
      if (dto.fees) {
        const clamp = (n: number | undefined) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10000 ? n : undefined);
        await tx.feeConfig.create({
          data: {
            accountId: created.id,
            ...(clamp(dto.fees.collectionBelowBps) !== undefined ? { collectionBelowBps: clamp(dto.fees.collectionBelowBps)! } : {}),
            ...(dto.fees.collectionThreshold ? { collectionThreshold: new Prisma.Decimal(dto.fees.collectionThreshold) } : {}),
            ...(clamp(dto.fees.collectionAboveBps) !== undefined ? { collectionAboveBps: clamp(dto.fees.collectionAboveBps)! } : {}),
            ...(clamp(dto.fees.disbursementBelowBps) !== undefined ? { disbursementBelowBps: clamp(dto.fees.disbursementBelowBps)! } : {}),
            ...(dto.fees.disbursementThreshold ? { disbursementThreshold: new Prisma.Decimal(dto.fees.disbursementThreshold) } : {}),
            ...(clamp(dto.fees.disbursementAboveBps) !== undefined ? { disbursementAboveBps: clamp(dto.fees.disbursementAboveBps)! } : {}),
            ...(clamp(dto.fees.transferBps) !== undefined ? { transferBps: clamp(dto.fees.transferBps)! } : {}),
          },
        });
      }
      return tx.account.findUniqueOrThrow({
        where: { id: created.id },
        include: { wallets: true, permissions: true, apiKeys: { select: { id: true, name: true, prefix: true } } },
      });
    });

    // first API key is issued immediately (returned once, plaintext never stored)
    const apiKey = await this.issueApiKey(account.id, 'default', admin, ctx);

    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: account.id,
      action: 'account.created', entity: 'Account', entityId: account.id,
      changes: { accountName: account.accountName, sourceCode }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    this.analytics.track('account.created', { accountId: account.id, traceId: ctx.traceId });

    return { account, apiKey };
  }

  private async uniqueSourceCode(): Promise<string> {
    for (let i = 0; i < 25; i++) {
      const code = generateSourceCode();
      const clash = await this.prisma.account.findUnique({ where: { sourceCode: code }, select: { id: true } });
      if (!clash) return code;
    }
    throw new BadRequestException('Unable to allocate a unique source code, retry');
  }

  /** Issues a new API key. The plaintext is returned exactly once. */
  async issueApiKey(
    accountId: string,
    name: string,
    admin: { id: string; name: string },
    ctx: { ip?: string; ua?: string; traceId?: string },
  ) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    const generated = generateApiKey(this.config.get('apiKeyPrefix') || 'zs');
    const row = await this.prisma.apiKey.create({
      data: { accountId: resolved, name: name || 'default', prefix: generated.displayPrefix, keyHash: generated.hash },
    });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: resolved,
      action: 'api_key.created', entity: 'ApiKey', entityId: row.id,
      ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt, apiKey: generated.full };
  }

  async revokeApiKey(accountId: string, keyId: string, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, accountId: resolved } });
    if (!key) throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found for this account' });
    if (key.revokedAt) return { id: key.id, revoked: true, revokedAt: key.revokedAt };
    const updated = await this.prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: resolved,
      action: 'api_key.revoked', entity: 'ApiKey', entityId: key.id,
      ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    return { id: updated.id, revoked: true, revokedAt: updated.revokedAt };
  }

  async list(params: { skip: number; take: number; status?: AccountStatus; search?: string }) {
    const where: Prisma.AccountWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              { accountName: { contains: params.search, mode: 'insensitive' } },
              { accountId: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.account.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take, include: { wallets: true } }),
      this.prisma.account.count({ where }),
    ]);
    return { items, total };
  }

  async getByPublicId(accountPublicId: string) {
    // accepts the public accountId (ACC-XXXXXXXX) or the internal row id
    let account = await this.prisma.account.findUnique({
      where: { accountId: accountPublicId },
      include: ACCOUNT_INCLUDE as Prisma.AccountInclude,
    });
    if (!account) {
      account = await this.prisma.account.findUnique({
        where: { id: accountPublicId },
        include: ACCOUNT_INCLUDE as Prisma.AccountInclude,
      });
    }
    if (!account) throw new NotFoundException({ code: 'NOT_FOUND', message: `Account ${accountPublicId} not found` });
    return account;
  }

  async getEntity(accountId: string) {
    // accepts the public accountId (ACC-XXXXXXXX) or the internal row id
    const resolved = await this.prisma.resolveAccountId(accountId);
    const account = resolved
      ? await this.prisma.account.findUnique({ where: { id: resolved }, include: ACCOUNT_INCLUDE as Prisma.AccountInclude })
      : null;
    if (!account) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    return account;
  }

  async update(accountId: string, dto: UpdateAccountDto, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const before = await this.getEntity(accountId);
    const updated = await this.prisma.account.update({
      where: { id: before.id },
      data: {
        ...(dto.accountName ? { accountName: dto.accountName.trim() } : {}),
        ...(dto.contactEmail ? { contactEmail: dto.contactEmail.toLowerCase().trim() } : {}),
        ...(dto.contactPhone ? { contactPhone: dto.contactPhone } : {}),
      },
    });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: before.id,
      action: 'account.updated', entity: 'Account', entityId: before.id,
      changes: { before: { accountName: before.accountName }, after: { accountName: updated.accountName } },
      ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    return updated;
  }

  /** All suspensions are performed manually by the admin — never automatic. */
  async suspend(accountId: string, dto: SuspendAccountDto, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const account = await this.getEntity(accountId);
    if (account.status === AccountStatus.SUSPENDED) return account;
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: { status: AccountStatus.SUSPENDED, suspendedBy: admin.id, suspendReason: dto.suspendReason },
    });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: account.id,
      action: 'account.suspended', entity: 'Account', entityId: account.id,
      changes: { reason: dto.suspendReason }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    this.analytics.track('account.suspended', { accountId: account.id, traceId: ctx.traceId });
    return updated;
  }

  async activate(accountId: string, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const account = await this.getEntity(accountId);
    if (account.status === AccountStatus.ACTIVE) return account;
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: { status: AccountStatus.ACTIVE, suspendedBy: null, suspendReason: null },
    });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: account.id,
      action: 'account.activated', entity: 'Account', entityId: account.id,
      ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    this.analytics.track('account.activated', { accountId: account.id, traceId: ctx.traceId });
    return updated;
  }

  /** Grants/revokes service permissions. Accounts start with none granted. */
  async setPermissions(accountId: string, dto: SetPermissionsDto, admin: { id: string; name: string }, ctx: { ip?: string; ua?: string; traceId?: string }) {
    const resolved = await this.prisma.resolveAccountId(accountId);
    if (!resolved) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    const items: PermissionItemDto[] = dto.permissions;
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.servicePermission.upsert({
          where: { accountId_service: { accountId: resolved, service: item.service } },
          create: {
            accountId: resolved,
            service: item.service,
            granted: item.granted,
            meta: (item.meta ?? undefined) as Prisma.InputJsonValue,
            grantedBy: admin.id,
          },
          update: {
            granted: item.granted,
            meta: (item.meta ?? undefined) as Prisma.InputJsonValue,
            grantedBy: admin.id,
          },
        }),
      ),
    );
    const permissions = await this.prisma.servicePermission.findMany({ where: { accountId: resolved } });
    this.audit.record({
      actorType: ActorType.ADMIN, actorId: admin.id, actorName: admin.name, accountId: resolved,
      action: 'account.permissions_set', entity: 'ServicePermission', entityId: resolved,
      changes: { permissions: dto.permissions.map((p) => ({ service: p.service, granted: p.granted })) }, ip: ctx.ip, userAgent: ctx.ua, traceId: ctx.traceId,
    });
    return permissions;
  }

  /** Generates the account's own view (used by GET /me). */
  async profile(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: {
        permissions: true,
        wallets: { select: { id: true, type: true, balance: true, currency: true, status: true } },
        senderNames: { where: { type: 'DEDICATED' }, select: { id: true, name: true, isApproved: true } },
        accountPlan: { include: { plan: true } },
        settlementAccounts: true,
        feeConfig: true,
      },
    });
    if (!account) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    const { apiKeys: _omit, ...safe } = account as any;
    return safe;
  }
}
