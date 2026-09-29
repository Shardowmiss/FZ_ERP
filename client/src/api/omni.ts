import { request } from './request';
import type {
  SalesChannel,
  OmniOrder,
  OmniOrderDetail,
  OmniAllocateResult,
  OmniShipResult,
} from '@shared/api.interface';

export const omniApi = {
  channels: () => request<SalesChannel[]>('/api/omni/channels'),
  createChannel: (body: Partial<SalesChannel>) =>
    request<SalesChannel>('/api/omni/channels', 'POST', body),
  orders: (page = 1, pageSize = 20, status?: string, channelId?: string) =>
    request<{ list: OmniOrder[]; total: number }>('/api/omni/orders', 'GET', null, {
      page,
      pageSize,
      status,
      channelId,
    }),
  order: (id: string) => request<OmniOrderDetail>(`/api/omni/orders/${id}`),
  createOrder: (body: unknown) =>
    request<OmniOrder>('/api/omni/orders', 'POST', body),
  audit: (orderId: string) =>
    request<{ updated: number }>('/api/omni/orders/audit', 'POST', { orderId }),
  allocate: (orderId: string) =>
    request<OmniAllocateResult>('/api/omni/orders/allocate', 'POST', { orderId }),
  ship: (orderId: string) =>
    request<OmniShipResult>('/api/omni/orders/ship', 'POST', { orderId }),
};
