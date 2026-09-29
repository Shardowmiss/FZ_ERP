import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, ilike, sql } from 'drizzle-orm';
import { inventoryStock, materialStock, style } from '@server/database/schema';
import type {
  InventoryStock,
  MaterialStock,
  PaginationResult,
} from '@shared/api.interface';
import { escapeLike } from '@server/common/utils/escape-like';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

@Injectable()
export class InventoryQueryService {
  private readonly logger = new Logger(InventoryQueryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getSkuStock(params: {
    page: number;
    pageSize: number;
    styleId?: string;
    brand?: string;
    color?: string;
    size?: string;
    warehouseId?: string;
    keyword?: string;
  }): Promise<PaginationResult<InventoryStock>> {
    const { page, pageSize, styleId, brand, color, size, warehouseId, keyword } =
      params;

    const conditions = [];
    if (styleId) {
      conditions.push(
        sql`${inventoryStock.skuId} IN (
          SELECT id FROM sku WHERE style_id = ${styleId}
        )`,
      );
    }
    if (brand) conditions.push(eq(style.brand, brand));
    if (color) conditions.push(eq(inventoryStock.color, color));
    if (size) conditions.push(eq(inventoryStock.size, size));
    if (warehouseId) conditions.push(eq(inventoryStock.warehouseId, warehouseId));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        sql`(
          ${inventoryStock.skuCode} ILIKE ${`%${escaped}%`} OR
          ${inventoryStock.styleNo} ILIKE ${`%${escaped}%`}
        )`,
      );
    }
    // 行级数据权限：仅可见当前用户所属经销商的仓库库存，防止跨租户越权读取
    const stockScope = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryStock.warehouseId },
    );
    if (stockScope) conditions.push(stockScope);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventoryStock)
        .leftJoin(style, eq(inventoryStock.styleNo, style.styleNo))
        .where(whereClause),
      this.db
        .select({
          id: inventoryStock.id,
          skuId: inventoryStock.skuId,
          skuCode: inventoryStock.skuCode,
          styleNo: inventoryStock.styleNo,
          brand: style.brand,
          color: inventoryStock.color,
          size: inventoryStock.size,
          warehouseId: inventoryStock.warehouseId,
          warehouseName: inventoryStock.warehouseName,
          quantity: inventoryStock.quantity,
          updatedAt: inventoryStock.updatedAt,
        })
        .from(inventoryStock)
        .leftJoin(style, eq(inventoryStock.styleNo, style.styleNo))
        .where(whereClause)
        .orderBy(desc(inventoryStock.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: InventoryStock[] = rows.map((row) => ({
      id: row.id,
      skuId: row.skuId,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      brand: row.brand ?? undefined,
      color: row.color,
      size: row.size,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      quantity: Number(row.quantity),
    }));

    return { items, total, page, pageSize };
  }

  async getMaterialStock(params: {
    page: number;
    pageSize: number;
    materialId?: string;
    warehouseId?: string;
    keyword?: string;
  }): Promise<PaginationResult<MaterialStock>> {
    const { page, pageSize, materialId, warehouseId, keyword } = params;

    const conditions = [];
    if (materialId) conditions.push(eq(materialStock.materialId, materialId));
    if (warehouseId) conditions.push(eq(materialStock.warehouseId, warehouseId));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        sql`(
          ${materialStock.materialCode} ILIKE ${`%${escaped}%`} OR
          ${materialStock.materialName} ILIKE ${`%${escaped}%`}
        )`,
      );
    }
    // 行级数据权限：物料库存同样按仓库归属经销商隔离
    const matScope = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: materialStock.warehouseId },
    );
    if (matScope) conditions.push(matScope);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(materialStock)
        .where(whereClause),
      this.db
        .select()
        .from(materialStock)
        .where(whereClause)
        .orderBy(desc(materialStock.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: MaterialStock[] = rows.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      quantity: Number(row.quantity),
    }));

    return { items, total, page, pageSize };
  }
}
