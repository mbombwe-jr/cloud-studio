import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { IiiEngineDriver } from '../iii/iii-engine.driver';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly iii: IiiEngineDriver) {}

  @Public()
  @Get()
  @ApiExcludeEndpoint()
  async check() {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'zoostudios-backend',
      version: '1.0.0',
      components: {
        database,
        iiiEngine: this.iii.connected ? 'attached' : 'local-drivers',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
