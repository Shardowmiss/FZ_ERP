import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, sql } from 'drizzle-orm';
import { inventoryStock, sku } from '@server/database/schema';
import type {
  InventoryWarningItem,
  PaginationResult,
} from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

@Injectable()
export class InventoryWarningService {
  private readonly logger = new Logger(InventoryWarningService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getWarningList(params: {
    page: number;
    pageSize: number;
    warningType?: 'below_min' | 'above_max';
    warehouseId?: string;
  }): Promise<PaginationResult<InventoryWarningItem>> {
    const { page, pageSize, warningType, warehouseId } = params;

    // 联查 inventory_stock 和 sku 表，筛选安全库存预警
    const conditions = [];
    if (warehouseId) {
      conditions.push(eq(inventoryStock.warehouseId, warehouseId));
    }
    // 行级数据权限：仅可见当前用户所属经销商的仓库库存预警，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryStock.warehouseId },
    );
    if (scopeCond) conditions.push(scopeCond);

    let warningCondition;
    if (warningType === 'below_min') {
      warningCondition = sql`${inventoryStock.quantity} < ${sku.safetyStockMin}`;
    } else if (warningType === 'above_max') {
      warningCondition = sql`${inventoryStock.quantity} > ${sku.safetyStockMax}`;
    } else {
      warningCondition = sql`(
        ${inventoryStock.quantity} < ${sku.safetyStockMin} OR
        ${inventoryStock.quantity} > ${sku.safetyStockMax}
      )`;
    }

    const whereClause = conditions.length > 0
      ? and(warningCondition, ...conditions)
      : warningCondition;

    const baseQuery = this.db
      .select({
        skuCode: inventoryStock.skuCode,
        styleNo: inventoryStock.styleNo,
        color: inventoryStock.color,
        size: inventoryStock.size,
        warehouseName: inventoryStock.warehouseName,
        quantity: inventoryStock.quantity,
        safetyMin: sku.safetyStockMin,
        safetyMax: sku.safetyStockMax,
      })
      .from(inventoryStock)
      .innerJoin(sku, eq(inventoryStock.skuId, sku.id))
      .where(whereClause);

    const countQuery = this.db
      .select({ count: count() })
      .from(inventoryStock)
      .innerJoin(sku, eq(inventoryStock.skuId, sku.id))
      .where(whereClause);

    const [totalResult, rows] = await Promise.all([
      countQuery,
      baseQuery
        .orderBy(inventoryStock.warehouseName, inventoryStock.skuCode)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: InventoryWarningItem[] = rows.map((row) => {
      const qty = Number(row.quantity);
      const min = Number(row.safetyMin);
      const max = Number(row.safetyMax);
      const type: 'below_min' | 'above_max' = qty < min ? 'below_min' : 'above_max';

      return {
        skuCode: row.skuCode,
        styleNo: row.styleNo,
        color: row.color,
        size: row.size,
        warehouseName: row.warehouseName,
        quantity: qty,
        safetyMin: min,
        safetyMax: max,
        warningType: type,
      };
    });

    return { items, total, page, pageSize };
  }
}
