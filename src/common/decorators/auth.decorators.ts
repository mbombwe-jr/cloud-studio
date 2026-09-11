import { SetMetadata } from '@nestjs/common';
import { ServiceKey } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const REQUIRE_SERVICE_KEY = 'require_service';
export const RequireService = (service: ServiceKey, channel?: string) =>
  SetMetadata(REQUIRE_SERVICE_KEY, { service, channel });

export const IS_PUBLIC_KEY = 'is_public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
