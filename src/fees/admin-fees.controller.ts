import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { FeesService } from './fees.service';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/auth.decorators';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateFeeConfigDto {
  @IsOptional() @IsInt() @Min(0) @Max(10000) collectionBelowBps?: number;
  @IsOptional() @IsString() collectionThreshold?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) collectionAboveBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) disbursementBelowBps?: number;
  @IsOptional() @IsString() disbursementThreshold?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) disbursementAboveBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) transferBps?: number;
}

@ApiTags('admin/fees')
@ApiSecurity('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/accounts/:accountId/fees')
export class AdminFeeController {
  constructor(private readonly fees: FeesService) {}

  @Roles('ADMIN', 'SERVICEMAN')
  @Get()
  get(@Param('accountId') accountId: string) {
    return this.fees.getConfig(accountId);
  }

  @Roles('ADMIN')
  @Put()
  update(@Param('accountId') accountId: string, @Body() dto: UpdateFeeConfigDto) {
    return this.fees.updateConfig(accountId, dto);
  }
}
