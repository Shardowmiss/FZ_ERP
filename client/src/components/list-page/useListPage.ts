import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';

export interface UseListPageOptions<TParams, TItem> {
  fetchFn: (params: { page: number; pageSize: number } & TParams) => Promise<{
    items: TItem[];
    total: number;
  }>;
  defaultPageSize?: number;
  defaultParams?: TParams;
}

export function useListPage<
  TItem,
  TParams extends Record<string, unknown> = Record<string, unknown>
>(options: UseListPageOptions<TParams, TItem>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options.defaultPageSize ?? 20);
  const [total, setTotal] = useState(0);
  const [list, setList] = useState<TItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<TParams>(
    options.defaultParams ?? ({} as TParams)
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await options.fetchFn({
        page,
        pageSize,
        ...searchParams,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (err: any) {
      // 列表加载失败时给出明确提示，避免静默清空列表让用户无感知
      const msg = err?.response?.data?.message || err?.message || '数据加载失败';
      toast.error(msg);
      logger.error('列表加载失败', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams, options.fetchFn]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = (params: TParams): void => {
    setSearchParams(params);
    setPage(1);
  };

  const handleReset = (): void => {
    setSearchParams(options.defaultParams ?? ({} as TParams));
    setPage(1);
  };

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  return {
    list,
    loading,
    total,
    page,
    pageSize,
    setPage,
    handlePageSizeChange,
    handleSearch,
    handleReset,
    searchParams,
    reload: fetchData,
  };
}
