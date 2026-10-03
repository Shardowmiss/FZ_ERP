import { request } from './request';
import type { PaginationParams, PaginationResult, SalesOrder, SalesOutbound, SalesReturn, SalesReconciliation, SalesReconPreview } from '@shared/api.interface';

export const salesApi = {
  order: {
    list: (params: PaginationParams & { dealerId?: string; status?: string; startDate?: string; endDate?: string }) =>
      request<PaginationResult<SalesOrder>>('/api/sales/order', 'GET', null, params),
    get: (id: string) => request<SalesOrder>(`/api/sales/order/${id}`),
    create: (data: any) => request<SalesOrder>('/api/sales/order', 'POST', data),
    update: (id: string, data: any) => request<SalesOrder>(`/api/sales/order/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/sales/order/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/sales/order/${id}/void`, 'POST'),
    audit: (id: string) => request<void>(`/api/sales/order/${id}/audit`, 'POST'),
    cancelAudit: (id: string) => request<void>(`/api/sales/order/${id}/cancel-audit`, 'POST'),
    book: (id: string) => request<void>(`/api/sales/order/${id}/book`, 'POST'),
  },
  outbound: {
    list: (params: PaginationParams & { dealerId?: string; status?: string; orderNo?: string; brand?: string }) =>
      request<PaginationResult<SalesOutbound>>('/api/sales/outbound', 'GET', null, params),
    get: (id: string) => request<SalesOutbound>(`/api/sales/outbound/${id}`),
    create: (data: any) => request<SalesOutbound>('/api/sales/outbound', 'POST', data),
    audit: (id: string) => request<void>(`/api/sales/outbound/${id}/audit`, 'POST'),
    cancelAudit: (id: string) => request<void>(`/api/sales/outbound/${id}/cancel-audit`, 'POST'),
    book: (id: string) => request<void>(`/api/sales/outbound/${id}/book`, 'POST'),
    accept: (id: string) => request<void>(`/api/sales/outbound/${id}/accept`, 'POST'),
    remove: (id: string) => request<void>(`/api/sales/outbound/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/sales/outbound/${id}/void`, 'POST'),
  },
  return: {
    list: (params: PaginationParams & { status?: string }) =>
      request<PaginationResult<SalesReturn>>('/api/sales/return', 'GET', null, params),
    get: (id: string) => request<SalesReturn>(`/api/sales/return/${id}`),
    create: (data: any) => request<SalesReturn>('/api/sales/return', 'POST', data),
    audit: (id: string) => request<void>(`/api/sales/return/${id}/audit`, 'POST'),
    cancelAudit: (id: string) => request<void>(`/api/sales/return/${id}/cancel-audit`, 'POST'),
    book: (id: string) => request<void>(`/api/sales/return/${id}/book`, 'POST'),
    accept: (id: string) => request<void>(`/api/sales/return/${id}/accept`, 'POST'),
    remove: (id: string) => request<void>(`/api/sales/return/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/sales/return/${id}/void`, 'POST'),
  },
  reconciliation: {
    list: (params: PaginationParams & {
      dealerId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    }) =>
      request<PaginationResult<SalesReconciliation>>(
        '/api/sales/reconciliation', 'GET', null, params),
    get: (id: string) => request<SalesReconciliation>(
      `/api/sales/reconciliation/${id}`),
    create: (data: any) => request<SalesReconciliation>(
      '/api/sales/reconciliation', 'POST', data),
    preview: (data: { dealerId: string; startDate: string; endDate: string }) =>
      request<SalesReconPreview>(
        '/api/sales/reconciliation/preview', 'POST', data),
    confirm: (id: string) => request<void>(
      `/api/sales/reconciliation/${id}/confirm`, 'POST'),
  },
};
