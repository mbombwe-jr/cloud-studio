import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Account, StaffUser } from '@prisma/client';

export interface RequestAccount extends Account {
  permissions: { service: string; granted: boolean; meta: any }[];
  apiKeyId: string;
}

export const CurrentAccount = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestAccount => {
  return ctx.switchToHttp().getRequest().account;
});

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): StaffUser => {
  return ctx.switchToHttp().getRequest().user;
});
