import { request } from './request';
import type {
  DashboardStats,
  SalesTrendItem,
  TopStyleItem,
  InventoryWarningItem,
} from '@shared/api.interface';

export const dashboardApi = {
  stats: () => request<DashboardStats>('/api/dashboard/stats'),
  salesTrend: () => request<SalesTrendItem[]>('/api/dashboard/sales-trend'),
  topStyles: (limit: number = 10) =>
    request<TopStyleItem[]>('/api/dashboard/top-styles', 'GET', null, { limit }),
  warnings: (limit: number = 10) =>
    request<InventoryWarningItem[]>('/api/dashboard/warnings', 'GET', null, { limit }),
};
