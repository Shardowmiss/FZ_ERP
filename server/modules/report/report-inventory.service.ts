import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, ilike, or, sql, sum } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { inventoryStock, sku, style } from '@server/database/schema';
import type { InventoryQueryParams, InventoryReportResult } from './report-interfaces';

/**
 * 库存报表（域）。逻辑、SQL、返回结构与拆前逐字一致。
 */
@Injectable()
export class ReportInventoryService {
  private readonly logger = new Logger(ReportInventoryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getInventoryReport(params: InventoryQueryParams): Promise<InventoryReportResult> {
    const { warehouseId, keyword, brand, page, pageSize } = params;

    const conditions: ReturnType<typeof and>[] = [];

    if (warehouseId) {
      conditions.push(eq(inventoryStock.warehouseId, warehouseId));
    }
    if (keyword) {
      const kw: string = `%${escapeLike(keyword)}%`;
      conditions.push(or(
        ilike(inventoryStock.styleNo, kw),
        ilike(inventoryStock.skuCode, kw),
        ilike(style.name, kw),
      ));
    }
    if (brand) {
      conditions.push(eq(style.brand, brand));
    }

    const inventoryScope = buildAggregationScope('inventory');
    if (inventoryScope) conditions.push(inventoryScope);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        brand: style.brand,
        styleNo: inventoryStock.styleNo,
        styleName: style.name,
        color: inventoryStock.color,
        size: inventoryStock.size,
        warehouseName: inventoryStock.warehouseName,
        quantity: inventoryStock.quantity,
        inTransitQty: inventoryStock.inTransitQty,
        unitCost: sku.costPrice,
      })
      .from(inventoryStock)
      .leftJoin(sku, eq(inventoryStock.skuId, sku.id))
      .leftJoin(style, eq(sku.styleId, style.id))
      .where(whereClause);

    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(baseQuery.as('base'));
    const total: number = totalResult[0]?.count ?? 0;

    const rows = await baseQuery
      .orderBy(desc(inventoryStock.styleNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const summaryRow: { totalQty: string } | undefined = (
      await this.db
        .select({
          totalQty: sum(inventoryStock.quantity).as('total_qty'),
        })
        .from(inventoryStock)
        .leftJoin(sku, eq(inventoryStock.skuId, sku.id))
        .leftJoin(style, eq(sku.styleId, style.id))
        .where(whereClause)
    )[0];

    const items: InventoryReportResult['items'] = rows.map((row) => {
      const qty: number = Number(row.quantity);
      const inTransit: number = Number(row.inTransitQty ?? 0);
      const unitCost: number = Number(row.unitCost ?? 0);
      return {
        brand: row.brand ?? '-',
        styleNo: row.styleNo,
        styleName: row.styleName ?? '-',
        color: row.color,
        size: row.size,
        warehouseName: row.warehouseName,
        quantity: qty,
        inTransitQty: inTransit,
        availableQty: qty - inTransit,
        unitCost,
        stockAmount: Math.round(qty * unitCost * 100) / 100,
      };
    });

    const totalQtyNum: number = Number(summaryRow?.totalQty ?? 0);
    const totalAmountNum: number = items.reduce(
      (acc: number, item: InventoryReportResult['items'][number]) => acc + item.stockAmount,
      0,
    );

    const summary: InventoryReportResult['summary'] = {
      totalQty: totalQtyNum,
      totalAmount: totalAmountNum,
    };

    return { items, total, page, pageSize, summary };
  }
}
