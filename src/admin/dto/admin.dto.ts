import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateStaffDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, { message: 'password must include upper, lower and digits' })
  password!: string;

  /** ADMIN can write; SERVICEMAN is strictly read-only. */
  @IsEnum(UserRole)
  role!: UserRole;
}

export class ComputationsQueryDto {
  @IsOptional()
  @IsIn(['day', 'month', 'custom'])
  preset?: 'day' | 'month' | 'custom';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
