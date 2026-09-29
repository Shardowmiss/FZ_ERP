import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  TodayKpi,
  SalesTrendPoint,
  SalesTrendQuery,
  TopStyleItem,
  EmployeeRankingItem,
  CategorySalesItem,
  ListResponse,
} from '@shared/api.interface';

import { STORE_ID } from '@client/src/lib/store';

export async function getTodayStats(): Promise<TodayKpi> {
  try {
    const response = await axiosForBackend.get('/api/dashboard/today', {
      params: { storeId: STORE_ID },
    });
    return response.data;
  } catch (error) {
    logger.error('getTodayStats failed', error as Error);
    throw error;
  }
}

export async function getSalesTrend(
  params: SalesTrendQuery,
): Promise<SalesTrendPoint[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/dashboard/sales-trend',
      { params: { storeId: STORE_ID, ...params } },
    );
    return response.data;
  } catch (error) {
    logger.error('getSalesTrend failed', error as Error);
    throw error;
  }
}

export async function getTopStyles(limit: number): Promise<TopStyleItem[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/dashboard/top-styles',
      { params: { storeId: STORE_ID, pageSize: limit } },
    );
    const data = response.data as ListResponse<TopStyleItem>;
    return data.items ?? [];
  } catch (error) {
    logger.error('getTopStyles failed', error as Error);
    throw error;
  }
}

export async function getEmployeeRanking(
  limit: number,
): Promise<EmployeeRankingItem[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/dashboard/employee-ranking',
      { params: { storeId: STORE_ID, pageSize: limit } },
    );
    const data = response.data as ListResponse<EmployeeRankingItem>;
    return data.items ?? [];
  } catch (error) {
    logger.error('getEmployeeRanking failed', error as Error);
    throw error;
  }
}

export async function getCategorySales(): Promise<CategorySalesItem[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/dashboard/category-sales',
      { params: { storeId: STORE_ID } },
    );
    return response.data;
  } catch (error) {
    logger.error('getCategorySales failed', error as Error);
    throw error;
  }
}
