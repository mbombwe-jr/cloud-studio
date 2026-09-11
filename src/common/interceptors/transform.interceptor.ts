import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';

/**
 * Consistent, information-rich response envelope:
 *   { success: true, data, meta: { traceId, timestamp, ... } }
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const traceId = (request as any).traceId;
    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) {
          return { success: true, data: null, meta: { traceId, timestamp: new Date().toISOString() } };
        }
        if (typeof data === 'object' && 'data' in data && 'meta' in data && ('pagination' in (data.meta ?? {}) || 'pagination' in data)) {
          // already enriched (list endpoints return { data, meta: { pagination } })
          return {
            success: true,
            data: data.data,
            meta: { ...(data.meta ?? {}), traceId, timestamp: new Date().toISOString() },
          };
        }
        if (typeof data === 'object' && 'items' in (data as any) && 'pagination' in (data as any)) {
          const body = data as any;
          return {
            success: true,
            data: body.items,
            meta: { pagination: body.pagination, traceId, timestamp: new Date().toISOString() },
          };
        }
        return { success: true, data, meta: { traceId, timestamp: new Date().toISOString() } };
      }),
    );
  }
}
