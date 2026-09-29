import { request } from './request';
import type {
  PaginationParams,
  PaginationResult,
  GarmentPurchaseOrder,
  GarmentPurchaseInbound,
  GarmentPurchaseReturn,
  MaterialPurchaseOrder,
  MaterialPurchaseInbound,
  MrpResult,
  MrpRequest,
  ProductionCostResult,
  Bom,
  CostSimulationResult,
  GrossRequirementResult,
  ProductionWorkOrder,
  ProductionMaterialIssue,
  ProductionFinishReceipt,
} from '@shared/api.interface';

export const garmentPurchaseApi = {
  order: {
    list: (params: PaginationParams & {
      supplierId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      styleNo?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<GarmentPurchaseOrder>>(
        '/api/purchase/garment-order', 'GET', null, params),
    get: (id: string) => request<GarmentPurchaseOrder>(`/api/purchase/garment-order/${id}`),
    create: (data: any) => request<GarmentPurchaseOrder>('/api/purchase/garment-order', 'POST', data),
    update: (id: string, data: any) => request<GarmentPurchaseOrder>(`/api/purchase/garment-order/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/purchase/garment-order/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/purchase/garment-order/${id}/void`, 'POST'),
    submit: (id: string) => request<void>(`/api/purchase/garment-order/${id}/submit`, 'POST'),
    approve: (id: string) => request<void>(`/api/purchase/garment-order/${id}/approve`, 'POST'),
    unapprove: (id: string) => request<void>(`/api/purchase/garment-order/${id}/unapprove`, 'POST'),
  },
  inbound: {
    list: (params: PaginationParams & { supplierId?: string; status?: string; orderNo?: string }) =>
      request<PaginationResult<GarmentPurchaseInbound>>(
        '/api/purchase/garment-inbound', 'GET', null, params),
    get: (id: string) => request<GarmentPurchaseInbound>(`/api/purchase/garment-inbound/${id}`),
    create: (data: any) => request<GarmentPurchaseInbound>('/api/purchase/garment-inbound', 'POST', data),
    approve: (id: string) => request<void>(`/api/purchase/garment-inbound/${id}/approve`, 'POST'),
    remove: (id: string) => request<void>(`/api/purchase/garment-inbound/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/purchase/garment-inbound/${id}/void`, 'POST'),
  },
  return: {
    list: (params: PaginationParams & { status?: string }) =>
      request<PaginationResult<GarmentPurchaseReturn>>(
        '/api/purchase/garment-return', 'GET', null, params),
    get: (id: string) => request<GarmentPurchaseReturn>(`/api/purchase/garment-return/${id}`),
    create: (data: any) => request<GarmentPurchaseReturn>('/api/purchase/garment-return', 'POST', data),
    approve: (id: string) => request<void>(`/api/purchase/garment-return/${id}/approve`, 'POST'),
    remove: (id: string) => request<void>(`/api/purchase/garment-return/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/purchase/garment-return/${id}/void`, 'POST'),
  },
};

export const productionApi = {
  bom: {
    list: (params: PaginationParams & { styleId?: string; keyword?: string }) =>
      request<PaginationResult<Bom>>('/api/production/bom', 'GET', null, params),
    get: (id: string) => request<Bom>(`/api/production/bom/${id}`),
    byStyle: (styleId: string) => request<Bom[]>(`/api/production/bom/by-style/${styleId}`),
    create: (data: any) => request<Bom>('/api/production/bom', 'POST', data),
    update: (id: string, data: any) => request<Bom>(`/api/production/bom/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/production/bom/${id}`, 'DELETE'),

    costSimulation: (styleId: string) =>
      request<CostSimulationResult>('/api/production/bom/cost-simulation', 'GET', null, { styleId }),
    grossRequirement: (styleId: string, quantity: number) =>
      request<GrossRequirementResult>('/api/production/bom/gross-requirement', 'GET', null, { styleId, quantity }),
  },
  materialPurchaseOrder: {
    list: (params: PaginationParams & {
      supplierId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    }) =>
      request<PaginationResult<MaterialPurchaseOrder>>(
        '/api/production/material-purchase-order', 'GET', null, params),
    get: (id: string) => request<MaterialPurchaseOrder>(
      `/api/production/material-purchase-order/${id}`),
    create: (data: any) => request<MaterialPurchaseOrder>(
      '/api/production/material-purchase-order', 'POST', data),
    update: (id: string, data: any) => request<MaterialPurchaseOrder>(
      `/api/production/material-purchase-order/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(
      `/api/production/material-purchase-order/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/production/material-purchase-order/${id}/void`, 'POST'),
    submit: (id: string) => request<void>(
      `/api/production/material-purchase-order/${id}/submit`, 'POST'),
    approve: (id: string) => request<void>(
      `/api/production/material-purchase-order/${id}/approve`, 'POST'),
    unapprove: (id: string) => request<void>(
      `/api/production/material-purchase-order/${id}/unapprove`, 'POST'),
  },
  materialPurchaseInbound: {
    list: (params: PaginationParams & { supplierId?: string; status?: string; orderNo?: string }) =>
      request<PaginationResult<MaterialPurchaseInbound>>(
        '/api/production/material-purchase-inbound', 'GET', null, params),
    get: (id: string) => request<MaterialPurchaseInbound>(
      `/api/production/material-purchase-inbound/${id}`),
    create: (data: any) => request<MaterialPurchaseInbound>(
      '/api/production/material-purchase-inbound', 'POST', data),
    approve: (id: string) => request<void>(
      `/api/production/material-purchase-inbound/${id}/approve`, 'POST'),
    remove: (id: string) => request<void>(
      `/api/production/material-purchase-inbound/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/production/material-purchase-inbound/${id}/void`, 'POST'),
  },
  mrp: {
    calculate: (data: MrpRequest) =>
      request<MrpResult>('/api/production/mrp/calculate', 'POST', data),
  },
  cost: {
    calculate: (data: { styleId: string; quantity: number; bomVersion?: string }) =>
      request<ProductionCostResult>('/api/production/cost/calculate', 'POST', data),
    byStyle: (styleId: string) =>
      request<ProductionCostResult>(`/api/production/cost/by-style/${styleId}`),
  },
  workOrder: {
    list: (params: PaginationParams & {
      styleId?: string;
      supplierId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<ProductionWorkOrder>>(
        '/api/production/work-order', 'GET', null, params),
    get: (id: string) => request<ProductionWorkOrder>(
      `/api/production/work-order/${id}`),
    create: (data: any) => request<ProductionWorkOrder>(
      '/api/production/work-order', 'POST', data),
    update: (id: string, data: any) => request<ProductionWorkOrder>(
      `/api/production/work-order/${id}`, 'PATCH', data),
    remove: (id: string) => request<void>(
      `/api/production/work-order/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/production/work-order/${id}/void`, 'POST'),
    approve: (id: string) => request<void>(
      `/api/production/work-order/${id}/approve`, 'POST'),
    issue: (id: string) => request<void>(
      `/api/production/work-order/${id}/issue`, 'POST'),
  },
  materialIssue: {
    list: (params: PaginationParams & {
      workOrderId?: string;
      warehouseId?: string;
      status?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<ProductionMaterialIssue>>(
        '/api/production/material-issue', 'GET', null, params),
    get: (id: string) => request<ProductionMaterialIssue>(
      `/api/production/material-issue/${id}`),
    create: (data: any) => request<ProductionMaterialIssue>(
      '/api/production/material-issue', 'POST', data),
    update: (id: string, data: any) => request<ProductionMaterialIssue>(
      `/api/production/material-issue/${id}`, 'PATCH', data),
    remove: (id: string) => request<void>(
      `/api/production/material-issue/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/production/material-issue/${id}/void`, 'POST'),
    approve: (id: string) => request<void>(
      `/api/production/material-issue/${id}/approve`, 'POST'),
  },
  finishReceipt: {
    list: (params: PaginationParams & {
      workOrderId?: string;
      warehouseId?: string;
      status?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<ProductionFinishReceipt>>(
        '/api/production/finish-receipt', 'GET', null, params),
    get: (id: string) => request<ProductionFinishReceipt>(
      `/api/production/finish-receipt/${id}`),
    create: (data: any) => request<ProductionFinishReceipt>(
      '/api/production/finish-receipt', 'POST', data),
    update: (id: string, data: any) => request<ProductionFinishReceipt>(
      `/api/production/finish-receipt/${id}`, 'PATCH', data),
    remove: (id: string) => request<void>(
      `/api/production/finish-receipt/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/production/finish-receipt/${id}/void`, 'POST'),
    approve: (id: string) => request<void>(
      `/api/production/finish-receipt/${id}/approve`, 'POST'),
  },
};
