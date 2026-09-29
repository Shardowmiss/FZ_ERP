import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  count,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from 'drizzle-orm';
import {
  docUniqueCode,
  docUniqueCodeArchive,
  garmentPurchaseOrder,
  inventoryStocktake,
  inventoryTransfer,
  retailOrder,
  salesReturn,
  uniqueCodeStock,
  warehouse,
} from '@server/database/schema';
import { UniqueCodeConfigService } from './unique-code-config.service';
import { UniqueCodeScanService } from './unique-code-scan.service';
import {
  DOC_TYPE_LABEL,
  SCAN_TYPE_LABEL,
  STATUS_LABEL,
  directionOf,
} from './unique-code.tokens';

/**
 * 唯一码引擎【域⑤：追溯与串货】。
 *
 * 职责边界：只读域，负责把 doc_unique_code(+归档表) 的流水还原成"件级故事"。
 *  - resolveDocNo / evalChannelCrossing(+Detail) / channelCrossingCodeSet / scopeCond / selectEventsBoth：
 *    「溯源原语」，热表 + 归档表合并读取，归档后仍可完整追溯；
 *  - getTrace / getTraceBySku / getTraceByRange / getChannelViolations：单码 / SKU / 区间 / 违规检出四类查询；
 *  - buildTraceCsv：溯源结果导出；getLifecycleReport：生命周期报表。
 *
 * 依赖：配置①、扫描域④（取当前库存快照），无反向依赖，DI 无环。
 */
