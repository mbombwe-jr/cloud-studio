import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export class DepositPreviewDto {
  @ApiProperty({ example: '15000' })
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a positive decimal string' })
  amount!: string;

  @ApiPropertyOptional({ default: 'TZS' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '0712345678' })
  @IsString()
  phoneNumber!: string;

  @ApiPropertyOptional({ description: 'Client reference (1-15 alphanumeric)' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,15}$/, { message: 'reference must be 1-15 alphanumeric characters' })
  reference?: string;
}

export class DepositInitiateDto extends DepositPreviewDto {}

export class DepositQueryDto {
  @IsOptional()
  @IsEnum(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED', 'EXPIRED'])
  status?: string;
}
