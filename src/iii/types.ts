import { randomUUID } from 'crypto';

export interface SpanEvent {
  name: string;
  time: string;
  data?: unknown;
}

export interface SpanContext {
  traceId: string;
  parentSpanId?: string;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  component: string;
  attributes?: Record<string, unknown>;
  events: SpanEvent[];
  startedAt: Date;
  /** stamps an event onto the span (provider request/response snapshots etc.) */
  event: (name: string, data?: unknown) => void;
  /** finishes the span; persists to the trace store */
  end: (status?: 'OK' | 'ERROR', extra?: { error?: string; data?: unknown }) => Promise<void>;
}

export interface QueueJobRow {
  id: string;
  queue: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export type QueueHandler = (payload: any, job: Pick<QueueJobRow, 'id' | 'attempts' | 'maxAttempts'>) => Promise<void>;

export function newSpanId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export function newTraceId(): string {
  return randomUUID().replace(/-/g, '');
}
