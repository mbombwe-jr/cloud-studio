import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ActorType, UserRole } from '@prisma/client';
import { Request } from 'express';
import { AdminService } from './admin.service';
import { ComputationsQueryDto, CreateStaffDto } from './dto/admin.dto';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

@ApiTags('admin')
@ApiSecurity('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
    private readonly analytics: IiiAnalyticsService,
  ) {}

  // ------------------------------- Users --------------------------------

  /** Admin creates servicemen (read-only) or additional admins. */
  @Roles('ADMIN')
  @Post('users')
  createStaff(@Body() dto: CreateStaffDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    const ctx = { ip: req.ip, ua: req.headers['user-agent'] as string, traceId: req.traceId, admin: { id: req.user!.sub, name: req.user!.name } };
    return this.admin.createStaff(dto, ctx.admin, ctx);
  }

  @Roles('ADMIN')
  @Get('users')
  listStaff() {
    return this.admin.listStaff();
  }

  // ----------------------------- Overview -------------------------------

  /** Full data preview for one account. */
  @Roles('ADMIN', 'SERVICEMAN')
  @Get('accounts/:accountId/overview')
  async overview(@Param('accountId') accountId: string, @Req() req: any) {
    const tx = paginationFrom(req);
    const sms = paginationFrom(req);
    const result = await this.admin.accountOverview(accountId, { txSkip: tx.skip, txTake: tx.take, smsSkip: sms.skip, smsTake: sms.take });
    if (!result) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    return result;
  }

  /** Computational review: current day / month / custom range. */
  @Roles('ADMIN', 'SERVICEMAN')
  @Get('accounts/:accountId/computations')
  async computations(@Param('accountId') accountId: string, @Query() query: ComputationsQueryDto) {
    const range = this.admin.resolveRange(query);
    const result = await this.admin.computations(accountId, range);
    if (!result) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    return result;
  }

  // ------------------------------ Audit ---------------------------------

  @Roles('ADMIN', 'SERVICEMAN')
  @Get('audit-logs')
  async auditLogs(@Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.audit.list({
      accountId: req.query.accountId,
      action: req.query.action,
      actorType: req.query.actorType ? (String(req.query.actorType).toUpperCase() as ActorType) : undefined,
      from: req.query.from ? new Date(String(req.query.from)) : undefined,
      to: req.query.to ? new Date(String(req.query.to)) : undefined,
      ...pagination,
    });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  // ---------------------------- Analytics -------------------------------

  @Roles('ADMIN', 'SERVICEMAN')
  @Get('analytics/summary')
  async analyticsSummary(@Req() req: any) {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    return { from, to, summary: await this.analytics.summary(from, to) };
  }

  // ------------------------------ Traces --------------------------------

  /** Trace inspection (servicemen included) — full span snapshots preserved. */
  @Roles('ADMIN', 'SERVICEMAN')
  @Get('traces')
  async traces(@Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total, resolvedTraceId } = await this.admin.traces({
      traceId: req.query.traceId,
      reference: req.query.reference,
      component: req.query.component,
      skip: pagination.skip,
      take: pagination.take,
    });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit), resolvedTraceId } };
  }
}
