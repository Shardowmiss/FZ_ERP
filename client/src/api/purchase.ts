import { request } from './request';
import type { PaginationParams, PaginationResult, PurchaseOrder, PurchaseInbound, PurchaseReturn, PurchaseReconciliation, PurchaseReconPreview } from '@shared/api.interface';

export const purchaseApi = {
  order: {
    list: (params: PaginationParams & { supplierId?: string; status?: string; startDate?: string; endDate?: string }) =>
      request<PaginationResult<PurchaseOrder>>('/api/purchase/order', 'GET', null, params),
    get: (id: string) => request<PurchaseOrder>(`/api/purchase/order/${id}`),
    create: (data: any) => request<PurchaseOrder>('/api/purchase/order', 'POST', data),
    update: (id: string, data: any) => request<PurchaseOrder>(`/api/purchase/order/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/purchase/order/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/purchase/order/${id}/void`, 'POST'),
    audit: (id: string) => request<void>(`/api/purchase/order/${id}/audit`, 'POST'),
    cancelAudit: (id: string) => request<void>(`/api/purchase/order/${id}/cancel-audit`, 'POST'),
    book: (id: string) => request<void>(`/api/purchase/order/${id}/book`, 'POST'),
    accept: (id: string) => request<void>(`/api/purchase/order/${id}/accept`, 'POST'),
    importable: (params: PaginationParams & { supplierId?: string; startDate?: string; endDate?: string }) =>
      request<PaginationResult<PurchaseOrder>>('/api/purchase/order/importable', 'GET', null, params),
  },
  inbound: {
    list: (params: PaginationParams & { supplierId?: string; status?: string; orderNo?: string; startDate?: string; endDate?: string; warehouseId?: string; docStartDate?: string; docEndDate?: string }) =>
      request<PaginationResult<PurchaseInbound>>('/api/purchase/inbound', 'GET', null, params),
    get: (id: string) => request<PurchaseInbound>(`/api/purchase/inbound/${id}`),
    create: (data: any) => request<PurchaseInbound>('/api/purchase/inbound', 'POST', data),
    approve: (id: string) => request<void>(`/api/purchase/inbound/${id}/approve`, 'POST'),
    remove: (id: string) => request<void>(`/api/purchase/inbound/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/purchase/inbound/${id}/void`, 'POST'),
  },
  return: {
    list: (params: PaginationParams & { status?: string; startDate?: string; endDate?: string; supplierId?: string; warehouseId?: string; keyword?: string }) =>
      request<PaginationResult<PurchaseReturn>>('/api/purchase/return', 'GET', null, params),
    get: (id: string) => request<PurchaseReturn>(`/api/purchase/return/${id}`),
    create: (data: any) => request<PurchaseReturn>('/api/purchase/return', 'POST', data),
    approve: (id: string) => request<void>(`/api/purchase/return/${id}/approve`, 'POST'),
    remove: (id: string) => request<void>(`/api/purchase/return/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/purchase/return/${id}/void`, 'POST'),
  },
  reconciliation: {
    list: (params: PaginationParams & {
      supplierId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    }) =>
      request<PaginationResult<PurchaseReconciliation>>(
        '/api/purchase/reconciliation', 'GET', null, params),
    get: (id: string) => request<PurchaseReconciliation>(
      `/api/purchase/reconciliation/${id}`),
    create: (data: any) => request<PurchaseReconciliation>(
      '/api/purchase/reconciliation', 'POST', data),
    preview: (data: { supplierId: string; startDate: string; endDate: string }) =>
      request<PurchaseReconPreview>(
        '/api/purchase/reconciliation/preview', 'POST', data),
    confirm: (id: string) => request<void>(
      `/api/purchase/reconciliation/${id}/confirm`, 'POST'),
  },
};
