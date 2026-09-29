import { request } from './request';
import type { PaginationParams, PaginationResult, Bom, CostSimulationResult } from '@shared/api.interface';

export const bomApi = {
  list: (params: PaginationParams & { styleId?: string; keyword?: string }) =>
    request<PaginationResult<Bom>>('/api/bom', 'GET', null, params),
  get: (id: string) => request<Bom>(`/api/bom/${id}`),
  create: (data: any) => request<Bom>('/api/bom', 'POST', data),
  update: (id: string, data: any) => request<Bom>(`/api/bom/${id}`, 'PUT', data),
  remove: (id: string) => request<void>(`/api/bom/${id}`, 'DELETE'),

  byStyle: (styleId: string) => request<Bom[]>(`/api/bom/by-style/${styleId}`),
  costSimulation: (styleId: string) =>
    request<CostSimulationResult>('/api/bom/cost-simulation', 'GET', null, { styleId }),
  grossRequirement: (styleId: string, quantity: number) =>
    request<any>('/api/bom/gross-requirement', 'GET', null, { styleId, quantity }),
};
