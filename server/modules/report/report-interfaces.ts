/**
 * report 模块对外契约（参数 / 结果接口）。
 *
 * 从原 `report.service.ts` 抽出：拆分后 7 个报表子服务与门面共用同一组接口，
 * 集中在这里可避免"门面 ↔ 子服务"循环依赖（纯类型文件，无运行时依赖）。
 * 这些类型只引用 `@shared/api.interface` 的 item 类型，不涉及本模块内部类，
 * 因此不会引入循环引用。
 */

import type {
  ReportPurchaseItem,
  ReportSalesItem,
  ReportRetailItem,
  ReportInventoryItem,
  ReportTransferItem,
  ReportStockMovementItem,
  ReportSummaryBase,
  ReportRetailSummary,
} from '@shared/api.interface';

export interface BaseQueryParams {
  startDate?: string;
  endDate?: string;
  partnerIds?: string;
  keyword?: string;
  brand?: string;
  page: number;
  pageSize: number;
  /** 显式豁免时间窗（全量扫描）。默认 false。 */
  allowFullRange?: boolean;
}

export interface InventoryQueryParams {
  warehouseId?: string;
  keyword?: string;
  brand?: string;
  page: number;
  pageSize: number;
}

export interface StockMovementQueryParams {
  startDate?: string;
  endDate?: string;
  warehouseId?: string;
  keyword?: string;
  brand?: string;
  page: number;
  pageSize: number;
}

export interface RetailSummaryParams {
  startDate?: string;
  endDate?: string;
  storeId?: string;
  brand?: string;
  allowFullRange?: boolean;
}

export interface PurchaseReportResult {
  items: ReportPurchaseItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportSummaryBase;
}

export interface SalesReportResult {
  items: ReportSalesItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportSummaryBase & { totalDiscountAmount: number };
}

export interface RetailReportResult {
  items: ReportRetailItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportRetailSummary;
}

export interface InventoryReportResult {
  items: ReportInventoryItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportSummaryBase;
}

export interface TransferReportResult {
  items: ReportTransferItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportSummaryBase;
}

export interface StockMovementSummary {
  beginQty: number;
  purchaseInQty: number;
  salesOutQty: number;
  retailOutQty: number;
  transferNetQty: number;
  endQty: number;
  endAmount: number;
}

export interface StockMovementReportResult {
  items: ReportStockMovementItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: StockMovementSummary;
}
