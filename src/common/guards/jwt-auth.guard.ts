import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ErrorCodes } from '../constants';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SERVICEMAN';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException({ code: ErrorCodes.UNAUTHORIZED, message: 'Missing bearer token' });
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      request.user = payload as any;
      return true;
    } catch {
      throw new UnauthorizedException({ code: ErrorCodes.UNAUTHORIZED, message: 'Invalid or expired token' });
    }
  }
}
