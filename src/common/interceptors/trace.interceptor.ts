import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { IiiTracingService } from '../../iii/tracing.service';
import { newTraceId } from '../../iii/types';

/**
 * Opens the root tracing span for every HTTP request inside the
 * AsyncLocalStorage context, so every nested operation (services, providers,
 * ledger moves) is linked to the same traceId. The traceId is returned in the
 * response envelope and X-Trace-Id header.
 */
@Injectable()
export class TraceInterceptor implements NestInterceptor {
  constructor(private readonly tracing: IiiTracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const traceId = newTraceId();
    (request as any).traceId = traceId;
    response.setHeader('X-Trace-Id', traceId);

    return new Observable<unknown>((subscriber) => {
      // run the whole downstream pipeline inside the trace context; the
      // subscription happens synchronously within withTrace, so all async
      // continuations inherit the context (AsyncLocalStorage semantics).
      void this.tracing.withTrace(traceId, async () => {
        const span = this.tracing.startSpan(`${request.method} ${request.route?.path ?? request.url}`, 'http', {
          method: request.method,
          path: request.originalUrl,
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        });
        await new Promise<void>((resolve) => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => {
              subscriber.error(err);
              void span.end('ERROR', { error: err?.message ?? String(err) });
              resolve();
            },
            complete: () => {
              void span.end('OK');
              subscriber.complete();
              resolve();
            },
          });
        });
      }).catch(() => undefined);
    });
  }
}
