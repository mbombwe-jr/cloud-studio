import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ServiceKey } from '@prisma/client';
import { Request } from 'express';
import { SmsService } from './sms.service';
import { SendSmsDto } from './dto/sms.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ServicePermissionGuard } from '../common/guards/service-permission.guard';
import { RequireService } from '../common/decorators/auth.decorators';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

@ApiTags('sms')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, ServicePermissionGuard)
@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @RequireService(ServiceKey.SMS)
  @Post('send')
  send(@CurrentAccount() account: RequestAccount, @Body() dto: SendSmsDto, @Req() req: Request & { traceId?: string }) {
    return this.sms.send(account.id, dto, req.traceId);
  }

  @RequireService(ServiceKey.SMS)
  @Get('sender-names')
  senderNames(@CurrentAccount() account: RequestAccount) {
    return this.sms.senderNames(account.id);
  }

  /** Full SMS history for the account (spec requirement). */
  @RequireService(ServiceKey.SMS)
  @Get()
  async list(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.sms.list(account.id, { ...pagination, status: req.query.status });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @RequireService(ServiceKey.SMS)
  @Get(':reference')
  get(@CurrentAccount() account: RequestAccount, @Param('reference') reference: string) {
    return this.sms.get(account.id, reference.toUpperCase());
  }
}
