import { request } from './request';
import type {
  PaginationParams, PaginationResult,
  Receivable, Payable, ProfitAnalysis,
  DashboardStats, SalesTrendItem, TopStyleItem, InventoryWarningItem,
  MonthCloseRecord, MonthCloseDetailResponse,
  FinanceReceipt,
  FinancePayment,
} from '@shared/api.interface';

export const financeApi = {
  receivable: {
    list: (params: PaginationParams & { customerId?: string; status?: string; keyword?: string }) =>
      request<PaginationResult<Receivable>>('/api/finance/receivable', 'GET', null, params),
    get: (id: string) => request<Receivable & { payments: any[] }>(`/api/finance/receivable/${id}`),
    payment: (id: string, data: { paymentDate: string; amount: number; paymentMethod?: string; remark?: string }) =>
      request<void>(`/api/finance/receivable/${id}/payment`, 'POST', data),
  },
  payable: {
    list: (params: PaginationParams & { supplierId?: string; status?: string; keyword?: string }) =>
      request<PaginationResult<Payable>>('/api/finance/payable', 'GET', null, params),
    get: (id: string) => request<Payable & { payments: any[] }>(`/api/finance/payable/${id}`),
    payment: (id: string, data: { paymentDate: string; amount: number; paymentMethod?: string; remark?: string }) =>
      request<void>(`/api/finance/payable/${id}/payment`, 'POST', data),
  },
  profit: {
    order: (orderId: string) =>
      request<ProfitAnalysis>('/api/finance/profit/order', 'GET', null, { orderId }),
  },
  monthClose: {
    list: () =>
      request<MonthCloseRecord[]>('/api/finance/month-close'),
    close: (id: string) =>
      request<MonthCloseRecord>(`/api/finance/month-close/${id}/close`, 'POST'),
    reopen: (id: string, data?: { remark?: string }) =>
      request<MonthCloseRecord>(`/api/finance/month-close/${id}/reopen`, 'POST', data),
    getDetail: (id: string) =>
      request<MonthCloseDetailResponse>(`/api/finance/month-close/${id}/detail`),
  },
  receipt: {
    list: (params: PaginationParams & {
      customerId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<FinanceReceipt>>(
        '/api/finance/receipt', 'GET', null, params),
    get: (id: string) => request<FinanceReceipt>(
      `/api/finance/receipt/${id}`),
    create: (data: any) => request<FinanceReceipt>(
      '/api/finance/receipt', 'POST', data),
    update: (id: string, data: any) => request<FinanceReceipt>(
      `/api/finance/receipt/${id}`, 'PATCH', data),
    remove: (id: string) => request<void>(
      `/api/finance/receipt/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/finance/receipt/${id}/void`, 'POST'),
    approve: (id: string) => request<void>(
      `/api/finance/receipt/${id}/approve`, 'POST'),
  },
  payment: {
    list: (params: PaginationParams & {
      supplierId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<FinancePayment>>(
        '/api/finance/payment', 'GET', null, params),
    get: (id: string) => request<FinancePayment>(
      `/api/finance/payment/${id}`),
    create: (data: any) => request<FinancePayment>(
      '/api/finance/payment', 'POST', data),
    update: (id: string, data: any) => request<FinancePayment>(
      `/api/finance/payment/${id}`, 'PATCH', data),
    remove: (id: string) => request<void>(
      `/api/finance/payment/${id}`, 'DELETE'),

    void: (id: string) => request<void>(`/api/finance/payment/${id}/void`, 'POST'),
    approve: (id: string) => request<void>(
      `/api/finance/payment/${id}/approve`, 'POST'),
  },
};

export const dashboardApi = {
  stats: () => request<DashboardStats>('/api/dashboard/stats'),
  salesTrend: () => request<SalesTrendItem[]>('/api/dashboard/sales-trend'),
  topStyles: (limit: number = 10) => request<TopStyleItem[]>('/api/dashboard/top-styles', 'GET', null, { limit }),
  warnings: (limit: number = 10) => request<InventoryWarningItem[]>('/api/dashboard/warnings', 'GET', null, { limit }),
};
