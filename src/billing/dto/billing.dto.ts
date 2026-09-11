import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumberString, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { BillType, ServiceKey } from '@prisma/client';
import { AMOUNT_MESSAGE, AMOUNT_PATTERN } from '../../common/validators';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @IsEnum(ServiceKey, { each: true })
  services!: ServiceKey[];

  /** Recurring amount per period, e.g. "50000" */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  recurringAmount!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  periodDays?: number;
}

export class AssignPlanDto {
  @IsString()
  planId!: string;
}

export class CreateBillDto {
  @IsEnum(BillType)
  type!: BillType;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;

  /** Only manual bills may be recurring; accounts can operate without bills. */
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  periodDays?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
