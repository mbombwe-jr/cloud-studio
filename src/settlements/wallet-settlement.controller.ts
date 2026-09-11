import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@prisma/client';
import { Request } from 'express';
import { SettlementsService } from './settlements.service';
import { WalletWithdrawalDto } from '../wallets/dto/wallet.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

/**
 * Account-facing wallet settlement endpoints (requirement #5):
 * mounted under /wallets alongside the ledger routes, but owned by the
 * settlements module so no circular module dependency exists.
 */
@ApiTags('wallets')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('wallets')
export class WalletSettlementController {
  constructor(private readonly settlements: SettlementsService) {}

  /**
   * Manual settlement: moves a specific amount from the COLLECTION wallet
   * to the customer's settlement account via the payout rail
   * (bank -> bank payout, phone -> mobile payout).
   */
  @Post('withdrawals')
  withdrawToSettlement(@CurrentAccount() account: RequestAccount, @Body() dto: WalletWithdrawalDto, @Req() req: Request & { traceId?: string }) {
    return this.settlements.createWithdrawal(account.id, dto, ActorType.API_KEY, account.apiKeyId, req.traceId);
  }

  @Get('withdrawals')
  async withdrawals(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.settlements.listWithdrawals(account.id, pagination);
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  /** The account's own settlement accounts (where funds settle). */
  @Get('settlement-accounts')
  listSettlementAccounts(@CurrentAccount() account: RequestAccount) {
    return this.settlements.listSettlementAccounts(account.id);
  }
}
