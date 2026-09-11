import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { CollectionChannel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { AMOUNT_MESSAGE, AMOUNT_PATTERN } from '../../common/validators';

export class UssdPushPreviewDto {
  /** Collection amount in TZS, e.g. "15000" */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsString()
  @Matches(/^255[67]\d{8}$/, { message: 'phoneNumber must be a Tanzanian mobile number, e.g. 255712345678' })
  phoneNumber!: string;

  @IsOptional()
  @IsBoolean()
  fetchSenderDetails?: boolean;

  /** Optional 1-15 alphanumeric client reference (padded into the 20-char internal reference). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;
}

export class UssdPushInitiateDto extends UssdPushPreviewDto {}

export class CollectionQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  channel?: string;
}
