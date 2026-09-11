import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IiiAnalyticsService } from './analytics.service';
import { IiiCronService } from './cron.service';
import { IiiEngineDriver } from './iii-engine.driver';
import { IiiLoggerService } from './logger.service';
import { IiiQueueService } from './queue.service';
import { IiiTracingService } from './tracing.service';

/**
 * iii integration module — the platform's infrastructure backbone covering:
 *   queues      → IiiQueueService   (Postgres SKIP LOCKED; optional iii engine routing)
 *   cronjobs    → IiiCronService    (status polling, recurring billing, DLR sync)
 *   logging     → IiiLoggerService  (structured JSON documents)
 *   analytics   → IiiAnalyticsService (durable event store + aggregations)
 *   tracing     → IiiTracingService (end-to-end trace + span snapshots, nothing dropped)
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [IiiLoggerService, IiiTracingService, IiiAnalyticsService, IiiQueueService, IiiCronService, IiiEngineDriver],
  exports: [IiiLoggerService, IiiTracingService, IiiAnalyticsService, IiiQueueService, IiiCronService, IiiEngineDriver],
})
export class IiiModule {}
