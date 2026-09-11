import { Injectable, Logger as NestLogger } from '@nestjs/common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  traceId?: string;
  accountId?: string;
  reference?: string;
  [key: string]: unknown;
}

/**
 * iii-style structured logging. Every line is a single JSON document so the
 * iii engine (or any log forwarder — Datadog, Grafana, Loki) can pick it up
 * without re-parsing. When the iii engine is attached, the same stream is
 * mirrored by the engine's log pipeline.
 */
@Injectable()
export class IiiLoggerService {
  private readonly fallback = new NestLogger('iii');

  private write(level: LogLevel, message: string, context?: LogContext) {
    const doc = {
      level,
      time: new Date().toISOString(),
      service: 'zoostudios',
      message,
      ...context,
    };
    const line = JSON.stringify(doc);
    switch (level) {
      case 'error': this.fallback.error(line); break;
      case 'warn': this.fallback.warn(line); break;
      case 'debug': this.fallback.debug(line); break;
      default: this.fallback.log(line);
    }
  }

  debug(message: string, context?: LogContext) { this.write('debug', message, context); }
  info(message: string, context?: LogContext) { this.write('info', message, context); }
  warn(message: string, context?: LogContext) { this.write('warn', message, context); }
  error(message: string, context?: LogContext) { this.write('error', message, context); }
}
