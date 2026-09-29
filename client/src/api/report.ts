import { request } from './request';
import type {
  ReportPurchaseItem,
  ReportSalesItem,
  ReportRetailItem,
  ReportRetailSummary,
  ReportInventoryItem,
  ReportTransferItem,
  ReportStockMovementItem,
  PaginationResult,
  PivotConfig,
  PivotResponse,
} from '@shared/api.interface';

export interface ReportQueryParams {
  page: number;
  pageSize: number;
  startDate?: string;
  endDate?: string;
  partnerId?: string;
  partnerType?: string;
  keyword?: string;
  brand?: string;
  warehouseId?: string;
}

export interface PurchaseReportResult extends PaginationResult<ReportPurchaseItem> {
  summary: { totalQty: number; totalAmount: number };
}

export interface SalesReportResult extends PaginationResult<ReportSalesItem> {
  summary: { totalQty: number; totalAmount: number; totalDiscount: number };
}

export interface RetailReportResult extends PaginationResult<ReportRetailItem> {
  summary: { totalQty: number; totalAmount: number };
}

export interface InventoryReportResult extends PaginationResult<ReportInventoryItem> {
  summary: { totalQty: number; totalAmount: number };
}

export interface TransferReportResult extends PaginationResult<ReportTransferItem> {
  summary: { totalQty: number };
}

export interface StockMovementReportResult
  extends PaginationResult<ReportStockMovementItem> {
  summary: {
    beginQty: number;
    purchaseInQty: number;
    salesOutQty: number;
    retailOutQty: number;
    transferNetQty: number;
    endQty: number;
    endAmount: number;
  };
}

export const reportApi = {
  purchase: (params: ReportQueryParams) =>
    request<PurchaseReportResult>('/api/report/purchase', 'GET', null, params),
  sales: (params: ReportQueryParams) =>
    request<SalesReportResult>('/api/report/sales', 'GET', null, params),
  retail: (params: ReportQueryParams) =>
    request<RetailReportResult>('/api/report/retail', 'GET', null, params),
  retailSummary: (
    params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ) =>
    request<ReportRetailSummary>(
      '/api/report/retail/summary',
      'GET',
      null,
      params,
    ),
  inventory: (params: ReportQueryParams) =>
    request<InventoryReportResult>(
      '/api/report/inventory',
      'GET',
      null,
      params,
    ),
  transfer: (params: ReportQueryParams) =>
    request<TransferReportResult>(
      '/api/report/transfer',
      'GET',
      null,
      params,
    ),
  stockMovement: (params: ReportQueryParams) =>
    request<StockMovementReportResult>(
      '/api/report/stock-movement',
      'GET',
      null,
      params,
    ),
  exportPurchase: (
    _params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ): Promise<{ url: string }> => {
    return Promise.reject(new Error('导出功能开发中'));
  },
  exportSales: (
    _params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ): Promise<{ url: string }> => {
    return Promise.reject(new Error('导出功能开发中'));
  },
  exportRetail: (
    _params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ): Promise<{ url: string }> => {
    return Promise.reject(new Error('导出功能开发中'));
  },
  exportInventory: (
    _params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ): Promise<{ url: string }> => {
    return Promise.reject(new Error('导出功能开发中'));
  },
  exportTransfer: (
    _params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ): Promise<{ url: string }> => {
    return Promise.reject(new Error('导出功能开发中'));
  },
  exportStockMovement: (
    _params: Omit<ReportQueryParams, 'page' | 'pageSize'>,
  ): Promise<{ url: string }> => {
    return Promise.reject(new Error('导出功能开发中'));
  },
  pivot: (body: PivotConfig): Promise<PivotResponse> =>
    request<PivotResponse>('/api/report/pivot', 'POST', body),
};