@Injectable()
export class UniqueCodeTraceService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
    private readonly config: UniqueCodeConfigService,
    private readonly scan: UniqueCodeScanService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 溯源原语                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 单据号解析：根据 doc_type + doc_id 反查业务表，返回人读业务单号（替代内部 UUID）。
   * 覆盖采购入库单 / 零售单 / 销售退货单 / 调拨单 / 盘点单。无匹配返回 null（不影响溯源主流程）。
   * 这是 P0 增强：让溯源时间线直接显示「采购单号/零售单号」而非系统内部 id。
   */
  async resolveDocNo(docType: string, docId: string): Promise<string | null> {
    try {
      switch (docType) {
        case 'purchase_inbound': {
          const r = await this.db
            .select({ no: garmentPurchaseOrder.orderNo })
            .from(garmentPurchaseOrder)
            .where(eq(garmentPurchaseOrder.id, docId))
            .limit(1);
          return r[0]?.no ?? null;
        }
        case 'retail': {
          const r = await this.db
            .select({ no: retailOrder.retailNo })
            .from(retailOrder)
            .where(eq(retailOrder.id, docId))
            .limit(1);
          return r[0]?.no ?? null;
        }
        case 'sales_return': {
          const r = await this.db
            .select({ no: salesReturn.returnNo })
            .from(salesReturn)
            .where(eq(salesReturn.id, docId))
            .limit(1);
          return r[0]?.no ?? null;
        }
        case 'transfer': {
          const r = await this.db
            .select({ no: inventoryTransfer.transferNo })
            .from(inventoryTransfer)
            .where(eq(inventoryTransfer.id, docId))
            .limit(1);
          return r[0]?.no ?? null;
        }
        case 'stocktake': {
          const r = await this.db
            .select({ no: inventoryStocktake.stocktakeNo })
            .from(inventoryStocktake)
            .where(eq(inventoryStocktake.id, docId))
            .limit(1);
          return r[0]?.no ?? null;
        }
        default:
          return null;
      }
    } catch {
      // 业务表不存在或字段差异：容错，溯源仍按内部 id 展示
      return null;
    }
  }

  /** 串货判定：给定事件序列，判断该件是否"在未经调拨的情况下，从非原始采购入库仓被销售出库"。 */
  private evalChannelCrossing(
    events: { scanType: string; docType: string; warehouseId: string | null }[],
  ): { suspect: boolean; crosses: Map<string, boolean> } {
    const inboundEvents = events.filter((e) => e.scanType === 'inbound');
    // 原始采购入库仓 = 最早的 inbound 事件所在仓
    const originWh = inboundEvents.length ? inboundEvents[0].warehouseId : null;
    const hasTransfer = events.some(
      (e) => e.docType === 'transfer' && e.scanType === 'inbound',
    );
    const crosses = new Map<string, boolean>();
    let suspect = false;
    events.forEach((e, i) => {
      const isOut = e.scanType === 'outbound' || e.scanType === 'sold';
      const flag =
        !!isOut &&
        !!originWh &&
        !!e.warehouseId &&
        e.warehouseId !== originWh &&
        !hasTransfer;
      if (flag) suspect = true;
      crosses.set(String(i), flag);
    });
    return { suspect, crosses };
  }

  /**
   * 通用件级流水过滤条件构造（按给定表构建，供热表 / 归档表复用）。
   * 返回 undefined 表示无额外过滤（仅有 uniqueCode 等主键过滤或全表）。
   */
  private scopeCond(
    table: any,
    opts: {
      uniqueCode?: string;
      skuId?: string;
      styleNo?: string;
      color?: string;
      size?: string;
      warehouseId?: string;
      from?: Date;
      to?: Date;
      eventTypes?: string[];
    },
  ) {
    const w: any[] = [];
    if (opts.uniqueCode) w.push(eq(table.uniqueCode, opts.uniqueCode));
    if (opts.skuId) w.push(eq(table.skuId, opts.skuId));
    if (opts.styleNo) w.push(eq(table.styleNo, opts.styleNo));
    if (opts.color) w.push(eq(table.color, opts.color));
    if (opts.size) w.push(eq(table.size, opts.size));
    if (opts.warehouseId) w.push(eq(table.warehouseId, opts.warehouseId));
    if (opts.from) w.push(gte(table.scanAt, opts.from));
    if (opts.to) w.push(lte(table.scanAt, opts.to));
    if (opts.eventTypes && opts.eventTypes.length) {
      w.push(inArray(table.scanType, opts.eventTypes));
    }
    return w.length ? (w.length === 1 ? w[0] : and(...w)) : undefined;
  }

  /**
   * 同时读取【热表 + 归档表】的件级流水，合并并按 scan_at 升序返回。
   * 这是 P2 冷热分离的关键：归档后的历史事件仍可在溯源查询中完整呈现，
   * 不影响 getTrace / getTraceBySku / getTraceByRange 的结果完整性。
   */
  private async selectEventsBoth(opts: {
    uniqueCode?: string;
    skuId?: string;
    styleNo?: string;
    color?: string;
    size?: string;
    warehouseId?: string;
    from?: Date;
    to?: Date;
    eventTypes?: string[];
  }): Promise<any[]> {
    const sel = (t: any) => ({
      uniqueCode: t.uniqueCode,
      docType: t.docType,
      docId: t.docId,
      docItemId: t.docItemId,
      skuId: t.skuId,
      styleNo: t.styleNo,
      color: t.color,
      size: t.size,
      scanType: t.scanType,
      warehouseId: t.warehouseId,
      operatorId: t.operatorId,
      scanAt: t.scanAt,
    });
    const [hot, arc] = await Promise.all([
      this.db
        .select(sel(docUniqueCode))
        .from(docUniqueCode)
        .where(this.scopeCond(docUniqueCode, opts) as any),
      this.db
        .select(sel(docUniqueCodeArchive))
        .from(docUniqueCodeArchive)
        .where(this.scopeCond(docUniqueCodeArchive, opts) as any),
    ]);
    const merged = [...hot, ...arc] as any[];
    merged.sort((a, b) => {
      const ta = a.scanAt instanceof Date ? a.scanAt.getTime() : new Date(a.scanAt).getTime();
      const tb = b.scanAt instanceof Date ? b.scanAt.getTime() : new Date(b.scanAt).getTime();
      return ta - tb;
    });
    return merged;
  }

  /* ---------------------------------------------------------------- */
  /* 单码溯源                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 唯一码溯源：给定唯一码，返回其完整件级生命周期流水（按 scan_at 升序），
   * 并附带当前状态快照（含当前仓库名、出入库单据）。满足"唯一历史出入库查询"。
   *
   * 数据来源：
   *  - 当前状态：unique_code_stock（当前仓库/状态/最近出入库单据）；
   *  - 历史流水：doc_unique_code（每一次扫码动作，含 scan_at 时间戳与当时仓库）。
   *
   * 说明：doc_unique_code 已记录每个动作的 warehouse_id，配合入库/出库/退货/核销语义
   * 即可还原"从哪个仓出、入到哪个仓、在哪核销、何时退回"，天然构成出入库溯源链。
   */
  async getTrace(
    uniqueCode: string,
    opts?: { from?: Date; to?: Date; eventTypes?: string[] },
  ): Promise<{
    enabled: boolean;
    uniqueCode: string;
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
      inboundAt: Date | null;
      outboundDocType: string | null;
      outboundDocTypeName: string | null;
      outboundDocId: string | null;
      outboundDocNo: string | null;
      outboundAt: Date | null;
    };
    channelCrossingSuspect: boolean;
    eventCount: number;
    events: {
      seq: number;
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
      scanAt: Date;
      styleNo: string | null;
      color: string | null;
      size: string | null;
      crossesChannel: boolean;
    }[];
  }> {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return {
        enabled: false,
        uniqueCode,
        current: null,
        channelCrossingSuspect: false,
        eventCount: 0,
        events: [],
      };
    }

    const cur = await this.scan.getUniqueCodeStock(uniqueCode);
    let currentWarehouseName: string | null = null;
    if (cur) {
      const wh = await this.db
        .select({ name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, cur.warehouseId))
        .limit(1);
      currentWarehouseName = wh[0]?.name ?? null;
    }

    // 同时读取热表 + 归档表（P2 冷热分离：归档事件仍须可溯源）
    const rows = await this.selectEventsBoth({
      uniqueCode,
      from: opts?.from,
      to: opts?.to,
      eventTypes: opts?.eventTypes,
    });

    const whIds = Array.from(
      new Set(rows.map((r) => r.warehouseId).filter(Boolean) as string[]),
    );
    const whRows = whIds.length
      ? await this.db
          .select({ id: warehouse.id, name: warehouse.name })
          .from(warehouse)
          .where(inArray(warehouse.id, whIds))
      : [];
    const whMap = new Map(whRows.map((w) => [w.id, w.name]));

    // 批量解析业务单号：每个 (docType,docId) 只解析一次
    const docKeySet = new Set(rows.map((r) => `${r.docType}::${r.docId}`));
    const docNoMap = new Map<string, string | null>();
    for (const key of docKeySet) {
      const [dt, did] = key.split('::');
      docNoMap.set(key, await this.resolveDocNo(dt, did));
    }

    const { suspect, crosses } = this.evalChannelCrossing(rows);

    const events = rows.map((r, i) => ({
      seq: i + 1,
      scanType: r.scanType,
      eventType: SCAN_TYPE_LABEL[r.scanType] ?? r.scanType,
      direction: directionOf(r.scanType),
      docType: r.docType,
      docTypeName: DOC_TYPE_LABEL[r.docType] ?? r.docType,
      docId: r.docId,
      docNo: docNoMap.get(`${r.docType}::${r.docId}`) ?? null,
      operatorId: r.operatorId ?? null,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseId ? (whMap.get(r.warehouseId) ?? null) : null,
      scanAt: r.scanAt,
      styleNo: r.styleNo,
      color: r.color,
      size: r.size,
      crossesChannel: crosses.get(String(i)) ?? false,
    }));

    const inboundDocNo = cur?.inboundDocType
      ? await this.resolveDocNo(cur.inboundDocType, cur.inboundDocId ?? '')
      : null;
    const outboundDocNo = cur?.outboundDocType
      ? await this.resolveDocNo(cur.outboundDocType, cur.outboundDocId ?? '')
      : null;

    return {
      enabled: true,
      uniqueCode,
      channelCrossingSuspect: suspect,
      current: cur
        ? {
            status: cur.status,
            statusLabel: STATUS_LABEL[cur.status] ?? cur.status,
            styleNo: cur.styleNo,
            color: cur.color,
            size: cur.size,
            warehouseId: cur.warehouseId,
            warehouseName: currentWarehouseName,
            inboundDocType: cur.inboundDocType,
            inboundDocTypeName: cur.inboundDocType
              ? DOC_TYPE_LABEL[cur.inboundDocType] ?? cur.inboundDocType
              : null,
            inboundDocId: cur.inboundDocId,
            inboundDocNo,
            inboundAt: cur.inboundAt,
            outboundDocType: cur.outboundDocType,
            outboundDocTypeName: cur.outboundDocType
              ? DOC_TYPE_LABEL[cur.outboundDocType] ?? cur.outboundDocType
              : null,
            outboundDocId: cur.outboundDocId,
            outboundDocNo,
            outboundAt: cur.outboundAt,
          }
        : null,
      eventCount: events.length,
      events,
    };
  }

  /** 溯源结果转 CSV（UTF-8 BOM），供审计/导出 */
  buildTraceCsv(
    trace: Awaited<ReturnType<UniqueCodeTraceService['getTrace']>>,
  ): string {
    const header =
      '序号,动作,方向,单据类型,内部单号,业务单号,仓库,操作人,扫码时间,款号,颜色,尺码';
    const lines = trace.events.map(
      (e) =>
        [
          e.seq,
          e.eventType,
          e.direction,
          e.docTypeName,
          e.docId,
          e.docNo ?? '',
          e.warehouseName ?? e.warehouseId ?? '',
          e.operatorId ?? '',
          e.scanAt ? new Date(e.scanAt).toISOString() : '',
          e.styleNo ?? '',
          e.color ?? '',
          e.size ?? '',
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(','),
    );
    return '﻿' + [header, ...lines].join('\r\n');
  }

  /* ---------------------------------------------------------------- */
  /* SKU / 区间批量溯源                                                */
  /* ---------------------------------------------------------------- */

  /**
   * 按 SKU 批量溯源：返回某 SKU 下每个唯一码的"当前状态 + 事件数 + 首末出入时间 + 当前仓库"。
   * 用于防串货调查（该款所有件都去了哪些仓、何时出/退），是单码溯源的批量维度。
   */
  async getTraceBySku(
    skuId: string,
    opts?: { from?: Date; to?: Date },
  ): Promise<{
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
      firstAt: Date | null;
      lastAt: Date | null;
      lastOutAt: Date | null;
    }[];
  }> {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, skuId, totalCodes: 0, items: [] };
    }
    const hotCond = this.scopeCond(docUniqueCode, { skuId, from: opts?.from, to: opts?.to });
    const arcCond = this.scopeCond(docUniqueCodeArchive, { skuId, from: opts?.from, to: opts?.to });

    // 热表 + 归档表 合并统计（P2 冷热分离：归档事件仍计入批量溯源）
    const statRows = (await this.db.execute(sql`
      SELECT t.unique_code AS unique_code,
             COUNT(*)::int AS event_count,
             MIN(t.scan_at) AS first_at,
             MAX(t.scan_at) AS last_at,
             MAX(CASE WHEN t.scan_type = 'outbound' THEN t.scan_at END) AS last_out_at
      FROM (
        SELECT unique_code, scan_at, scan_type FROM doc_unique_code WHERE ${hotCond}
        UNION ALL
        SELECT unique_code, scan_at, scan_type FROM doc_unique_code_archive WHERE ${arcCond}
      ) t
      GROUP BY t.unique_code
    `)) as any[];

    const codes = statRows.map((r) => r.unique_code);
    let stockMap = new Map<string, any>();
    if (codes.length) {
      const stocks = await this.db
        .select()
        .from(uniqueCodeStock)
        .where(inArray(uniqueCodeStock.uniqueCode, codes));
      stockMap = new Map(stocks.map((s) => [s.uniqueCode, s]));
    }
    const whIds = Array.from(
      new Set(
        Array.from(stockMap.values())
          .map((s) => s.warehouseId)
          .filter(Boolean) as string[],
      ),
    );
    const whRows = whIds.length
      ? await this.db
          .select({ id: warehouse.id, name: warehouse.name })
          .from(warehouse)
          .where(inArray(warehouse.id, whIds))
      : [];
    const whMap = new Map(whRows.map((w) => [w.id, w.name]));

    const items = statRows.map((r) => {
      const s = stockMap.get(r.unique_code);
      return {
        uniqueCode: r.unique_code,
        status: s?.status ?? 'unknown',
        statusLabel: s ? (STATUS_LABEL[s.status] ?? s.status) : '无库存记录',
        warehouseId: s?.warehouseId ?? null,
        warehouseName: s?.warehouseId ? (whMap.get(s.warehouseId) ?? null) : null,
        eventCount: Number(r.event_count),
        firstAt: r.first_at ?? null,
        lastAt: r.last_at ?? null,
        lastOutAt: r.last_out_at ?? null,
      };
    });

    return {
      enabled: true,
      skuId,
      totalCodes: items.length,
      items,
    };
  }

  /**
   * 跨区间批量溯源（P1 增强）：按多维条件返回扁平的件级流水事件，用于防串货调查与合规审计。
   * 支持过滤：时间窗(from/to)、skuId、styleNo、color、size、warehouseId、eventTypes、limit。
   * 每条事件附带业务单号(docNo)、操作人(operatorId) 与串货标记(crossesChannel)。
   */
  async getTraceByRange(opts: {
    from?: Date;
    to?: Date;
    skuId?: string;
    styleNo?: string;
    color?: string;
    size?: string;
    warehouseId?: string;
    eventTypes?: string[];
    limit?: number;
  }): Promise<{
    enabled: boolean;
    total: number;
    rows: {
      uniqueCode: string;
      skuId: string | null;
      styleNo: string | null;
      color: string | null;
      size: string | null;
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
      scanAt: Date;
      crossesChannel: boolean;
    }[];
  }> {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, total: 0, rows: [] };
    }
    // 同时读取热表 + 归档表（P2 冷热分离），合并后按时间升序，limit 由调用方裁剪
    const rows = await this.selectEventsBoth(opts);
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows;

    const whIds = Array.from(
      new Set(limited.map((r) => r.warehouseId).filter(Boolean) as string[]),
    );
    const whRows = whIds.length
      ? await this.db
          .select({ id: warehouse.id, name: warehouse.name })
          .from(warehouse)
          .where(inArray(warehouse.id, whIds))
      : [];
    const whMap = new Map(whRows.map((w) => [w.id, w.name]));

    const docKeySet = new Set(limited.map((r) => `${r.docType}::${r.docId}`));
    const docNoMap = new Map<string, string | null>();
    for (const key of docKeySet) {
      const [dt, did] = key.split('::');
      docNoMap.set(key, await this.resolveDocNo(dt, did));
    }

    // 串货标记需要每件"原始采购入库仓 + 是否有调拨"；按 uniqueCode 分组判定
    const codeSet = Array.from(new Set(limited.map((r) => r.uniqueCode)));
    const suspectCodes = await this.channelCrossingCodeSet(codeSet);

    const out = limited.map((r) => ({
      uniqueCode: r.uniqueCode,
      skuId: r.skuId,
      styleNo: r.styleNo,
      color: r.color,
      size: r.size,
      scanType: r.scanType,
      eventType: SCAN_TYPE_LABEL[r.scanType] ?? r.scanType,
      direction: directionOf(r.scanType),
      docType: r.docType,
      docTypeName: DOC_TYPE_LABEL[r.docType] ?? r.docType,
      docId: r.docId,
      docNo: docNoMap.get(`${r.docType}::${r.docId}`) ?? null,
      operatorId: r.operatorId ?? null,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseId ? (whMap.get(r.warehouseId) ?? null) : null,
      scanAt: r.scanAt,
      crossesChannel: suspectCodes.has(r.uniqueCode),
    }));

    return { enabled: true, total: rows.length, rows: out };
  }

  /* ---------------------------------------------------------------- */
  /* 串货违规检出                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * 串货违规检出（P1 增强）：返回所有"在未经调拨的情况下，从非原始采购入库仓被销售出库"的件。
   * 与"同层经销商禁止互窜、上下级须经采购/销售/调拨流程转移"的规则直接挂钩。
   * 返回每个疑似件的最近一次违规出库事件 + 原始采购入库仓 + 当前仓。
   *
   * ⚠️ 接口怪癖（护栏用例 18 钉死）：本方法不接受 from/to 时间窗参数，
   * 只能按 skuId / styleNo / warehouseId 过滤，全表扫描一遍所有 outbound/sold 事件。
   */
  async getChannelViolations(opts?: {
    skuId?: string;
    styleNo?: string;
    warehouseId?: string;
  }): Promise<{
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
      violationAt: Date | null;
      status: string | null;
    }[];
  }> {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, total: 0, items: [] };
    }
    // 取所有存在 outbound/sold 的码（潜在违规对象）
    const subWhere: any[] = [inArray(docUniqueCode.scanType, ['outbound', 'sold'])];
    if (opts?.skuId) subWhere.push(eq(docUniqueCode.skuId, opts.skuId));
    if (opts?.styleNo) subWhere.push(eq(docUniqueCode.styleNo, opts.styleNo));
    const codeRows = await this.db
      .select({ uniqueCode: docUniqueCode.uniqueCode })
      .from(docUniqueCode)
      .where(subWhere.length === 1 ? subWhere[0] : and(...subWhere));
    const codes = Array.from(new Set(codeRows.map((r) => r.uniqueCode)));
    if (!codes.length) return { enabled: true, total: 0, items: [] };

    const stockRows = await this.db
      .select()
      .from(uniqueCodeStock)
      .where(inArray(uniqueCodeStock.uniqueCode, codes));
    const stockMap = new Map(stockRows.map((s) => [s.uniqueCode, s]));

    const whIds = Array.from(
      new Set(
        Array.from(stockMap.values())
          .map((s) => s.warehouseId)
          .filter(Boolean) as string[],
      ),
    );
    const whRows = whIds.length
      ? await this.db
          .select({ id: warehouse.id, name: warehouse.name })
          .from(warehouse)
          .where(inArray(warehouse.id, whIds))
      : [];
    const whMap = new Map(whRows.map((w) => [w.id, w.name]));

    // 批量取所有码的事件（一次性 WHERE IN，避免逐码查询 N+1），按码分组且保持时间序
    const allEvs = await this.db
      .select({
        uniqueCode: docUniqueCode.uniqueCode,
        docType: docUniqueCode.docType,
        scanType: docUniqueCode.scanType,
        warehouseId: docUniqueCode.warehouseId,
        docId: docUniqueCode.docId,
        scanAt: docUniqueCode.scanAt,
      })
      .from(docUniqueCode)
      .where(inArray(docUniqueCode.uniqueCode, codes))
      .orderBy(docUniqueCode.scanAt);

    const evsByCode = new Map<string, any[]>();
    for (const ev of allEvs) {
      const arr = evsByCode.get(ev.uniqueCode);
      if (arr) arr.push(ev);
      else evsByCode.set(ev.uniqueCode, [ev]);
    }

    const items: any[] = [];
    // 命中违规的 (docType,docId) 收集后批量解析单号，避免逐条 resolveDocNo N+1
    const docKeySet = new Set<string>();
    const pending: { uc: string; s: any; originWh: string | null; violationEv: any }[] = [];
    for (const uc of codes) {
      const evs = evsByCode.get(uc) ?? [];
      const { suspect, originWh, violationEv } = this.evalChannelCrossingDetail(evs);
      if (!suspect || !violationEv) continue;
      const s = stockMap.get(uc);
      if (opts?.warehouseId && s?.warehouseId !== opts.warehouseId) continue;
      docKeySet.add(`${violationEv.docType}::${violationEv.docId}`);
      pending.push({ uc, s, originWh, violationEv });
    }

    const docNoMap = new Map<string, string | null>();
    for (const key of docKeySet) {
      const [dt, did] = key.split('::');
      docNoMap.set(key, await this.resolveDocNo(dt, did));
    }

    for (const { uc, s, originWh, violationEv } of pending) {
      items.push({
        uniqueCode: uc,
        styleNo: s?.styleNo ?? null,
        color: s?.color ?? null,
        size: s?.size ?? null,
        originWarehouseId: originWh,
        originWarehouseName: originWh ? (whMap.get(originWh) ?? null) : null,
        violationWarehouseId: violationEv.warehouseId,
        violationWarehouseName: violationEv.warehouseId
          ? (whMap.get(violationEv.warehouseId) ?? null)
          : null,
        violationDocNo: docNoMap.get(`${violationEv.docType}::${violationEv.docId}`) ?? null,
        violationAt: violationEv.scanAt,
        status: s?.status ?? null,
      });
    }
    return { enabled: true, total: items.length, items };
  }

  /** 返回"疑似串货"的码集合（供 getTraceByRange 复用；跨热表+归档表判定，避免漏判已归档件） */
  private async channelCrossingCodeSet(codes: string[]): Promise<Set<string>> {
    const set = new Set<string>();
    for (const uc of codes) {
      const [hot, arc] = await Promise.all([
        this.db
          .select({
            docType: docUniqueCode.docType,
            scanType: docUniqueCode.scanType,
            warehouseId: docUniqueCode.warehouseId,
            scanAt: docUniqueCode.scanAt,
          })
          .from(docUniqueCode)
          .where(eq(docUniqueCode.uniqueCode, uc)),
        this.db
          .select({
            docType: docUniqueCodeArchive.docType,
            scanType: docUniqueCodeArchive.scanType,
            warehouseId: docUniqueCodeArchive.warehouseId,
            scanAt: docUniqueCodeArchive.scanAt,
          })
          .from(docUniqueCodeArchive)
          .where(eq(docUniqueCodeArchive.uniqueCode, uc)),
      ]);
      const evs = [...hot, ...arc].sort(
        (a: any, b: any) => new Date(a.scanAt).getTime() - new Date(b.scanAt).getTime(),
      );
      if (this.evalChannelCrossing(evs).suspect) set.add(uc);
    }
    return set;
  }

  /** 串货判定（带细节）：返回是否嫌疑 + 原始采购入库仓 + 首次违规出库事件 */
  private evalChannelCrossingDetail(events: {
    docType: string;
    scanType: string;
    warehouseId: string | null;
    docId: string;
    scanAt: Date;
  }[]) {
    const inboundEvents = events.filter((e) => e.scanType === 'inbound');
    const originWh = inboundEvents.length ? inboundEvents[0].warehouseId : null;
    const hasTransfer = events.some(
      (e) => e.docType === 'transfer' && e.scanType === 'inbound',
    );
    let violationEv: { docType: string; docId: string; warehouseId: string | null; scanAt: Date } | null = null;
    let suspect = false;
    for (const e of events) {
      const isOut = e.scanType === 'outbound' || e.scanType === 'sold';
      if (
        isOut &&
        originWh &&
        e.warehouseId &&
        e.warehouseId !== originWh &&
        !hasTransfer
      ) {
        suspect = true;
        violationEv = {
          docType: e.docType,
          docId: e.docId,
          warehouseId: e.warehouseId,
          scanAt: e.scanAt,
        };
        break;
      }
    }
    return { suspect, originWh, violationEv };
  }

  /* ---------------------------------------------------------------- */
  /* 生命周期报表                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * 唯一码生命周期报表：
   *  - 按状态分布（在库/已出库/已售/已退）；
   *  - 按仓库 × 状态；
   *  - 按款号 × 状态；
   *  - 异常概览（状态矛盾：in_stock 却有出库流水 / out·sold 却无出库流水）。
   */
  async getLifecycleReport(filter?: {
    warehouseId?: string;
    styleNo?: string;
  }) {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, byStatus: [], byWarehouse: [], byStyle: [], anomalies: [] };
    }
    // 参数化过滤条件（避免字符串拼接导致的 SQL 注入）
    const where = and(
      filter?.warehouseId ? eq(uniqueCodeStock.warehouseId, filter.warehouseId) : undefined,
      filter?.styleNo ? eq(uniqueCodeStock.styleNo, filter.styleNo) : undefined,
    );

    const byStatus = await this.db
      .select({ status: uniqueCodeStock.status, cnt: count() })
      .from(uniqueCodeStock)
      .where(where)
      .groupBy(uniqueCodeStock.status);

    const byWarehouse = await this.db
      .select({
        warehouseId: uniqueCodeStock.warehouseId,
        status: uniqueCodeStock.status,
        cnt: count(),
      })
      .from(uniqueCodeStock)
      .where(where)
      .groupBy(uniqueCodeStock.warehouseId, uniqueCodeStock.status);

    const byStyle = await this.db
      .select({
        styleNo: uniqueCodeStock.styleNo,
        status: uniqueCodeStock.status,
        cnt: count(),
      })
      .from(uniqueCodeStock)
      .where(where)
      .groupBy(uniqueCodeStock.styleNo, uniqueCodeStock.status);

    const anomalies = (await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM unique_code_stock ucs
          WHERE ucs.status = 'in_stock'
            AND EXISTS (SELECT 1 FROM doc_unique_code d WHERE d.unique_code = ucs.unique_code AND d.scan_type='outbound')
            AND NOT EXISTS (SELECT 1 FROM doc_unique_code d WHERE d.unique_code = ucs.unique_code AND d.scan_type='returned')
        ) AS stuck_in_stock,
        (SELECT COUNT(*) FROM unique_code_stock ucs
          WHERE ucs.status IN ('out','sold')
            AND NOT EXISTS (SELECT 1 FROM doc_unique_code d WHERE d.unique_code = ucs.unique_code AND d.scan_type='outbound')
        ) AS no_outbound
    `)) as any[];

    return {
      enabled: true,
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.cnt) })),
      byWarehouse: byWarehouse.map((r) => ({ warehouseId: r.warehouseId, status: r.status, count: Number(r.cnt) })),
      byStyle: byStyle.map((r) => ({ styleNo: r.styleNo, status: r.status, count: Number(r.cnt) })),
      anomalies: {
        stuckInStock: Number(anomalies[0]?.stuck_in_stock ?? 0),
        noOutbound: Number(anomalies[0]?.no_outbound ?? 0),
      },
    };
  }
}
