import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../constants';
import { REQUIRE_SERVICE_KEY } from '../decorators/auth.decorators';
import { RequestAccount } from '../decorators/current.decorators';

/**
 * Permission gate: an account has NO access to a service until the platform
 * admin explicitly grants it. Optionally validates the allowed channel
 * (MOBILE_MONEY | BANK) recorded in the permission's meta.
 */
@Injectable()
export class ServicePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<{ service: string; channel?: string } | undefined>(
      REQUIRE_SERVICE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const account = context.switchToHttp().getRequest().account as RequestAccount;
    const permission = account?.permissions?.find((p) => p.service === requirement.service);

    if (!permission?.granted) {
      throw new ForbiddenException({
        code: ErrorCodes.SERVICE_NOT_GRANTED,
        message: `Service "${requirement.service}" is not granted to this account`,
      });
    }
    if (requirement.channel) {
      const channels: string[] | undefined = permission.meta?.channels;
      if (Array.isArray(channels) && channels.length > 0 && !channels.includes(requirement.channel)) {
        throw new ForbiddenException({
          code: ErrorCodes.CHANNEL_NOT_ALLOWED,
          message: `Channel "${requirement.channel}" is not allowed for service "${requirement.service}" on this account`,
        });
      }
    }
    return true;
  }
}
