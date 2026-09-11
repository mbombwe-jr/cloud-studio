import { IsEmail, IsEnum, IsObject, IsOptional, IsString, IsBoolean, MaxLength, MinLength, ValidateNested, Matches } from 'class-validator';
import { BillingMode, MobileMethod, SettlementType } from '@prisma/client';
import { Type } from 'class-transformer';

/** Settlement details captured at onboarding (requirement #1). */
export class SettlementInputDto {
  @IsEnum(SettlementType)
  type!: SettlementType;

  /** Required when type=MOBILE */
  @IsOptional()
  @IsEnum(MobileMethod)
  method?: MobileMethod;

  /** Required when type=MOBILE — Tanzanian mobile number */
  @IsOptional()
  @Matches(/^(\+?255|0)?[67]\d{8}$/, { message: 'phoneNumber must be a valid Tanzanian mobile number' })
  phoneNumber?: string;

  /** Required when type=BANK */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bankName?: string;

  /** Short bank initials/code, e.g. CRDB, NMB (optional but recommended) */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  bankInitials?: string;

  /** Required when type=BANK */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNumber?: string;

  /** Beneficiary name for BANK settlements */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountName?: string;
}

/** Optional per-customer fee overrides (requirement #3) — basis points. */
export class FeeConfigInputDto {
  @IsOptional()
  collectionBelowBps?: number;

  @IsOptional()
  @IsString()
  collectionThreshold?: string;

  @IsOptional()
  collectionAboveBps?: number;

  @IsOptional()
  disbursementBelowBps?: number;

  @IsOptional()
  @IsString()
  disbursementThreshold?: string;

  @IsOptional()
  disbursementAboveBps?: number;

  @IsOptional()
  transferBps?: number;
}

export class CreateAccountDto {
  @IsString()
  @MinLength(2, { message: 'accountName must be at least 2 characters' })
  @MaxLength(80)
  accountName!: string;

  @IsOptional()
  @IsEmail({}, { message: 'contactEmail must be a valid email' })
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @IsOptional()
  @IsEnum(BillingMode)
  billingMode?: BillingMode;

  /** Auto-sweep the collection wallet daily at 00:00 TZ (default: true) */
  @IsOptional()
  @IsBoolean()
  autoSweep?: boolean;

  /** Settlement details used for all sweeps/withdrawals (requirement #1) */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettlementInputDto)
  settlement?: SettlementInputDto;

  /** Optional custom fee schedule overrides (requirement #3) */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FeeConfigInputDto)
  fees?: FeeConfigInputDto;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  accountName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;
}

export class SuspendAccountDto {
  @IsString()
  @MinLength(3, { message: 'suspendReason is required (min 3 characters)' })
  @MaxLength(300)
  suspendReason!: string;
}
