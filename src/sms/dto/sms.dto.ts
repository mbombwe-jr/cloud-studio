import { IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength, ArrayMaxSize, ArrayMinSize, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class SendSmsDto {
  /** Optional when the account should use its default/shared sender name */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9 ]{2,11}$/, { message: 'senderName must be 2-11 characters (alphanumeric + spaces)' })
  senderName?: string;

  @IsString()
  @MinLength(1, { message: 'message is required' })
  @MaxLength(1600)
  message!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250, { message: 'at most 250 recipients per request' })
  @Matches(/^(\+?255|0)?[67]\d{8}$/, { each: true, message: 'each recipient must be a Tanzanian mobile number' })
  recipients!: string[];

  /** Optional scheduled send time (ISO 8601, Africa/Dar_es_Salaam). */
  @IsOptional()
  @IsDateString({}, { message: 'scheduleAt must be an ISO 8601 date' })
  scheduleAt?: string;
}

export class SmsQueryDto {
  @IsOptional()
  @IsIn(['QUEUED', 'SENT', 'DELIVERED', 'FAILED'])
  status?: string;
}
