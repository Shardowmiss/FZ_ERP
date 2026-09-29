import type { PaginationResult } from '@shared/api.interface';

/**
 * 通用分页/排序参数（来自 Query 或 Body 的原始形态，字符串或数字皆可）
 */
export interface PaginationQuery {
  page?: string | number;
  pageSize?: string | number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc' | string;
}

/**
 * 归一化后的分页参数：page/pageSize 已做边界处理，offset/limit 供 Drizzle 直接使用。
 */
export interface ResolvedPagination {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

/**
 * 将前端传入的 page/pageSize 归一化，避免在 60+ 个列表接口中重复 `parseInt(x, 10) || 1` 这类脆弱写法。
 * - page 下界为 1
 * - pageSize 下界为 1，上界为 maxPageSize（默认 200），防止超大分页拖垮数据库
 */
export function resolvePagination(
  query: PaginationQuery = {},
  options: { defaultPageSize?: number; maxPageSize?: number } = {},
): ResolvedPagination {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;

  const rawPage = Number(query.page);
  const rawSize = Number(query.pageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  let pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.floor(rawSize) : defaultPageSize;
  if (pageSize > maxPageSize) pageSize = maxPageSize;

  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc';

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
    sortBy: query.sortBy,
    sortOrder,
  };
}

export type { PaginationResult };
