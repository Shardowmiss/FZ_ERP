import { request } from './request';
import type {
  PaginationParams,
  PaginationResult,
  TradeShow,
  PreOrder,
  PreOrderSummary,
  PreOrderSkuSummary,
  AllocationOrder,
} from '@shared/api.interface';

export const tradeShowApi = {
  list: (
    params: PaginationParams & { keyword?: string; status?: string },
  ) =>
    request<PaginationResult<TradeShow>>(
      '/api/trade-show',
      'GET',
      null,
      params,
    ),
  get: (id: string) => request<TradeShow>(`/api/trade-show/${id}`),
  create: (data: Partial<TradeShow>) =>
    request<TradeShow>('/api/trade-show', 'POST', data),
  update: (id: string, data: Partial<TradeShow>) =>
    request<TradeShow>(`/api/trade-show/${id}`, 'PUT', data),
  remove: (id: string) =>
    request<void>(`/api/trade-show/${id}`, 'DELETE'),

  void: (id: string) => request<void>(`/api/trade-show/${id}/void`, 'POST'),
  options: () =>
    request<{ id: string; showNo: string; name: string; status: string }[]>(
      '/api/trade-show/options',
    ),
  start: (id: string) =>
    request<void>(`/api/trade-show/${id}/start`, 'POST'),
  end: (id: string) => request<void>(`/api/trade-show/${id}/end`, 'POST'),
  close: (id: string) =>
    request<void>(`/api/trade-show/${id}/close`, 'POST'),

  preOrder: {
     list: (
       params: PaginationParams & {
         tradeShowId?: string;
         submitterType?: string;
         status?: string;
         styleId?: string;
         keyword?: string;
         brand?: string;
       },
     ) =>
      request<PaginationResult<PreOrder>>(
        '/api/trade-show/pre-order',
        'GET',
        null,
        params,
      ),
    get: (id: string) =>
      request<PreOrder>(`/api/trade-show/pre-order/${id}`),
    create: (data: any) =>
      request<PreOrder>('/api/trade-show/pre-order', 'POST', data),
    update: (id: string, data: any) =>
      request<PreOrder>(`/api/trade-show/pre-order/${id}`, 'PUT', data),
    remove: (id: string) =>
      request<void>(`/api/trade-show/pre-order/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/trade-show/pre-order/${id}/void`, 'POST'),
    submit: (id: string) =>
      request<void>(`/api/trade-show/pre-order/${id}/submit`, 'POST'),
    confirm: (id: string) =>
      request<void>(`/api/trade-show/pre-order/${id}/confirm`, 'POST'),
    reject: (id: string) =>
      request<void>(`/api/trade-show/pre-order/${id}/reject`, 'POST'),
  },

   summary: {
     byStyle: (tradeShowId: string, params?: { brand?: string }) =>
       request<PreOrderSummary[]>(`/api/trade-show/summary`, 'GET', null, {
         tradeShowId,
         ...params,
       }),
    bySku: (tradeShowId: string, styleId: string) =>
      request<PreOrderSkuSummary>(
        `/api/trade-show/summary/${styleId}`,
        'GET',
        null,
        { tradeShowId },
      ),
  },

   allocation: {
     list: (
       params: PaginationParams & {
         tradeShowId?: string;
         styleId?: string;
         status?: string;
         brand?: string;
       },
     ) =>
      request<PaginationResult<AllocationOrder>>(
        '/api/trade-show/allocation',
        'GET',
        null,
        params,
      ),
    get: (id: string) =>
      request<AllocationOrder>(`/api/trade-show/allocation/${id}`),
    create: (data: any) =>
      request<AllocationOrder>(
        '/api/trade-show/allocation',
        'POST',
        data,
      ),
    update: (id: string, data: any) =>
      request<AllocationOrder>(
        `/api/trade-show/allocation/${id}`,
        'PUT',
        data,
      ),
    remove: (id: string) =>
      request<void>(`/api/trade-show/allocation/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/trade-show/allocation/${id}/void`, 'POST'),
    approve: (id: string) =>
      request<void>(`/api/trade-show/allocation/${id}/approve`, 'POST'),
  },
};
