import { request } from './request';

export type ImportType = 'style' | 'sku';
export type RowStatusValue = 'ok' | 'existed' | 'unsupported' | 'missing_master';

export interface ImportRowResult {
  rowIndex: number;
  raw: Record<string, any>;
  status: RowStatusValue;
  reason?: string;
}

export interface ValidateResult {
  importType: ImportType;
  total: number;
  ok: number;
  existed: number;
  unsupported: number;
  missingMasterData: number;
  rows: ImportRowResult[];
}

export interface ProductImportSummary {
  total: number;
  ok: number;
  existed: number;
  unsupported: number;
  missingMasterData: number;
  inserted: number;
  skipped: number;
}

export interface ProductImportTaskView {
  id: string;
  importType: ImportType;
  status: 'draft' | 'approved' | 'superseded';
  fileName?: string | null;
  fileUrl?: string | null;
  totalRows: number;
  summary: ProductImportSummary;
  rows: ImportRowResult[];
  createdAt: string;
  createdBy?: string | null;
}

export const productImportApi = {
  /** 校验一批导入数据，返回逐行状态清单（不支持/已存在/主数据缺失） */
  validate: (importType: ImportType, rows: Record<string, any>[]) =>
    request<ValidateResult>('/api/base/product-import/validate', 'POST', { importType, rows }),

  /** 建立草稿：记录 Excel 原文件与解析数据；同类型旧草稿置 superseded */
  createDraft: (dto: {
    importType: ImportType;
    fileName?: string;
    fileUrl?: string;
    filePath?: string;
    bucketId?: string;
    rows: Record<string, any>[];
  }) => request<ProductImportTaskView>('/api/base/product-import/draft', 'POST', dto),

  /** 导入任务历史列表（可按 importType 过滤） */
  list: (importType?: ImportType) =>
    request<ProductImportTaskView[]>('/api/base/product-import/tasks', 'GET', null, importType ? { importType } : undefined),

  /** 导入任务详情（含逐行状态） */
  get: (id: string) =>
    request<ProductImportTaskView>(`/api/base/product-import/tasks/${id}`),

  /** 审核：将 ok 行批量写入商品库（仅新增、跳过已存在） */
  approve: (id: string) =>
    request<ProductImportTaskView>(`/api/base/product-import/tasks/${id}/approve`, 'POST', {}),
};
