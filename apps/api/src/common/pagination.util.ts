import type { PaginatedEnvelope } from '@erp/types';
import type { Request } from 'express';
import { getRequestId } from './api-envelope.interceptor.js';

export interface PageParams {
  page: number;
  pageSize: number;
}

export function toPrismaPagination(params: PageParams): { skip: number; take: number } {
  return { skip: (params.page - 1) * params.pageSize, take: params.pageSize };
}

export function buildPaginatedEnvelope<T>(
  items: T[],
  total: number,
  params: PageParams,
  req: Request,
): PaginatedEnvelope<T> {
  return {
    data: items,
    meta: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      requestId: getRequestId(req),
    },
  };
}
