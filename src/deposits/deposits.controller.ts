import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ServiceKey } from '@prisma/client';
import { Request } from 'express';
import { DepositsService } from './deposits.service';
import { DepositInitiateDto, DepositPreviewDto } from './dto/deposit.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ServicePermissionGuard } from '../common/guards/service-permission.guard';
import { RequireService } from '../common/decorators/auth.decorators';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

/**
 * Wallet deposits (requirement #2). Mounted under /wallets/deposits —
 * the flow mirrors collections: USSD push to the payer, ClickPesa
 * authorisation, then the value lands on the DISBURSEMENT wallet.
 */
@ApiTags('wallets/deposits')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, ServicePermissionGuard)
@Controller('wallets/deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @RequireService(ServiceKey.COLLECTION, 'MOBILE_MONEY')
  @Post('preview')
  preview(@CurrentAccount() account: RequestAccount, @Body() dto: DepositPreviewDto, @Req() req: Request & { traceId?: string }) {
    return this.deposits.preview(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.COLLECTION, 'MOBILE_MONEY')
  @Post()
  initiate(@CurrentAccount() account: RequestAccount, @Body() dto: DepositInitiateDto, @Req() req: Request & { traceId?: string }) {
    return this.deposits.initiate(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.COLLECTION)
  @Get()
  async list(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.deposits.list(account.id, { ...pagination, status: req.query.status });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @RequireService(ServiceKey.COLLECTION)
  @Get(':reference')
  get(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.deposits.get(account.id, reference.toUpperCase());
  }

  @RequireService(ServiceKey.COLLECTION)
  @Post(':reference/refresh')
  refresh(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.deposits.refreshStatus(account.id, reference.toUpperCase());
  }
}
