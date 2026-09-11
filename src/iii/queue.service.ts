import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IiiLoggerService } from './logger.service';
import { IiiTracingService } from './tracing.service';
import { QueueHandler, QueueJobRow } from './types';

/**
 * iii-compatible work queue.
 *
 * Two drivers, one interface:
 *  - "local" (default): durable Postgres-backed queue using
 *    `FOR UPDATE SKIP LOCKED` for multi-instance safety, exponential retry
 *    backoff and a DEAD state for exhausted jobs.
 *  - "iii engine" (III_ENABLED=true): the same handlers are additionally
 *    registered on the running iii engine (https://iii.dev) through the
 *    official iii-sdk, so jobs can be routed through engine queues and gain
 *    engine-level tracing/observability. See iii-engine.driver.ts.
 */
@Injectable()
export class IiiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly handlers = new Map<string, { handler: QueueHandler; maxAttempts: number }>();
  private readonly workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
  ) {}

  register(queue: string, handler: QueueHandler, opts?: { maxAttempts?: number }): void {
    this.handlers.set(queue, {
      handler,
      maxAttempts: opts?.maxAttempts ?? this.config.get('iii.queue.maxAttempts', 5),
    });
  }

  async enqueue(queue: string, payload: unknown, opts?: { delayMs?: number; maxAttempts?: number; traceId?: string }): Promise<string> {
    const runAt = new Date(Date.now() + (opts?.delayMs ?? 0));
    const job = await this.prisma.job.create({
      data: {
        queue,
        payload: payload as Prisma.InputJsonValue,
        runAt,
        maxAttempts: opts?.maxAttempts ?? this.handlers.get(queue)?.maxAttempts ?? 5,
      },
    });
    this.logger.debug('job enqueued', { module: 'queue', queue, jobId: job.id, traceId: opts?.traceId });
    return job.id;
  }

  onModuleInit() {
    const interval = this.config.get('iii.queue.pollIntervalMs', 1000);
    this.timer = setInterval(() => void this.poll(), interval);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    const deadline = Date.now() + 10_000;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Claims and processes up to the configured concurrency of due jobs. */
  private async poll(): Promise<void> {
    if (this.stopping) return;
    const concurrency = this.config.get('iii.queue.concurrency', 5);
    while (this.inFlight < concurrency && !this.stopping) {
      const job = await this.claim();
      if (!job) return;
      this.inFlight++;
      void this.process(job).finally(() => {
        this.inFlight--;
      });
    }
  }

  private async claim(): Promise<QueueJobRow | null> {
    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        UPDATE "jobs"
        SET "status" = ${JobStatus.PROCESSING}::"JobStatus",
            "lockedAt" = NOW(),
            "lockedBy" = ${this.workerId},
            "attempts" = "attempts" + 1,
            "updatedAt" = NOW()
        WHERE "id" IN (
          SELECT "id" FROM "jobs"
          WHERE "status" = ${JobStatus.PENDING}::"JobStatus" AND "runAt" <= NOW()
          ORDER BY "createdAt"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "queue", "payload", "attempts", "maxAttempts";
      `;
      if (!rows?.length) return null;
      const row = rows[0];
      return { id: row.id, queue: row.queue, payload: row.payload, attempts: row.attempts, maxAttempts: row.maxAttempts };
    } catch (err: any) {
      this.logger.error('queue claim failed', { module: 'queue', error: err?.message });
      return null;
    }
  }

  private async process(job: QueueJobRow): Promise<void> {
    const entry = this.handlers.get(job.queue);
    const traceId = (job.payload as any)?.traceId as string | undefined;
    try {
      if (!entry) throw new Error(`no handler registered for queue "${job.queue}"`);
      await this.tracing.runJob(traceId || `job-${job.id}`, () => entry.handler(job.payload, job));
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: JobStatus.COMPLETED, completedAt: new Date(), lastError: null, updatedAt: new Date() },
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const exhausted = job.attempts >= job.maxAttempts;
      const base = parseInt(process.env.QUEUE_BACKOFF_BASE_MS || '5000', 10);
      const backoffMs = base * Math.pow(2, Math.min(job.attempts, 6));
      await this.prisma.job
        .update({
          where: { id: job.id },
          data: {
            status: exhausted ? JobStatus.DEAD : JobStatus.PENDING,
            runAt: exhausted ? undefined : new Date(Date.now() + backoffMs),
            lastError: message.slice(0, 1000),
            updatedAt: new Date(),
          },
        })
        .catch(() => undefined);
      this.logger.error(`job ${exhausted ? 'dead-lettered' : 'failed, will retry'}`, {
        module: 'queue', queue: job.queue, jobId: job.id, attempts: job.attempts, error: message,
      });
    }
  }
}
