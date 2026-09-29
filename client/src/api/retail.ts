import { request } from './request';
import type {
  RetailOrder,
  RetailReturn,
  RetailReportSummary,
  RetailStoreRankItem,
  RetailStyleTopItem,
  RetailPayMethodStat,
  RetailTrendItem,
  PaginationResult,
  RetailOrderItem,
} from '@shared/api.interface';

export const retailApi = {
  list: (params: Record<string, any>) =>
    request<PaginationResult<RetailOrder>>('/api/retail', 'GET', null, params),
  get: (id: string) =>
    request<RetailOrder>(`/api/retail/${id}`),
  create: (data: any) =>
    request<RetailOrder>('/api/retail', 'POST', data),
  update: (id: string, data: any) =>
    request<RetailOrder>(`/api/retail/${id}`, 'PUT', data),
  settle: (id: string, data: any) =>
    request<RetailOrder>(`/api/retail/${id}/settle`, 'POST', data),
  void: (id: string) =>
    request<void>(`/api/retail/${id}/void`, 'POST'),
  getSkuByCode: (code: string) =>
    request<RetailOrderItem & { styleNo: string; color?: string; size?: string }>(
      '/api/retail/sku-by-code',
      'GET',
      null,
      { code },
    ),

  returnList: (params: Record<string, any>) =>
    request<PaginationResult<RetailReturn>>('/api/retail/return', 'GET', null, params),
  returnGet: (id: string) =>
    request<RetailReturn>(`/api/retail/return/${id}`),
  returnCreate: (data: any) =>
    request<RetailReturn>('/api/retail/return', 'POST', data),
  returnRefund: (id: string) =>
    request<RetailReturn>(`/api/retail/return/${id}/refund`, 'POST'),
  returnVoid: (id: string) =>
    request<void>(`/api/retail/return/${id}/void`, 'POST'),

  reportSummary: (params: Record<string, any>) =>
    request<{
      summary: RetailReportSummary;
      storeRank: RetailStoreRankItem[];
      styleTop: RetailStyleTopItem[];
      payMethodStats: RetailPayMethodStat[];
      trend: RetailTrendItem[];
    }>('/api/retail/report/summary', 'GET', null, params),
};
