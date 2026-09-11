import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MobileMethod, SettlementType } from '@prisma/client';
import { Request } from 'express';
import { SettlementsService } from './settlements.service';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/auth.decorators';

export class SettlementAccountDto {
  @IsEnum(SettlementType)
  type!: SettlementType;

  @IsOptional()
  @IsEnum(MobileMethod)
  method?: MobileMethod;

  @IsOptional()
  @Matches(/^(\+?255|0)?[67]\d{8}$/, { message: 'phoneNumber must be a valid Tanzanian mobile number' })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  bankInitials?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountName?: string;
}

export class UpdateSettlementDto extends SettlementAccountDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class AutoSweepDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('admin/settlements')
@ApiSecurity('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/accounts/:accountId/settlement')
export class AdminSettlementController {
  constructor(private readonly settlements: SettlementsService) {}

  @Roles('ADMIN', 'SERVICEMAN')
  @Get()
  list(@Param('accountId') accountId: string) {
    return this.settlements.listSettlementAccounts(accountId);
  }

  @Roles('ADMIN')
  @Post()
  create(@Param('accountId') accountId: string, @Body() dto: SettlementAccountDto, @Req() req: Request & { user?: JwtPayload; traceId?: string }) {
    return this.settlements.upsertSettlementAccount(accountId, dto, {
      actorType: 'ADMIN',
      actorId: req.user?.sub,
      traceId: req.traceId,
    });
  }

  // NOTE: static segments must be declared before the :settlementId route
  @Roles('ADMIN')
  @Put('auto-sweep')
  setAutoSweep(@Param('accountId') accountId: string, @Body() dto: AutoSweepDto) {
    return this.settlements.setAutoSweep(accountId, dto.enabled === true);
  }

  @Roles('ADMIN')
  @Post('sweep-now')
  sweepNow(@Param('accountId') accountId: string, @Req() req: Request & { traceId?: string }) {
    return this.settlements.sweepNow(accountId, req.traceId);
  }

  @Roles('ADMIN')
  @Put(':settlementId')
  update(
    @Param('accountId') accountId: string,
    @Param('settlementId') settlementId: string,
    @Body() dto: UpdateSettlementDto,
  ) {
    return this.settlements.updateSettlementAccount(accountId, settlementId, dto);
  }
}
