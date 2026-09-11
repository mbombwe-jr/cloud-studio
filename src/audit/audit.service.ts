import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  actorType: ActorType;
  actorId?: string;
  actorName?: string;
  accountId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  changes?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  traceId?: string;
}

/** Durable audit trail for every privileged operation. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AuditInput): void {
    this.prisma.auditLog
      .create({
        data: {
          actorType: input.actorType,
          actorId: input.actorId,
          actorName: input.actorName,
          accountId: input.accountId,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          changes: (input.changes ?? undefined) as Prisma.InputJsonValue,
          ip: input.ip,
          userAgent: input.userAgent,
          traceId: input.traceId,
        },
      })
      .catch(() => undefined);
  }

  async list(filters: { accountId?: string; action?: string; actorType?: ActorType; from?: Date; to?: Date; skip: number; take: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actorType ? { actorType: filters.actorType } : {}),
      ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: filters.skip, take: filters.take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
