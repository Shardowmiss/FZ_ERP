import { request } from './request';
import type {
  PaginationParams, PaginationResult,
  InventoryStock, MaterialStock, InventoryFlow,
  InventoryTransfer, InventoryStocktake,
  InventoryWarningItem,
} from '@shared/api.interface';

export const inventoryApi = {
  query: {
    sku: (params: PaginationParams & { styleId?: string; color?: string; size?: string; warehouseId?: string; keyword?: string; brand?: string }) =>
      request<PaginationResult<InventoryStock>>('/api/inventory/query/sku', 'GET', null, params),
    material: (params: PaginationParams & { materialId?: string; warehouseId?: string; keyword?: string }) =>
      request<PaginationResult<MaterialStock>>('/api/inventory/query/material', 'GET', null, params),
  },
  flow: {
    list: (params: PaginationParams & { itemType?: string; skuId?: string; materialId?: string; warehouseId?: string; flowType?: string; startDate?: string; endDate?: string }) =>
      request<PaginationResult<InventoryFlow>>('/api/inventory/flow', 'GET', null, params),
  },
  inbound: {
    create: (data: any) => request<void>('/api/inventory/inbound', 'POST', data),
  },
  outbound: {
    create: (data: any) => request<void>('/api/inventory/outbound', 'POST', data),
  },
  transfer: {
    list: (params: PaginationParams & { status?: string; fromWarehouseId?: string; toWarehouseId?: string }) =>
      request<PaginationResult<InventoryTransfer>>('/api/inventory/transfer', 'GET', null, params),
    get: (id: string) => request<InventoryTransfer>(`/api/inventory/transfer/${id}`),
    create: (data: any) => request<InventoryTransfer>('/api/inventory/transfer', 'POST', data),
    approve: (id: string) => request<void>(`/api/inventory/transfer/${id}/approve`, 'POST'),
    receive: (id: string) => request<void>(`/api/inventory/transfer/${id}/receive`, 'POST'),
    accept: (id: string) => request<void>(`/api/inventory/transfer/${id}/accept`, 'POST'),
    void: (id: string) => request<void>(`/api/inventory/transfer/${id}/void`, 'POST'),
    remove: (id: string) => request<void>(`/api/inventory/transfer/${id}`, 'DELETE'),
  },
  stocktake: {
    list: (params: PaginationParams & {
      status?: string;
      stocktakeDateStart?: string;
      stocktakeDateEnd?: string;
      warehouseName?: string;
    }) =>
      request<PaginationResult<InventoryStocktake>>('/api/inventory/stocktake', 'GET', null, params),
    get: (id: string) => request<InventoryStocktake>(`/api/inventory/stocktake/${id}`),
    create: (data: any) => request<InventoryStocktake>('/api/inventory/stocktake', 'POST', data),
    approve: (id: string) => request<void>(`/api/inventory/stocktake/${id}/approve`, 'POST'),
    post: (id: string) => request<void>(`/api/inventory/stocktake/${id}/post`, 'POST'),
    remove: (id: string) => request<void>(`/api/inventory/stocktake/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/inventory/stocktake/${id}/void`, 'POST'),
  },
  warning: {
    list: (params: PaginationParams & { warningType?: string; warehouseId?: string }) =>
      request<PaginationResult<InventoryWarningItem>>('/api/inventory/warning', 'GET', null, params),
  },
};
