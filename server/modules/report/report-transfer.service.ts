import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, ilike, inArray, lt, or, sql, sum } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { resolveReportWindow } from '@server/common/report-window';
import { auditQueryPlan } from '@server/common/query-audit';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { inventoryTransfer, inventoryTransferItem, sku, style } from '@server/database/schema';
import type { BaseQueryParams, TransferReportResult } from './report-interfaces';

/**
 * 调拨报表（域）。逻辑、SQL、返回结构与拆前逐字一致。
 */
@Injectable()
export class ReportTransferService {
  private readonly logger = new Logger(ReportTransferService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getTransferReport(params: BaseQueryParams): Promise<TransferReportResult> {
    const { startDate, endDate, partnerIds, keyword, brand, page, pageSize, allowFullRange } = params;

    const conditions: ReturnType<typeof and>[] = [];
    conditions.push(eq(inventoryTransfer.itemType, 'sku'));

    // P1-c④ 强制时间窗：inventory_transfer 此前只有 item_type 一个恒定条件，
    // 既无时间下界也缺 transfer_date 索引（见迁移 0017），是最严重的无界扫描点
    const win = resolveReportWindow(
      { startDate, endDate, allowFullRange },
      this.logger,
    );
    if (win) {
      conditions.push(gte(inventoryTransfer.transferDate, win.start));
      conditions.push(lt(inventoryTransfer.transferDate, win.endExclusive));
    }
    if (partnerIds) {
      const warehouseIds: string[] = partnerIds.split(',').filter(Boolean);
      if (warehouseIds.length > 0) {
        conditions.push(or(
          inArray(inventoryTransfer.fromWarehouseId, warehouseIds),
          inArray(inventoryTransfer.toWarehouseId, warehouseIds),
        ));
      }
    }
    if (keyword) {
      const kw: string = `%${escapeLike(keyword)}%`;
      conditions.push(or(
        ilike(inventoryTransfer.transferNo, kw),
        ilike(inventoryTransferItem.itemCode, kw),
        ilike(inventoryTransferItem.itemName, kw),
      ));
    }
    if (brand) {
      conditions.push(eq(style.brand, brand));
    }

    const transferScope = buildAggregationScope('transfer');
    if (transferScope) conditions.push(transferScope);

    const whereClause = and(...conditions);

    const baseQuery = this.db
      .select({
        transferNo: inventoryTransfer.transferNo,
        transferDate: inventoryTransfer.transferDate,
        fromWarehouseName: inventoryTransfer.fromWarehouseName,
        toWarehouseName: inventoryTransfer.toWarehouseName,
        brand: style.brand,
        styleNo: inventoryTransferItem.itemCode,
        color: inventoryTransferItem.color,
        size: inventoryTransferItem.size,
        quantity: inventoryTransferItem.quantity,
        status: inventoryTransfer.status,
      })
      .from(inventoryTransferItem)
      .innerJoin(inventoryTransfer, eq(inventoryTransferItem.transferId, inventoryTransfer.id))
      .leftJoin(sku, eq(inventoryTransferItem.skuId, sku.id))
      .leftJoin(style, eq(sku.styleId, style.id))
      .where(whereClause);

    // P1-c⑤ 查询审计（仅 QUERY_AUDIT=1 时生效，默认 no-op）
    await auditQueryPlan(this.db, baseQuery, 'transfer-report', this.logger);

    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(baseQuery.as('base'));
    const total: number = totalResult[0]?.count ?? 0;

    const rows = await baseQuery
      .orderBy(desc(inventoryTransfer.transferDate), desc(inventoryTransfer.transferNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const summaryRow: { totalQty: string } | undefined = (
      await this.db
        .select({
          totalQty: sum(inventoryTransferItem.quantity).as('total_qty'),
        })
        .from(inventoryTransferItem)
        .innerJoin(inventoryTransfer, eq(inventoryTransferItem.transferId, inventoryTransfer.id))
        .leftJoin(sku, eq(inventoryTransferItem.skuId, sku.id))
        .leftJoin(style, eq(sku.styleId, style.id))
        .where(whereClause)
    )[0];

    const items: TransferReportResult['items'] = rows.map((row) => ({
      transferNo: row.transferNo,
      transferDate: String(row.transferDate),
      fromWarehouseName: row.fromWarehouseName,
      toWarehouseName: row.toWarehouseName,
      brand: row.brand ?? '-',
      styleNo: row.styleNo,
      color: row.color ?? '-',
      size: row.size ?? '-',
      quantity: Number(row.quantity),
      status: row.status,
    }));

    const summary: TransferReportResult['summary'] = {
      totalQty: Number(summaryRow?.totalQty ?? 0),
      totalAmount: 0,
    };

    return { items, total, page, pageSize, summary };
  }
}
