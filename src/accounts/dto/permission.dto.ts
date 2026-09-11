import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ServiceKey } from '@prisma/client';
import { Type } from 'class-transformer';

export class ApiKeyResponseDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsString()
  prefix!: string;
}

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;
}

export class PermissionItemDto {
  @IsEnum(ServiceKey)
  service!: ServiceKey;

  @IsBoolean()
  granted!: boolean;

  /** { channels: ["MOBILE_MONEY","BANK"], payAsYouGo: true, walletActions: true } */
  @IsOptional()
  @IsObject()
  meta?: Record<string, any>;
}

export class SetPermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PermissionItemDto)
  permissions!: PermissionItemDto[];
}

export const ALLOWED_CHANNELS = ['MOBILE_MONEY', 'BANK'] as const;
