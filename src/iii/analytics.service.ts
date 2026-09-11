import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Analytics events (one row per event; queried with SQL aggregations).
 * Names used across the platform:
 *   collection.initiated | collection.succeeded | collection.failed
 *   payout.initiated     | payout.succeeded     | payout.failed
 *   batch.created        | batch.completed
 *   sms.sent             | sms.failed           | sms.delivered
 *   wallet.deposit       | wallet.withdraw      | wallet.freeze | wallet.activate
 *   account.created      | account.suspended    | account.activated
 */
@Injectable()
export class IiiAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  track(
    name: string,
    options: { value?: number; accountId?: string; traceId?: string; dimensions?: Record<string, unknown> } = {},
  ): void {
    // fire-and-forget; analytics must never delay or break business flow
    this.prisma.analyticsEvent
      .create({
        data: {
          name,
          value: options.value !== undefined ? new Prisma.Decimal(options.value) : undefined,
          accountId: options.accountId,
          traceId: options.traceId,
          dimensions: (options.dimensions ?? undefined) as any,
        },
      })
      .catch(() => undefined);
  }

  async summary(from: Date, to: Date) {
    const rows = await this.prisma.analyticsEvent.groupBy({
      by: ['name'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { name: true },
      _sum: { value: true },
    });
    return rows
      .map((r) => ({
        event: r.name,
        count: r._count.name,
        totalValue: r._sum.value ? Number(r._sum.value) : null,
      }))
      .sort((a, b) => a.event.localeCompare(b.event));
  }
}
