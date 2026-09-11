import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/auth.decorators';
import { ErrorCodes } from '../constants';

/**
 * Role gate for staff (ADMIN / SERVICEMAN).
 * - Endpoints decorated with @Roles('ADMIN') are admin-only.
 * - @Roles('ADMIN', 'SERVICEMAN') grants read access to servicemen, who have
 *   strictly read-only access to accounts and data (enforced per endpoint).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role) {
      throw new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message: 'Authentication required' });
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: `Role "${user.role}" may not access this resource`,
      });
    }
    return true;
  }
}
