import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IiiLoggerService } from './logger.service';

/**
 * Optional iii engine driver (https://iii.dev).
 *
 * When `III_ENABLED=true` this driver connects the platform to a running iii
 * engine as a first-class Worker using the official `iii-sdk`:
 *   - the platform registers itself under the `zoostudios` namespace;
 *   - heartbeats are published so the iii console shows worker health;
 *   - function/trigger registration gives the engine an always-accurate
 *     view of the platform's capabilities, with OpenTelemetry traces, metrics
 *     and structured logs produced by the engine itself.
 *
 * The platform remains fully functional without the engine — the local
 * Postgres-backed drivers are the default. This driver is purely additive.
 */
@Injectable()
export class IiiEngineDriver implements OnModuleInit, OnModuleDestroy {
  private worker: any = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: IiiLoggerService,
  ) {}

  get connected(): boolean {
    return this.worker !== null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.get('iii.enabled')) return;
    const url = this.config.get('iii.url');
    try {
      // Official SDK: npm package "iii-sdk" (https://iii.dev/docs)
      const sdk = await import('iii-sdk');
      this.worker = sdk.registerWorker(url, {
        namespace: 'zoostudios',
        workerDescription:
          'Zoostudios cloud-services provisioning backend — collection, disbursement and SMS provisioning platform.',
        enableMetricsReporting: true,
      });
      this.worker.registerFunction('zoostudios::health', async () => ({
        status: 'ok',
        time: new Date().toISOString(),
      }));
      this.heartbeat = setInterval(() => {
        this.worker
          ?.trigger({ function_id: 'zoostudios::health', payload: {} })
          .catch(() => undefined);
      }, 60_000);
      this.logger.info('iii engine attached', { module: 'iii-engine', url });
    } catch (err: any) {
      this.worker = null;
      this.logger.warn('iii engine unavailable — continuing on local drivers', {
        module: 'iii-engine',
        url,
        error: err?.message,
      });
    }
  }

  /** Registers a platform capability on the engine (informational/observability). */
  registerCapability(functionId: string, description: string): void {
    if (!this.worker) return;
    try {
      this.worker.registerFunction(functionId, async (input: unknown) => input, { description });
    } catch {
      /* never break business flow for observability */
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    try {
      await this.worker?.shutdown();
    } catch {
      /* noop */
    }
  }
}
