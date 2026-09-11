import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { Roles } from '../common/decorators/auth.decorators';
import { CurrentAccount, CurrentUser, RequestAccount } from '../common/decorators/current.decorators';
import { CreateAccountDto, SuspendAccountDto, UpdateAccountDto } from './dto/account.dto';
import { CreateApiKeyDto, SetPermissionsDto } from './dto/permission.dto';
import { paginationFrom, paginationMeta } from '../common/pagination.middleware';

function ctxOf(req: Request & { traceId?: string; user?: JwtPayload }) {
  return {
    ip: req.ip,
    ua: req.headers['user-agent'] as string | undefined,
    traceId: req.traceId,
    admin: { id: (req.user as JwtPayload)?.sub ?? 'system', name: (req.user as JwtPayload)?.name ?? 'system' },
  };
}

@ApiTags('accounts')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('me')
export class AccountSelfController {
  constructor(private readonly accounts: AccountsService) {}

  /** The account's own profile: identity, granted services, wallets, plan. */
  @Get()
  me(@CurrentAccount() account: RequestAccount) {
    return this.accounts.profile(account.id);
  }
}

@ApiTags('admin/accounts')
@ApiSecurity('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Step 1 — admin opens the account on behalf of the owner. */
  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateAccountDto, @Req() req: Request & { traceId?: string; user?: JwtPayload }) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.create(dto, admin, { ip, ua, traceId });
  }

  @Roles('ADMIN', 'SERVICEMAN')
  @Get()
  async list(@Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.accounts.list({
      ...pagination,
      status: req.query.status,
      search: req.query.search,
    });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @Roles('ADMIN', 'SERVICEMAN')
  @Get(':accountId')
  getByPublicId(@Param('accountId') accountId: string) {
    return this.accounts.getByPublicId(accountId);
  }

  @Roles('ADMIN')
  @Patch(':accountId')
  update(@Param('accountId') accountId: string, @Body() dto: UpdateAccountDto, @Req() req: any) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.update(accountId, dto, admin, { ip, ua, traceId });
  }

  @Roles('ADMIN')
  @Post(':accountId/suspend')
  suspend(@Param('accountId') accountId: string, @Body() dto: SuspendAccountDto, @Req() req: any) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.suspend(accountId, dto, admin, { ip, ua, traceId });
  }

  @Roles('ADMIN')
  @Post(':accountId/activate')
  activate(@Param('accountId') accountId: string, @Req() req: any) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.activate(accountId, admin, { ip, ua, traceId });
  }

  @Roles('ADMIN')
  @Post(':accountId/api-keys')
  issueApiKey(@Param('accountId') accountId: string, @Body() dto: CreateApiKeyDto, @Req() req: any) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.issueApiKey(accountId, dto.name ?? 'default', admin, { ip, ua, traceId });
  }

  @Roles('ADMIN')
  @Delete(':accountId/api-keys/:keyId')
  revokeApiKey(@Param('accountId') accountId: string, @Param('keyId') keyId: string, @Req() req: any) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.revokeApiKey(accountId, keyId, admin, { ip, ua, traceId });
  }

  /** Step 2 — admin assigns service permissions. */
  @Roles('ADMIN')
  @Put(':accountId/permissions')
  setPermissions(@Param('accountId') accountId: string, @Body() dto: SetPermissionsDto, @Req() req: any) {
    const { ip, ua, traceId, admin } = ctxOf(req);
    return this.accounts.setPermissions(accountId, dto, admin, { ip, ua, traceId });
  }
}
