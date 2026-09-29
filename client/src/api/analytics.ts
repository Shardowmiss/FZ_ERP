import { request } from './request';
import type {
  ForecastResult,
  LifecycleItem,
  BiResult,
  MobileDashboard,
} from '@shared/api.interface';

export const analyticsApi = {
  forecast: (skuId: string, horizon = 3) =>
    request<ForecastResult>('/api/analytics/forecast', 'GET', null, {
      skuId,
      horizon,
    }),
  lifecycle: (days = 90) =>
    request<LifecycleItem[]>('/api/analytics/lifecycle', 'GET', null, { days }),
  setLifecycle: (styleNo: string, status: string) =>
    request<{ updated: number }>('/api/analytics/lifecycle/set', 'POST', {
      styleNo,
      status,
    }),
  bi: (dim: string, metric = 'amount', from?: string, to?: string) =>
    request<BiResult>('/api/analytics/bi', 'GET', null, {
      dim,
      metric,
      from,
      to,
    }),
  mobileDashboard: () =>
    request<MobileDashboard>('/api/analytics/mobile-dashboard'),
  approve: (docType: string, docId: string) =>
    request<{ updated: number }>('/api/analytics/approve', 'POST', {
      docType,
      docId,
    }),
};
