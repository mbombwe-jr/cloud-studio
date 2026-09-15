import { IsArray, IsEnum, IsIn, IsNumberString, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested, ArrayMaxSize, ArrayMinSize, IsInt, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import { AMOUNT_MESSAGE, AMOUNT_PATTERN } from '../../common/validators';

export class MobileMoneyPayoutDto {
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsString()
  @Matches(/^255[67]\d{8}$/, { message: 'phoneNumber must be a Tanzanian mobile number, e.g. 255712345678' })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;
}

export class BankPayoutDto {
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  accountNumber!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  accountName!: string;

  /** Beneficiary bank BIC (e.g. ACTZTZTZ), fetched from the provider's bank list */
  @IsString()
  @Matches(/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/, { message: 'bic must be a valid SWIFT/BIC code' })
  bic!: string;

  @IsOptional()
  @IsIn(['ACH', 'RTGS'])
  transferType?: 'ACH' | 'RTGS';

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;
}

export class BatchItemDto {
  @IsEnum(PayoutChannel)
  channel!: PayoutChannel;

  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  /** required when channel = MOBILE_MONEY */
  @IsOptional()
  @IsString()
  @Matches(/^255[67]\d{8}$/, { message: 'phoneNumber must be a Tanzanian mobile number' })
  phoneNumber?: string;

  /** required when channel = BANK */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/, { message: 'bic must be a valid SWIFT/BIC code' })
  bic?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;
}

export class CreateBatchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchItemDto)
  items!: BatchItemDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class MnoPayoutPreviewDto {
  @ApiProperty({ example: '25000' })
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a positive decimal string' })
  amount!: string;

  @ApiPropertyOptional({ default: 'TZS' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '0751234567' })
  @IsString()
  phoneNumber!: string;
}

export class CreatePayoutLinkDto {
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  /** Link lifetime in minutes. Defaults to 15 and cannot exceed 24 hours. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  expiresInMinutes?: number;
}

export class PayoutLinkDetailsDto {
  @IsString()
  @Matches(/^255[67]\d{8}$/, { message: 'phoneNumber must be a Tanzanian mobile number' })
  phoneNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  payoutMethod!: string;
}
