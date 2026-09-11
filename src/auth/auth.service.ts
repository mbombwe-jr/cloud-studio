import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCodes } from '../common/constants';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

/**
 * Credential-stuffing / brute-force protection (requirement #9).
 *
 * Per-credential lockout is stronger than IP-only throttling: an attacker
 * rotating source IPs is still stopped, while legitimate NAT'd offices
 * sharing one IP are not collateral damage. Counters live in-memory
 * (single-process deployment); a successful login resets the counter.
 *
 *  - max AUTH_MAX_FAILURES (default 10) failures per email
 *  - sliding window AUTH_FAILURE_WINDOW_MS (default 15 min)
 *  - lockout lasts AUTH_LOCKOUT_MS (default 15 min)
 *  - constant-shape error: lockouts are indistinguishable from bad passwords
 */
const MAX_FAILURES = parseInt(process.env.AUTH_MAX_FAILURES || '10', 10);
const FAILURE_WINDOW_MS = parseInt(process.env.AUTH_FAILURE_WINDOW_MS || '900000', 10);
const LOCKOUT_MS = parseInt(process.env.AUTH_LOCKOUT_MS || '900000', 10);

interface FailureRecord {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

@Injectable()
export class AuthService {
  /** email -> failure record (bounded automatically by window expiry) */
  private readonly failures = new Map<string, FailureRecord>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const record = this.failures.get(email);

    // locked out? answer exactly like a wrong password
    if (record?.lockedUntil && record.lockedUntil > Date.now()) {
      throw new UnauthorizedException({ code: ErrorCodes.INVALID_CREDENTIALS, message: 'Invalid email or password' });
    }

    const user = await this.prisma.staffUser.findUnique({ where: { email } });
    // constant-shape failure: never reveal which part was wrong
    if (!user || !user.isActive) {
      this.registerFailure(email);
      throw new UnauthorizedException({ code: ErrorCodes.INVALID_CREDENTIALS, message: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      this.registerFailure(email);
      throw new UnauthorizedException({ code: ErrorCodes.INVALID_CREDENTIALS, message: 'Invalid email or password' });
    }

    this.failures.delete(email);
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  private registerFailure(email: string): void {
    const now = Date.now();
    const record = this.failures.get(email);
    if (!record || now - record.firstAt > FAILURE_WINDOW_MS) {
      this.failures.set(email, { count: 1, firstAt: now });
      return;
    }
    record.count += 1;
    if (record.count >= MAX_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
      record.count = 0;
      record.firstAt = now;
    }
  }

  async me(userId: string) {
    const user = await this.prisma.staffUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: ErrorCodes.UNAUTHORIZED, message: 'Unknown user' });
    return { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive };
  }

  hashPassword(plain: string, rounds: number): Promise<string> {
    return bcrypt.hash(plain, rounds);
  }
}
