import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Resolves an account identifier that may be either the internal row id
   * (cuid) or the public accountId (ACC-XXXXXXXX) to the internal row id.
   *
   * All admin account-scoped routes accept BOTH forms so that API consumers
   * never need to know about internal database ids. Returns null when no
   * account matches (callers map that to their own 404 semantics).
   */
  async resolveAccountId(idOrPublicId: string): Promise<string | null> {
    if (!idOrPublicId) return null;
    const byId = await this.account.findUnique({ where: { id: idOrPublicId }, select: { id: true } });
    if (byId) return byId.id;
    const byPublic = await this.account.findUnique({ where: { accountId: idOrPublicId }, select: { id: true } });
    return byPublic?.id ?? null;
  }
}
