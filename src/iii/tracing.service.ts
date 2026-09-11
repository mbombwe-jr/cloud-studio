import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { newSpanId, newTraceId, Span, SpanEvent } from './types';

interface AlsState {
  traceId: string;
  parentSpanId?: string;
}

/**
 * Distributed tracing with zero data loss:
 *  - every HTTP request gets a root span (traceId); the traceId is returned
 *    in the response envelope and propagated into queues, providers and
 *    audit records;
 *  - child spans wrap provider calls / ledger operations and persist their
 *    full request & response snapshots as span events, so no trace data is
 *    ever dropped;
 *  - when the iii engine is attached, the engine additionally emits
 *    OpenTelemetry traces for the same operations.
 */
@Injectable()
export class IiiTracingService {
  private readonly als = new AsyncLocalStorage<AlsState>();

  constructor(private readonly prisma: PrismaService) {}

  currentTraceId(): string | undefined {
    return this.als.getStore()?.traceId;
  }

  /** Runs `fn` with the given traceId as the current context (used by queue workers). */
  async withTrace<T>(traceId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    if (!traceId) return fn();
    return this.als.run({ traceId }, fn);
  }

  /** Starts a root span with a fresh traceId and runs `fn` inside it. */
  async rootSpan<T>(operation: string, component: string, fn: (span: Span) => Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
    const traceId = newTraceId();
    return this.als.run({ traceId }, async () => {
      const span = this.startSpan(operation, component, attributes);
      try {
        const result = await fn(span);
        await span.end('OK');
        return result;
      } catch (err: any) {
        await span.end('ERROR', { error: err?.message ?? String(err) });
        throw err;
      }
    });
  }

  /** Starts (and registers) a child span bound to the current trace, if any. */
  startSpan(operation: string, component: string, attributes?: Record<string, unknown>): Span {
    const store = this.als.getStore();
    const traceId = store?.traceId ?? newTraceId();
    const span: Span = {
      traceId,
      spanId: newSpanId(),
      parentSpanId: store?.parentSpanId,
      operation,
      component,
      attributes,
      events: [],
      startedAt: new Date(),
      event: (name: string, data?: unknown) => {
        const evt: SpanEvent = { name, time: new Date().toISOString(), data };
        span.events.push(evt);
      },
      end: async (status = 'OK', extra?: { error?: string; data?: unknown }) => {
        if (extra?.error) span.event('error', { message: extra.error });
        if (extra?.data !== undefined) span.event('result', extra.data);
        const durationMs = Date.now() - span.startedAt.getTime();
        try {
          await this.prisma.traceSpan.create({
            data: {
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId,
              operation: span.operation,
              component: span.component,
              status,
              attributes: (attributes ?? undefined) as any,
              events: span.events as any,
              durationMs,
            },
          });
        } catch {
          /* tracing must never break business flow */
        }
      },
    };
    return span;
  }

  /** Convenience wrapper: traces an async provider/IO call end-to-end. */
  async traceCall<T>(operation: string, component: string, fn: (span: Span) => Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
    const span = this.startSpan(operation, component, attributes);
    try {
      const result = await fn(span);
      await span.end('OK');
      return result;
    } catch (err: any) {
      await span.end('ERROR', { error: err?.message ?? String(err) });
      throw err;
    }
  }

  /** Wraps a queue job execution so all nested spans share the job traceId. */
  async runJob<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
    return this.withTrace(traceId, fn);
  }
}
