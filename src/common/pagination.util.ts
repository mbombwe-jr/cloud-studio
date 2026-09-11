export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function resolvePagination(params: PaginationParams, maxLimit = 100): { skip: number; take: number; page: number; limit: number } {
  const page = Math.max(1, parseInt(String(params.page ?? '1'), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(params.limit ?? '20'), 10) || 20));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
