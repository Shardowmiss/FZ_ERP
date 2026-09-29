import { request } from './request';

/* ------------------------------------------------------------------ *
 * 唯一码引擎 API（/api/unique-code）
 * ------------------------------------------------------------------ */

/** 扫码解析结果 */
export interface ParseTagResult {
  styleNo: string;
  color: string;
  size: string;
  uniqueCode?: string;
  skuId?: string;
  matched: boolean;
  message?: string;
}

/** 出库/核销/退货的单条结果 */
export interface ScanResult {
  ok: boolean;
  reason?: string;
  message: string;
  data?: {
    uniqueCode: string;
    skuId: string;
    styleNo: string;
    color: string;
    size: string;
  };
}

export interface UniqueCodeStockRow {
  id: string;
  uniqueCode: string;
  numericValue?: number | null;
  skuId: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseId: string;
  status: 'in_stock' | 'out' | 'sold' | 'returned';
  inboundDocType?: string | null;
  inboundDocId?: string | null;
  outboundDocType?: string | null;
  outboundDocId?: string | null;
}

/** 拒绝原因 → 面向操作员的中文提示 */
export const SCAN_REJECT_TEXT: Record<string, string> = {
  disabled: '唯一码功能未启用，无法扫码校验',
  missing_unique_code: '缺少唯一码',
  bad_checksum: '校验位不合法，疑似错扫或伪造吊牌（防串货拦截）',
  already_scanned: '该唯一码已在本单据扫描过，请勿重复',
  not_in_stock: '库存不存在：该唯一码未入库过，不允许出库',
  not_available: '该唯一码当前状态不可出库（已出库/已售）',
  wrong_warehouse: '串货拦截：该唯一码不属于本发货仓库',
  style_mismatch: '款色码不符：吊牌与单据明细不一致',
  invalid_state: '唯一码状态不允许该操作',
};

export const uniqueCodeApi = {
  /** 扫码解析：识别款色码（+唯一码），并做校验位防伪校验 */
  parse: (data: { raw: string; separator?: string; validateChecksum?: boolean }) =>
    request<ParseTagResult>('/api/unique-code/parse', 'POST', data),

  /** 入库登记（采购入库 / 调拨入库 / 退货回库） */
  registerInbound: (data: {
    docType: string;
    docId: string;
    warehouseId: string;
    items: {
      styleNo: string;
      color: string;
      size: string;
      uniqueCode?: string;
      skuId?: string;
    }[];
    operatorId?: string;
  }) => request<{ enabled: boolean; registered: number; message: string }>(
    '/api/unique-code/register-inbound', 'POST', data),

  /** 出库扫码校验（六拒绝 + 同单去重） */
  scanOutbound: (data: {
    docType: string;
    docId: string;
    docItemId?: string;
    warehouseId: string;
    styleNo: string;
    color: string;
    size: string;
    uniqueCode: string;
  }) => request<ScanResult>('/api/unique-code/scan-outbound', 'POST', data),

  /** 单据扫码统一入口：inbound / outbound / return / sold */
  scanDocument: (data: {
    direction: 'inbound' | 'outbound' | 'return' | 'sold';
    docType: string;
    docId: string;
    warehouseId: string;
    docItemId?: string;
    items: {
      styleNo?: string;
      color?: string;
      size?: string;
      uniqueCode?: string;
      skuId?: string;
    }[];
  }) => request<{ direction: string; total?: number; okCount?: number; results: ScanResult[] }>(
    '/api/unique-code/scan-document', 'POST', data),

  /** 调拨扫码：源仓出库 + 目标仓入库 */
  scanTransfer: (data: {
    docId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    items: { styleNo: string; color: string; size: string; uniqueCode: string }[];
  }) => request<{ allOk: boolean; total: number; results: any[] }>(
    '/api/unique-code/scan-transfer', 'POST', data),

  /** 盘点扫码对账：实扫 vs 在库，输出盘亏/盘盈 */
  stocktake: (data: {
    docId: string;
    warehouseId: string;
    scannedCodes: string[];
    styleNo?: string;
    color?: string;
    size?: string;
  }) => request<{
    enabled: boolean;
    scannedCount: number;
    expectedCount: number;
    missing: { uniqueCode: string; styleNo: string; color: string; size: string }[];
    extra: string[];
  }>('/api/unique-code/stocktake', 'POST', data),

  /** 结算核销 out → sold */
  verifySold: (data: { docType: string; docId: string; uniqueCode: string }) =>
    request<ScanResult>('/api/unique-code/verify-sold', 'POST', data),

  /** 退货回滚 out/sold → in_stock */
  returnCode: (data: { docType: string; docId: string; warehouseId: string; uniqueCode: string }) =>
    request<ScanResult>('/api/unique-code/return', 'POST', data),

  /** 查询唯一码件级库存状态 */
  stock: (code: string) =>
    request<UniqueCodeStockRow | null>(`/api/unique-code/stock/${encodeURIComponent(code)}`, 'GET'),

  /** 生命周期报表 */
  lifecycleReport: (params?: { warehouseId?: string; styleNo?: string }) =>
    request<{
      enabled: boolean;
      byStatus: { status: string; count: number }[];
      byWarehouse: { warehouseId: string; status: string; count: number }[];
      byStyle: { styleNo: string; status: string; count: number }[];
      anomalies: { stuckInStock: number; noOutbound: number };
    }>('/api/unique-code/lifecycle-report', 'GET', null, params),

  /** 唯一码溯源：单码历史出入库查询 */
  trace: (code: string, params?: { from?: string; to?: string; eventTypes?: string }) =>
    request<UniqueCodeTrace>('/api/unique-code/trace/' + encodeURIComponent(code), 'GET', null, params),

  /** 按 SKU 批量溯源 */
  traceBySku: (skuId: string) =>
    request<{
      enabled: boolean;
      skuId: string;
      totalCodes: number;
      items: {
        uniqueCode: string;
        status: string;
        statusLabel: string;
        warehouseId: string | null;
        warehouseName: string | null;
        eventCount: number;
        firstAt: string | null;
        lastAt: string | null;
        lastOutAt: string | null;
      }[];
    }>('/api/unique-code/trace-by-sku', 'GET', null, { skuId }),

  /** 溯源导出 CSV（返回 Blob 下载） */
  traceExportUrl: (code: string) =>
    `/api/unique-code/trace-export?code=${encodeURIComponent(code)}`,

  /** 跨区间批量溯源（扁平件级流水） */
  traceRange: (params?: {
    from?: string; to?: string; skuId?: string; styleNo?: string;
    color?: string; size?: string; warehouseId?: string; eventTypes?: string; limit?: number;
  }) => request<{
    enabled: boolean;
    total: number;
    rows: UniqueCodeTraceEvent[];
  }>('/api/unique-code/trace-range', 'GET', null, params),

  /** 串货违规检出 */
  channelViolations: (params?: { skuId?: string; styleNo?: string; warehouseId?: string }) =>
    request<{
      enabled: boolean;
      total: number;
      items: {
        uniqueCode: string;
        styleNo: string | null;
        color: string | null;
        size: string | null;
        originWarehouseId: string | null;
        originWarehouseName: string | null;
        violationWarehouseId: string | null;
        violationWarehouseName: string | null;
        violationDocNo: string | null;
        violationAt: string | null;
        status: string | null;
      }[];
    }>('/api/unique-code/channel-violations', 'GET', null, params),

  /** 公开溯源摘要（消费者自查，无需登录；不含操作人/内部单号） */
  publicTrace: (code: string) =>
    request<PublicTrace>('/api/trace-public/' + encodeURIComponent(code), 'GET'),

  /** 归档统计（热表/归档表条数与时间范围），管理员可见 */
  archiveStats: () =>
    request<{
      hot: { count: number; minAt: string | null; maxAt: string | null };
      archive: { count: number; minAt: string | null; maxAt: string | null };
    }>('/api/unique-code/trace-archive-stats', 'GET'),

  /** 按天数归档：将早于 N 天的流水从热表搬移到归档表；days<=0 不归档 */
  archiveByDays: (days: number, batchSize?: number) =>
    request<{ moved: number; before: string; days: number; enabled: boolean }>(
      '/api/unique-code/trace-archive', 'POST', { days, batchSize }),
};

