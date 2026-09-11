import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { WalletType } from '@prisma/client';
import { AMOUNT_MESSAGE, AMOUNT_PATTERN } from '../../common/validators';

export class WalletParamDto {
  @IsEnum(WalletType)
  type!: WalletType;
}

export class WalletAmountDto {
  /** Positive amount, up to 2 decimal places, e.g. "15000" or "1500.50" */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;
}

export class WalletTransferDto {
  /** Positive amount to move from COLLECTION to DISBURSEMENT */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;
}

export class WalletWithdrawalDto {
  /** Positive amount to settle from COLLECTION into the settlement account */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;

  /** Optional: a specific active settlement account; default = the default one */
  @IsOptional()
  @IsString()
  settlementAccountId?: string;
}
