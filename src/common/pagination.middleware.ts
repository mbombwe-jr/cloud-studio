import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/** Parses ?page=&limit= into req.pagination with sane bounds (limit ≤ 100). */
@Injectable()
export class PaginationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limitRaw = parseInt(String(req.query.limit ?? '20'), 10) || 20;
    const limit = Math.min(100, Math.max(1, limitRaw));
    (req as any).pagination = { page, limit, skip: (page - 1) * limit, take: limit };
    next();
  }
}

export function paginationMeta(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Inline pagination parsing for controllers that don't use the middleware. */
export function paginationFrom(req: Request, maxLimit = 100) {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}
