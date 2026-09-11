import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { AssignPlanDto, CreateBillDto, CreatePlanDto } from './dto/billing.dto';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/auth.decorators';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

function ctxOf(req: Request & { user?: JwtPayload; traceId?: string }) {
  return {
    ip: req.ip,
    ua: req.headers['user-agent'] as string | undefined,
    traceId: req.traceId,
    admin: { id: req.user?.sub ?? 'system', name: req.user?.name ?? 'system' },
  };
}

@ApiTags('billing')
@ApiSecurity('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Roles('ADMIN')
  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    return this.billing.createPlan(dto, ctxOf(req).admin, ctxOf(req));
  }

  @Roles('ADMIN', 'SERVICEMAN')
  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @Roles('ADMIN')
  @Post('accounts/:accountId/plan')
  assignPlan(@Param('accountId') accountId: string, @Body() dto: AssignPlanDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    const { admin, ...ctx } = ctxOf(req);
    return this.billing.assignPlan(accountId, dto.planId, admin, ctx);
  }

  /** Manual bill assignment — note some accounts operate without any bills. */
  @Roles('ADMIN')
  @Post('accounts/:accountId/bills')
  createBill(@Param('accountId') accountId: string, @Body() dto: CreateBillDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    const { admin, ...ctx } = ctxOf(req);
    return this.billing.createBill(accountId, dto, admin, ctx);
  }

  @Roles('ADMIN')
  @Post('accounts/:accountId/bills/:billId/paid')
  markPaid(@Param('accountId') accountId: string, @Param('billId') billId: string, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    const { admin, ...ctx } = ctxOf(req);
    return this.billing.markBillPaid(accountId, billId, admin, ctx);
  }

  @Roles('ADMIN', 'SERVICEMAN')
  @Get('accounts/:accountId/bills')
  async listBills(@Param('accountId') accountId: string, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.billing.listBills(accountId, { ...pagination, status: req.query.status });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }
}