/**
 * 公开溯源二维码地址（SVG）。直接作为 <img src> 使用（浏览器不携带自定义鉴权头，
 * 故该接口必须是 @Public()）。扫码后跳转公开溯源页 /trace/<code>。
 * size 可选（默认 240px）。
 */
export function publicTraceQrUrl(code: string, size?: number): string {
  const base = `/api/trace-public/qr/${encodeURIComponent(code)}`;
  return size ? `${base}?size=${size}` : base;
}

/** 溯源事件 */
export interface UniqueCodeTraceEvent {
  seq?: number;
  scanType: string;
  eventType: string;
  direction: '入' | '出' | '核' | '退';
  docType: string;
  docTypeName: string;
  docId: string;
  docNo: string | null;
  operatorId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  scanAt: string;
  styleNo: string | null;
  color: string | null;
  size: string | null;
  crossesChannel?: boolean;
  uniqueCode?: string;
}

/** 溯源结果（单码） */
export interface UniqueCodeTrace {
  enabled: boolean;
  uniqueCode: string;
  channelCrossingSuspect: boolean;
  current: null | {
    status: string;
    statusLabel: string;
    styleNo: string;
    color: string;
    size: string;
    warehouseId: string;
    warehouseName: string | null;
    inboundDocType: string | null;
    inboundDocTypeName: string | null;
    inboundDocId: string | null;
    inboundDocNo: string | null;
    inboundAt: string | null;
    outboundDocType: string | null;
    outboundDocTypeName: string | null;
    outboundDocId: string | null;
    outboundDocNo: string | null;
    outboundAt: string | null;
  };
  eventCount: number;
  events: UniqueCodeTraceEvent[];
}

/** 公开溯源摘要（与后端 getPublicTrace 对齐，消费者安全字段） */
export interface PublicTrace {
  found: boolean;
  authentic: boolean;
  uniqueCode: string;
  styleNo: string | null;
  color: string | null;
  size: string | null;
  currentStatusLabel: string | null;
  currentWarehouseName: string | null;
  purchaseOriginWarehouseName: string | null;
  channelCrossingSuspect: boolean;
  eventCount: number;
  events: {
    eventType: string;
    direction: '入' | '出' | '核' | '退';
    warehouseName: string | null;
    scanAt: string;
  }[];
}
