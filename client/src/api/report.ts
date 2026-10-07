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
  PivotTemplateItem,
  PivotSemanticsResponse,
  PivotSemanticAdminResponse,
  PivotSemanticInput,
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

  /* ========== 透视个人模板（迁移 0060） ==========
   * 模板与「最后一次查询」均按当前登录用户隔离，用户看不到也不该看到他人的。
   */

  /** 我的模板列表（含 isLastUsed 标记，最近更新在前） */
  listPivotTemplates: (): Promise<PivotTemplateItem[]> =>
    request<PivotTemplateItem[]>('/api/report/pivot/templates', 'GET'),

  /** 保存为我的模板（同名则后端覆盖） */
  savePivotTemplate: (body: {
    name: string;
    config: PivotConfig;
    remark?: string;
  }): Promise<{ id: string; name: string; dataSource: string }> =>
    request<{ id: string; name: string; dataSource: string }>(
      '/api/report/pivot/templates',
      'POST',
      body,
    ),

  /** 记住我最后一次查询（每次查询后调用，自动覆盖旧的） */
  rememberPivotLastQuery: (config: PivotConfig): Promise<{ remembered: boolean }> =>
    request<{ remembered: boolean }>('/api/report/pivot/templates/last', 'POST', config),

  /** 恢复我最后一次查询；从未记录过返回 null */
  getPivotLastQuery: (): Promise<PivotConfig | null> =>
    request<PivotConfig | null>('/api/report/pivot/templates/last', 'GET'),

  /** 删除我的模板 */
  deletePivotTemplate: (id: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/report/pivot/templates/${id}`, 'DELETE'),

  /**
   * 透视语义清单（迁移 0061）：维度/指标的标签、分类、格式化与毛利可见性。
   * 前端维度选择器读本接口，新增维度时无需再维护前端中文字典。
   */
  pivotSemantics: (): Promise<PivotSemanticsResponse> =>
    request<PivotSemanticsResponse>('/api/report/pivot/semantics', 'GET'),

  /* ========== 透视语义层管理（#758） ==========
   * 权限码为 system:config（系统-配置），与 report:pivot 分开——
   * 用透视是使用权限，改全局口径是配置权限，不可混同。
   */

  /** 语义全量列表（含停用）+ 引擎白名单快照 */
  pivotSemanticAdmin: (): Promise<PivotSemanticAdminResponse> =>
    request<PivotSemanticAdminResponse>('/api/report/pivot/semantic-admin', 'GET'),

  /** 新增语义（引擎未实现的 key 服务端会拒绝） */
  createPivotSemantic: (body: PivotSemanticInput): Promise<{ key: string }> =>
    request<{ key: string }>('/api/report/pivot/semantic-admin', 'POST', body),

  /** 编辑语义（key 不可改） */
  updatePivotSemantic: (
    key: string,
    body: Partial<PivotSemanticInput>,
  ): Promise<{ key: string }> =>
    request<{ key: string }>(`/api/report/pivot/semantic-admin/${key}`, 'PUT', body),

  /** 停用语义（保留 key，避免历史个人模板失效） */
  disablePivotSemantic: (key: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/report/pivot/semantic-admin/${key}`, 'DELETE'),
};
