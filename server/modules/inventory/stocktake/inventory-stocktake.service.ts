import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, sql, inArray, like, gte, lte } from 'drizzle-orm';
import {
  inventoryStocktake,
  inventoryStocktakeItem,
  warehouse,
  inventoryStock,
  materialStock,
  sku,
} from '@server/database/schema';
import { StockService } from '@server/modules/inventory/stock/stock.service';
import type {
  InventoryStocktake,
  InventoryStocktakeItem,
  PaginationResult,
} from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { MonthCloseService } from '../../finance/month-close/month-close.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';

interface StocktakeItemDto {
  skuId?: string;
  materialId?: string;
  itemCode: string;
  itemName: string;
  color?: string;
  size?: string;
  bookQty: number;
  actualQty: number;
}

interface CreateStocktakeDto {
  warehouseId: string;
  stocktakeDate: string;
  itemType: 'sku' | 'material';
  remark?: string;
  items: StocktakeItemDto[];
}

@Injectable()
export class InventoryStocktakeService {
  private readonly logger = new Logger(InventoryStocktakeService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  /**
   * 写操作越权防护：构造“按 id 查询盘点单”时应附加的经销商作用域条件。
   * 越权单据（非本经销商）将查不到 → 上层抛出 NotFound，等同不可见（IDOR 写面防护，零侵入）。
   */
  private stocktakeScopeCond() {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    return buildDealerScopeCondition(scope, {
      kind: 'viaWarehouse',
      column: inventoryStocktake.warehouseId,
    });
  }

  async getStocktakeList(params: {
    page: number;
    pageSize: number;
    status?: string;
    /** 单据日期（stocktake_date）起始 */
    stocktakeDateStart?: string;
    /** 单据日期（stocktake_date）截止（含当天） */
    stocktakeDateEnd?: string;
    /** 店铺/仓库名称模糊查询（warehouse_name） */
    warehouseName?: string;
  }): Promise<PaginationResult<InventoryStocktake>> {
    const {
      page,
      pageSize,
      status,
      stocktakeDateStart,
      stocktakeDateEnd,
      warehouseName,
    } = params;

    const conditions = [];
    if (status) conditions.push(eq(inventoryStocktake.status, status));
    // 单据日期范围
    if (stocktakeDateStart)
      conditions.push(gte(inventoryStocktake.stocktakeDate, stocktakeDateStart));
    if (stocktakeDateEnd)
      conditions.push(lte(inventoryStocktake.stocktakeDate, stocktakeDateEnd));
    // 店铺名称模糊
    if (warehouseName)
      conditions.push(like(inventoryStocktake.warehouseName, `%${warehouseName}%`));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventoryStocktake)
        .where(whereClause),
      this.db
        .select()
        .from(inventoryStocktake)
        .where(whereClause)
        .orderBy(desc(inventoryStocktake.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: InventoryStocktake[] = rows.map((row) => ({
      id: row.id,
      stocktakeNo: row.stocktakeNo,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      stocktakeDate: row.stocktakeDate,
      itemType: row.itemType,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async getStocktakeDetail(id: string): Promise<InventoryStocktake> {
    // 行级数据权限：非本经销商的盘点单按"不存在"返回，避免越权泄露
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryStocktake.warehouseId },
    );
    const whereClause = scopeCond
      ? and(eq(inventoryStocktake.id, id), scopeCond)
      : eq(inventoryStocktake.id, id);
    const [stocktakeRow] = await this.db
      .select()
      .from(inventoryStocktake)
      .where(whereClause);
    if (!stocktakeRow) {
      throw new NotFoundException('盘点单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(inventoryStocktakeItem)
      .where(eq(inventoryStocktakeItem.stocktakeId, id))
      .orderBy(inventoryStocktakeItem.id);

    const items: InventoryStocktakeItem[] = itemRows.map((row) => ({
      id: row.id,
      stocktakeId: row.stocktakeId,
      skuId: row.skuId ?? undefined,
      materialId: row.materialId ?? undefined,
      itemCode: row.itemCode,
      itemName: row.itemName,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      bookQty: Number(row.bookQty),
      actualQty: Number(row.actualQty),
      diffQty: Number(row.diffQty),
    }));

    return {
      id: stocktakeRow.id,
      stocktakeNo: stocktakeRow.stocktakeNo,
      warehouseId: stocktakeRow.warehouseId,
      warehouseName: stocktakeRow.warehouseName,
      stocktakeDate: stocktakeRow.stocktakeDate,
      itemType: stocktakeRow.itemType,
      status: stocktakeRow.status,
      remark: stocktakeRow.remark ?? undefined,
      createdAt: stocktakeRow.createdAt.toISOString(),
      items,
    };
  }

  async createStocktake(
    dto: CreateStocktakeDto,
    userId: string,
  ): Promise<InventoryStocktake> {
    const { warehouseId, stocktakeDate, itemType, remark, items } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('盘点明细不能为空');
    }

    // 校验仓库
    const [warehouseRow] = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, warehouseId));
    if (!warehouseRow) {
      throw new NotFoundException('仓库不存在');
    }

    const result = await this.db.transaction(async (tx) => {
      const stocktakeNo = await this.generateStocktakeNo(tx, stocktakeDate);

      const [stocktakeRow] = await tx
        .insert(inventoryStocktake)
        .values({
          stocktakeNo,
          warehouseId,
          warehouseName: warehouseRow.name,
          stocktakeDate,
          itemType,
          status: 'draft',
          remark,
        })
        .returning();

      // 从库存表读取账面数量
      let stockInfoMap = new Map<string, { qty: number; code?: string; name?: string; color?: string; size?: string }>();
      if (itemType === 'sku') {
        const skuIds = items
          .filter((item) => item.skuId)
          .map((item) => item.skuId as string);
        if (skuIds.length > 0) {
          const stockRows = await tx
            .select({
              skuId: inventoryStock.skuId,
              quantity: inventoryStock.quantity,
              skuCode: inventoryStock.skuCode,
              styleNo: inventoryStock.styleNo,
              color: inventoryStock.color,
              size: inventoryStock.size,
            })
            .from(inventoryStock)
            .where(
              and(
                eq(inventoryStock.warehouseId, warehouseId),
                inArray(inventoryStock.skuId, skuIds),
              ),
            );
          for (const row of stockRows) {
            stockInfoMap.set(row.skuId, {
              qty: Number(row.quantity),
              code: row.skuCode ?? undefined,
              name: row.styleNo ?? undefined,
              color: row.color ?? undefined,
              size: row.size ?? undefined,
            });
          }
        }
      } else {
        const materialIds = items
          .filter((item) => item.materialId)
          .map((item) => item.materialId as string);
        if (materialIds.length > 0) {
          const stockRows = await tx
            .select({
              materialId: materialStock.materialId,
              quantity: materialStock.quantity,
              materialCode: materialStock.materialCode,
              materialName: materialStock.materialName,
            })
            .from(materialStock)
            .where(
              and(
                eq(materialStock.warehouseId, warehouseId),
                inArray(materialStock.materialId, materialIds),
              ),
            );
          for (const row of stockRows) {
            stockInfoMap.set(row.materialId, {
              qty: Number(row.quantity),
              code: row.materialCode ?? undefined,
              name: row.materialName ?? undefined,
            });
          }
        }
      }

      const itemValues = items.map((item) => {
        const itemKey = itemType === 'sku' ? item.skuId : item.materialId;
        const stockInfo = stockInfoMap.get(itemKey ?? '');
        const bookQty = stockInfo?.qty ?? 0;
        const diffQty = item.actualQty - bookQty;
        return {
          stocktakeId: stocktakeRow.id,
          skuId: item.skuId ?? null,
          materialId: item.materialId ?? null,
          itemCode: item.itemCode ?? stockInfo?.code ?? '',
          itemName: item.itemName ?? stockInfo?.name ?? '',
          color: item.color ?? stockInfo?.color ?? null,
          size: item.size ?? stockInfo?.size ?? null,
          bookQty: String(bookQty),
          actualQty: String(item.actualQty),
          diffQty: String(diffQty),
        };
      });

      await tx.insert(inventoryStocktakeItem).values(itemValues);

      return stocktakeRow;
    });

    this.logger.log(
      `创建盘点单成功: id=${result.id}, stocktakeNo=${result.stocktakeNo}, operator=${userId}`,
    );

    return this.getStocktakeDetail(result.id);
  }

  /**
   * 审核：仅将状态 draft -> approved，锁定单据不可再编辑，不改变库存。
   */
  async approveStocktake(
    id: string,
    userId: string,
  ): Promise<InventoryStocktake> {
    const scopeCond = this.stocktakeScopeCond();
    const [stocktakeRow] = await this.db
      .select()
      .from(inventoryStocktake)
      .where(scopeCond ? and(eq(inventoryStocktake.id, id), scopeCond) : eq(inventoryStocktake.id, id));
    if (!stocktakeRow) {
      throw new NotFoundException('盘点单不存在');
    }
    if (stocktakeRow.status !== 'draft') {
      throw new BadRequestException('仅draft状态的盘点单才能审核');
    }

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(stocktakeRow.stocktakeDate);

    const [itemCountRow] = await this.db
      .select({ count: count() })
      .from(inventoryStocktakeItem)
      .where(eq(inventoryStocktakeItem.stocktakeId, id));
    if (Number(itemCountRow?.count ?? 0) === 0) {
      throw new BadRequestException('盘点单无明细');
    }

    await this.db
      .update(inventoryStocktake)
      .set({ status: 'approved' })
      .where(eq(inventoryStocktake.id, id));

    this.logger.log(
      `审核盘点单成功: id=${id}, stocktakeNo=${stocktakeRow.stocktakeNo}, operator=${userId}`,
    );

    return this.getStocktakeDetail(id);
  }

  /**
   * 记账：状态 approved -> posted，按盘点差异调整库存数量，并按 SKU 成本价回填
   * 库存金额（unit_price / amount），产生盘盈/盘亏。material 库存无金额列，仅调数量。
   */
  async postStocktake(
    id: string,
    userId: string,
  ): Promise<InventoryStocktake> {
    const scopeCond = this.stocktakeScopeCond();
    const [stocktakeRow] = await this.db
      .select()
      .from(inventoryStocktake)
      .where(scopeCond ? and(eq(inventoryStocktake.id, id), scopeCond) : eq(inventoryStocktake.id, id));
    if (!stocktakeRow) {
      throw new NotFoundException('盘点单不存在');
    }
    if (stocktakeRow.status !== 'approved') {
      throw new BadRequestException('仅approved状态的盘点单才能记账');
    }

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(stocktakeRow.stocktakeDate);

    const itemRows = await this.db
      .select()
      .from(inventoryStocktakeItem)
      .where(eq(inventoryStocktakeItem.stocktakeId, id));

    if (itemRows.length === 0) {
      throw new BadRequestException('盘点单无明细');
    }

    await this.db.transaction(async (tx) => {
      const stockChanges: import('@server/modules/inventory/stock/stock.service').StockChangeItem[] = [];

      for (const item of itemRows) {
        const diffQty = Number(item.diffQty);
        if (diffQty === 0) continue;

        if (stocktakeRow.itemType === 'sku' && item.skuId) {
          stockChanges.push({
            warehouseId: stocktakeRow.warehouseId,
            warehouseName: stocktakeRow.warehouseName,
            skuId: item.skuId,
            itemType: 'sku',
            qtyDelta: diffQty,
            flowType: 'stocktake_adjust',
            bizNo: stocktakeRow.stocktakeNo,
            remark: `盘点记账，差异: ${diffQty > 0 ? '+' : ''}${diffQty}`,
          });
        } else if (stocktakeRow.itemType === 'material' && item.materialId) {
          stockChanges.push({
            warehouseId: stocktakeRow.warehouseId,
            warehouseName: stocktakeRow.warehouseName,
            materialId: item.materialId,
            itemType: 'material',
            qtyDelta: diffQty,
            flowType: 'stocktake_adjust',
            bizNo: stocktakeRow.stocktakeNo,
            remark: `盘点记账，差异: ${diffQty > 0 ? '+' : ''}${diffQty}`,
          });
        }
      }

      if (stockChanges.length > 0) {
        await this.stockService.batchChangeStock(tx, stockChanges);
      }

      // W5: SKU 库存金额按成本价回填（material 库存无金额列，跳过）
      if (stocktakeRow.itemType === 'sku') {
        for (const item of itemRows) {
          if (!item.skuId || Number(item.diffQty) === 0) continue;
          await tx
            .update(inventoryStock)
            .set({
              unitPrice: sql`COALESCE((SELECT ${sku.costPrice} FROM ${sku} WHERE ${sku.id} = ${item.skuId}::uuid), 0)`,
              amount:
                sql`${inventoryStock.quantity} * COALESCE((SELECT ${sku.costPrice} FROM ${sku} WHERE ${sku.id} = ${item.skuId}::uuid), 0)`,
            })
            .where(
              and(
                eq(inventoryStock.skuId, item.skuId),
                eq(inventoryStock.warehouseId, stocktakeRow.warehouseId),
              ),
            );
        }
      }

      // 更新状态：记账完成
      await tx
        .update(inventoryStocktake)
        .set({ status: 'posted' })
        .where(eq(inventoryStocktake.id, id));
    });

    this.logger.log(
      `记账盘点单成功: id=${id}, stocktakeNo=${stocktakeRow.stocktakeNo}, operator=${userId}`,
    );

    return this.getStocktakeDetail(id);
  }

  async voidDoc(id: string): Promise<void> {
    const scopeCond = this.stocktakeScopeCond();
    const [stocktakeRow] = await this.db
      .select({ id: inventoryStocktake.id })
      .from(inventoryStocktake)
      .where(scopeCond ? and(eq(inventoryStocktake.id, id), scopeCond) : eq(inventoryStocktake.id, id));
    if (!stocktakeRow) throw new NotFoundException('盘点单不存在');
    await voidDraftDocument(this.db, inventoryStocktake, id);
  }

  async deleteStocktake(
    id: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    const scopeCond = this.stocktakeScopeCond();
    const [stocktakeRow] = await this.db
      .select()
      .from(inventoryStocktake)
      .where(scopeCond ? and(eq(inventoryStocktake.id, id), scopeCond) : eq(inventoryStocktake.id, id));
    if (!stocktakeRow) {
      throw new NotFoundException('盘点单不存在');
    }
    if (stocktakeRow.status !== 'draft') {
      throw new BadRequestException('仅draft状态的盘点单才能删除');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(inventoryStocktakeItem)
        .where(eq(inventoryStocktakeItem.stocktakeId, id));
      await tx
        .delete(inventoryStocktake)
        .where(eq(inventoryStocktake.id, id));
    });

    this.logger.log(
      `删除盘点单成功: id=${id}, stocktakeNo=${stocktakeRow.stocktakeNo}, operator=${userId}`,
    );

    return { success: true };
  }

  private async generateStocktakeNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '').slice(0, 8);
    const prefix = `ST${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      inventoryStocktake,
      inventoryStocktake.stocktakeNo,
      prefix,
      4,
    );
  }
}
