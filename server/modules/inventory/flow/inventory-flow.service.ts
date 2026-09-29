import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, gte, lt } from 'drizzle-orm';
import { inventoryFlow } from '@server/database/schema';
import type { InventoryFlow, PaginationResult } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { paginateWithKeyset } from '@server/database/keyset';

@Injectable()
export class InventoryFlowService {
  private readonly logger = new Logger(InventoryFlowService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getFlowList(params: {
    page: number;
    pageSize: number;
    itemType?: string;
    skuId?: string;
    materialId?: string;
    warehouseId?: string;
    flowType?: string;
    startDate?: string;
    endDate?: string;
    /** keyset 游标：传入后走游标分页，忽略 page */
    cursor?: string;
  }): Promise<PaginationResult<InventoryFlow>> {
    const {
      page,
      pageSize,
      itemType,
      skuId,
      materialId,
      warehouseId,
      flowType,
      startDate,
      endDate,
      cursor,
    } = params;

    const conditions = [];
    if (itemType) conditions.push(eq(inventoryFlow.itemType, itemType));
    if (skuId) conditions.push(eq(inventoryFlow.skuId, skuId));
    if (materialId) conditions.push(eq(inventoryFlow.materialId, materialId));
    if (warehouseId) conditions.push(eq(inventoryFlow.warehouseId, warehouseId));
    if (flowType) conditions.push(eq(inventoryFlow.flowType, flowType));
    if (startDate) {
      conditions.push(gte(inventoryFlow.createdAt, new Date(startDate)));
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      conditions.push(lt(inventoryFlow.createdAt, endDateObj));
    }
    // 行级数据权限：仅可见当前用户所属经销商的仓库流水，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryFlow.warehouseId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 双模分页：库存流水为纯追加写表，生产环境增长最快，深翻页用 keyset(createdAt DESC, id DESC)
    const { rows, total, nextCursor } = await paginateWithKeyset({
      cursor,
      page,
      pageSize,
      timeCol: inventoryFlow.createdAt,
      idCol: inventoryFlow.id,
      timeField: 'createdAt',
      idField: 'id',
      where: whereClause,
      select: (w, limit, offset) =>
        this.db
          .select()
          .from(inventoryFlow)
          .where(w)
          .orderBy(desc(inventoryFlow.createdAt), desc(inventoryFlow.id))
          .limit(limit)
          .offset(offset),
      count: async (w) =>
        Number((await this.db.select({ count: count() }).from(inventoryFlow).where(w))[0]?.count ?? 0),
    });

    const items: InventoryFlow[] = rows.map((row) => ({
      id: row.id,
      flowType: row.flowType,
      bizNo: row.bizNo,
      direction: row.direction,
      itemType: row.itemType,
      skuId: row.skuId ?? undefined,
      materialId: row.materialId ?? undefined,
      styleNo: row.styleNo ?? undefined,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      materialCode: row.materialCode ?? undefined,
      materialName: row.materialName ?? undefined,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      quantity: Number(row.quantity),
      batchNo: row.batchNo ?? undefined,
      unitPrice: row.unitPrice ? Number(row.unitPrice) : undefined,
      operator: row.operator ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, nextCursor };
  }
}
