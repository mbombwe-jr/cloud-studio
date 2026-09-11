import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { IiiLoggerService } from './logger.service';
import { IiiTracingService } from './tracing.service';

interface CronEntry {
  name: string;
  expression: string;
  handler: () => Promise<void>;
  tz?: string;
}

/**
 * Cron registry for recurring platform jobs (status polling, recurring
 * billing, delivery-report sync).
 *
 * Local driver: schedules via @nestjs/schedule (cron package) inside this
 * process. When III_ENABLED=true the same handlers are additionally declared
 * as `cron` triggers on the iii engine (config field: `expression`), so the
 * engine can own scheduling while handlers stay identical.
 */
@Injectable()
export class IiiCronService implements OnApplicationBootstrap {
  private readonly entries: CronEntry[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
  ) {}

  register(name: string, expression: string, handler: () => Promise<void>, tz?: string): void {
    this.entries.push({ name, expression, handler, tz });
  }

  onApplicationBootstrap() {
    for (const entry of this.entries) {
      const job = new CronJob(entry.expression, () => void this.fire(entry), undefined, false, entry.tz);
      this.schedulerRegistry.addCronJob(entry.name, job as any);
      job.start();
      this.logger.info('cron registered', { module: 'cron', cron: entry.name, expression: entry.expression, tz: entry.tz });
    }
  }

  private async fire(entry: CronEntry): Promise<void> {
    if (this.running.has(entry.name)) return; // never overlap
    this.running.add(entry.name);
    const traceId = `cron-${entry.name}-${Date.now()}`;
    try {
      await this.tracing.rootSpan(`cron:${entry.name}`, 'cron', async () => entry.handler());
      this.logger.debug('cron completed', { module: 'cron', cron: entry.name, traceId });
    } catch (err: any) {
      this.logger.error('cron failed', { module: 'cron', cron: entry.name, error: err?.message });
    } finally {
      this.running.delete(entry.name);
    }
  }
}
