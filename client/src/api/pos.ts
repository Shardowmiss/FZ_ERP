import { request } from './request';

export interface PosSession {
  id: string;
  storeId: string;
  storeName: string;
  cashierId?: string;
  cashierName?: string;
  openTime: string;
  closeTime?: string;
  openAmount: number;
  closeAmount: number;
  expectedAmount: number;
  difference: number;
  status: string;
  remark?: string;
}

export const posApi = {
  openSession: (data: any) =>
    request<{ id: string; existed: boolean }>('/api/pos/session/open', 'POST', data),
  getOpenSession: (storeId: string) =>
    request<PosSession | null>('/api/pos/session/open', 'GET', null, { storeId }),
  closeSession: (id: string, data: any) =>
    request<PosSession>(`/api/pos/session/${id}/close`, 'POST', data),
  listSessions: (params: Record<string, any>) =>
    request<any>('/api/pos/session/list', 'GET', null, params),
  checkout: (data: any) => request<any>('/api/pos/checkout', 'POST', data),
  quote: (data: {
    storeId: string;
    items: Array<{ skuId?: string; skuCode?: string; quantity: number }>;
  }) => request<any>('/api/pos/quote', 'POST', data),
};
