import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ActorType, WalletType } from '@prisma/client';
import { Request } from 'express';
import { WalletsService } from './wallets.service';
import { WalletAmountDto, WalletTransferDto } from './dto/wallet.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/auth.decorators';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { ServicePermissionGuard } from '../common/guards/service-permission.guard';
import { RequireService } from '../common/decorators/auth.decorators';
import { PaginationMiddleware, paginationFrom, paginationMeta } from '../common/pagination.middleware';
import { ErrorCodes } from '../common/constants';

@ApiTags('wallets')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  list(@CurrentAccount() account: RequestAccount) {
    return this.wallets.getWallets(account.id);
  }

  @Get(':type/transactions')
  async transactions(@CurrentAccount() account: RequestAccount, @Param('type') type: WalletType, @Req() req: any) {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const pagination = paginationFrom(req);
    const { items, total } = await this.wallets.getTransactions(account.id, type, {
      skip: pagination.skip,
      take: pagination.take,
      from,
      to,
    });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  /**
   * Deposit into an account wallet via API. Requires the admin to have set
   * `walletActions: true` on the corresponding service permission
   * (secure-first default: denied).
   */
  @Post(':type/deposit')
  deposit(@CurrentAccount() account: RequestAccount, @Param('type') type: WalletType, @Body() dto: WalletAmountDto, @Req() req: Request & { traceId?: string }) {
    this.assertWalletActions(account, type);
    return this.wallets.move({
      accountId: account.id,
      type,
      txType: 'DEPOSIT',
      amount: dto.amount,
      description: `API deposit: ${dto.reason}`,
      reference: dto.reference,
      actorType: ActorType.API_KEY,
      actorId: account.apiKeyId,
      traceId: req.traceId,
      metadata: { reason: dto.reason, via: 'api' },
    });
  }

  /** Withdraw from an account wallet via API — same walletActions gate. */
  @Post(':type/withdraw')
  withdraw(@CurrentAccount() account: RequestAccount, @Param('type') type: WalletType, @Body() dto: WalletAmountDto, @Req() req: Request & { traceId?: string }) {
    this.assertWalletActions(account, type);
    return this.wallets.move({
      accountId: account.id,
      type,
      txType: 'WITHDRAWAL',
      amount: dto.amount,
      description: `API withdrawal: ${dto.reason}`,
      reference: dto.reference,
      actorType: ActorType.API_KEY,
      actorId: account.apiKeyId,
      traceId: req.traceId,
      metadata: { reason: dto.reason, via: 'api' },
    });
  }

  /**
   * Internal instant transfer COLLECTION -> DISBURSEMENT (requirement #6),
   * charged at the account's custom transfer fee (default 2%).
   */
  @Post('transfers')
  transfer(@CurrentAccount() account: RequestAccount, @Body() dto: WalletTransferDto, @Req() req: Request & { traceId?: string }) {
    return this.wallets.transferCollectionToDisbursement(account.id, dto, ActorType.API_KEY, account.apiKeyId, req.traceId);
  }

  @Get('transfers')
  async transfers(@CurrentAccount() account: RequestAccount, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.wallets.listTransfers(account.id, pagination);
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  private assertWalletActions(account: RequestAccount, type: WalletType) {
    const service = type === WalletType.COLLECTION ? 'COLLECTION' : 'DISBURSEMENT';
    const permission = account.permissions.find((p) => p.service === service);
    if (!permission?.granted || permission.meta?.walletActions !== true) {
      throw new ForbiddenException({
        code: ErrorCodes.WALLET_ACTIONS_NOT_GRANTED,
        message: `Wallet deposit/withdrawal requires "walletActions" permission on the ${service} service`,
      });
    }
  }
}

@ApiTags('admin/wallets')
@ApiSecurity('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/accounts/:accountId/wallets')
export class AdminWalletController {
  constructor(private readonly wallets: WalletsService) {}

  @Roles('ADMIN', 'SERVICEMAN')
  @Get()
  list(@Param('accountId') accountId: string) {
    return this.wallets.getWallets(accountId);
  }

  @Roles('ADMIN', 'SERVICEMAN')
  @Get(':type/transactions')
  async transactions(@Param('accountId') accountId: string, @Param('type') type: WalletType, @Req() req: any) {
    const pagination = paginationFrom(req);
    const { items, total } = await this.wallets.getTransactions(accountId, type, { skip: pagination.skip, take: pagination.take });
    return { data: items, meta: { pagination: paginationMeta(total, pagination.page, pagination.limit) } };
  }

  @Roles('ADMIN')
  @Post(':type/deposit')
  deposit(@Param('accountId') accountId: string, @Param('type') type: WalletType, @Body() dto: WalletAmountDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    return this.wallets.move({
      accountId,
      type,
      txType: 'DEPOSIT',
      amount: dto.amount,
      description: `Admin deposit: ${dto.reason}`,
      reference: dto.reference,
      actorType: ActorType.ADMIN,
      actorId: (req.user as JwtPayload)?.sub,
      traceId: req.traceId,
      metadata: { reason: dto.reason, via: 'admin' },
    });
  }

  @Roles('ADMIN')
  @Post(':type/withdraw')
  withdraw(@Param('accountId') accountId: string, @Param('type') type: WalletType, @Body() dto: WalletAmountDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    return this.wallets.move({
      accountId,
      type,
      txType: 'WITHDRAWAL',
      amount: dto.amount,
      description: `Admin withdrawal: ${dto.reason}`,
      reference: dto.reference,
      actorType: ActorType.ADMIN,
      actorId: (req.user as JwtPayload)?.sub,
      traceId: req.traceId,
      metadata: { reason: dto.reason, via: 'admin' },
    });
  }

  @Roles('ADMIN')
  @Post(':type/freeze')
  freeze(@Param('accountId') accountId: string, @Param('type') type: WalletType, @Req() req: any) {
    const { ip, ua, traceId, admin } = adminCtx(req);
    return this.wallets.setFrozen(accountId, type, true, admin, { ip, ua, traceId });
  }

  @Roles('ADMIN')
  @Post(':type/activate')
  activate(@Param('accountId') accountId: string, @Param('type') type: WalletType, @Req() req: any) {
    const { ip, ua, traceId, admin } = adminCtx(req);
    return this.wallets.setFrozen(accountId, type, false, admin, { ip, ua, traceId });
  }
}

function adminCtx(req: Request & { user?: JwtPayload; traceId?: string }) {
  return {
    ip: req.ip,
    ua: req.headers['user-agent'] as string | undefined,
    traceId: req.traceId,
    admin: { id: req.user?.sub ?? 'system', name: req.user?.name ?? 'system' },
  };
}
