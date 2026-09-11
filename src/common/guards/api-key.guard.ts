import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RequestAccount } from '../decorators/current.decorators';
import { hashApiKey, isValidApiKeyShape } from '../utils/api-key.util';
import { ErrorCodes } from '../constants';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';

export const API_KEY_HEADER = 'x-api-key';

/**
 * Account API-key authentication.
 *  - Key travels in the `X-API-Key` header and must be >= 32 characters.
 *  - Only SHA-256 hashes are stored; lookup happens by hash.
 *  - Attaches the account (with permissions) to the request or rejects with
 *    a precise error code (revoked / suspended / inactive).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const raw = (request.headers[API_KEY_HEADER] || request.headers['authorization']?.toString().replace(/^ApiKey\s+/i, '') || '') as string;
    const key = String(raw).trim();

    if (!key || !isValidApiKeyShape(key)) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: `Provide a valid API key (min ${32} characters) in the ${API_KEY_HEADER} header`,
      });
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(key) },
      include: {
        account: { include: { permissions: true } },
      },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException({ code: ErrorCodes.API_KEY_REVOKED, message: 'API key is invalid or has been revoked' });
    }
    if (apiKey.account.status === 'SUSPENDED') {
      throw new UnauthorizedException({
        code: ErrorCodes.ACCOUNT_SUSPENDED,
        message: `Account "${apiKey.account.accountName}" is suspended. Contact the platform admin.`,
      });
    }

    const account = apiKey.account as unknown as RequestAccount;
    (account as any).apiKeyId = apiKey.id;
    request.account = account;

    // best-effort usage stamping — never blocks the request
    this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return true;
  }
}
