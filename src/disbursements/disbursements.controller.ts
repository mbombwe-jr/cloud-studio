import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ServiceKey } from '@prisma/client';
import { Request } from 'express';
import { DisbursementsService } from './disbursements.service';
import { BankPayoutDto, CreateBatchDto, MobileMoneyPayoutDto, MnoPayoutPreviewDto } from './dto/disbursement.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ServicePermissionGuard } from '../common/guards/service-permission.guard';
import { RequireService } from '../common/decorators/auth.decorators';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

@ApiTags('disbursements')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, ServicePermissionGuard)
@Controller('disbursements')
export class DisbursementsController {
  constructor(private readonly disbursements: DisbursementsService) {}

  @RequireService(ServiceKey.DISBURSEMENT, 'MOBILE_MONEY')
  @Post('mobile-money/preview')
  previewMobileMoney(@CurrentAccount() account: RequestAccount, @Body() dto: MnoPayoutPreviewDto, @Req() req: Request & { traceId?: string }) {
    return this.disbursements.previewMobileMoneyPayout(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.DISBURSEMENT, 'MOBILE_MONEY')
  @Post('mobile-money')
  mobileMoney(@CurrentAccount() account: RequestAccount, @Body() dto: MobileMoneyPayoutDto, @Req() req: Request & { traceId?: string }) {
    return this.disbursements.createPayout(account.id, 'MOBILE_MONEY', dto, req.traceId);
  }

  @RequireService(ServiceKey.DISBURSEMENT, 'BANK')
  @Post('bank')
  bank(@CurrentAccount() account: RequestAccount, @Body() dto: BankPayoutDto, @Req() req: Request & { traceId?: string }) {
    return this.disbursements.createPayout(account.id, 'BANK', dto, req.traceId);
  }

  @RequireService(ServiceKey.DISBURSEMENT)
  @Post('batches')
  batch(@CurrentAccount() account: RequestAccount, @Body() dto: CreateBatchDto, @Req() req: Request & { traceId?: string }) {
    return this.disbursements.createBatch(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.DISBURSEMENT)
  @Get()
  async list(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.disbursements.listPayouts(account.id, { ...pagination, status: req.query.status });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @RequireService(ServiceKey.DISBURSEMENT)
  @Get('batches')
  async batches(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.disbursements.listBatches(account.id, pagination);
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @RequireService(ServiceKey.DISBURSEMENT)
  @Get('batches/:reference')
  batchByRef(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.disbursements.getBatch(account.id, reference.toUpperCase());
  }

  @RequireService(ServiceKey.DISBURSEMENT)
  @Get(':reference')
  byRef(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.disbursements.getPayout(account.id, reference.toUpperCase());
  }
}
