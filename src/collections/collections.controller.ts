import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ServiceKey } from '@prisma/client';
import { Request } from 'express';
import { CollectionsService } from './collections.service';
import { UssdPushInitiateDto, UssdPushPreviewDto } from './dto/collection.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ServicePermissionGuard } from '../common/guards/service-permission.guard';
import { RequireService } from '../common/decorators/auth.decorators';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

@ApiTags('collections')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, ServicePermissionGuard)
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @RequireService(ServiceKey.COLLECTION, 'MOBILE_MONEY')
  @Post('ussd-push/preview')
  preview(@CurrentAccount() account: RequestAccount, @Body() dto: UssdPushPreviewDto, @Req() req: Request & { traceId?: string }) {
    return this.collections.preview(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.COLLECTION, 'MOBILE_MONEY')
  @Post('ussd-push')
  initiate(@CurrentAccount() account: RequestAccount, @Body() dto: UssdPushInitiateDto, @Req() req: Request & { traceId?: string }) {
    return this.collections.initiate(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.COLLECTION)
  @Get()
  async list(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.collections.list(account.id, { ...pagination, status: req.query.status });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @RequireService(ServiceKey.COLLECTION)
  @Get(':reference')
  get(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.collections.get(account.id, reference.toUpperCase());
  }

  @RequireService(ServiceKey.COLLECTION)
  @Post(':reference/refresh')
  refresh(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.collections.refreshStatus(account.id, reference.toUpperCase());
  }
}
