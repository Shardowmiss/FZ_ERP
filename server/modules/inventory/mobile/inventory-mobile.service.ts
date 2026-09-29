import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, inArray, isNull, sql } from 'drizzle-orm';
import {
  sku,
  warehouse,
  inventoryStock,
  inventoryStocktake,
  inventoryStocktakeItem,
  inventoryBatch,
} from '@server/database/schema';
import type {
  BarcodeGenerateResult,
  InventoryBatch,
  MobileStocktakeItemInput,
  MobileStocktakeLookup,
  MobileStocktakeSubmitResult,
  PaginationResult,
} from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round3 } from '../../../common/utils/money';
import { bulkUpsert } from '@server/common/batch';


function buildBarcode(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  const decimal = BigInt(`0x${hex}`).toString();
  return decimal.length >= 13 ? decimal.slice(-13) : decimal.padStart(13, '0');
}

@Injectable()
export class InventoryMobileService {
  private readonly logger = new Logger(InventoryMobileService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  /**
   * 为缺失条码的 SKU 批量生成唯一数字条码（13 位）。
   */
  async generateBarcodes(): Promise<BarcodeGenerateResult> {
    const rows = await this.db.select().from(sku).where(isNull(sku.barcode));
    if (rows.length === 0) {
      return { generated: 0, skipped: 0 };
    }
    // 单语句批量更新：用参数化 CASE 表达式一次性为所有缺码 SKU 回填条码，避免逐行 UPDATE（N+1）。
    // 所有 id / barcode 均以绑定参数传入，无 SQL 注入风险。
    const values = rows.map((row) => ({ id: row.id, barcode: buildBarcode(row.id) }));
    let caseSql = sql`${sku.id}`;
    for (const v of values) {
      caseSql = sql`${caseSql} WHEN ${v.id} THEN ${v.barcode}`;
    }
    caseSql = sql`CASE ${caseSql} ELSE ${sku.barcode} END`;
    await this.db
      .update(sku)
      .set({ barcode: caseSql })
      .where(inArray(sku.id, values.map((v) => v.id)));
    return { generated: values.length, skipped: 0 };
  }

  /**
   * 移动盘点：扫码查询 SKU 与当前库存。
   */
  async lookup(params: {
    barcode: string;
    warehouseId: string;
  }): Promise<MobileStocktakeLookup> {
    if (!params.barcode) {
      throw new BadRequestException('条码不能为空');
    }
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(eq(sku.barcode, params.barcode));
    if (skuRows.length === 0) {
      return { found: false };
    }
    const s = skuRows[0];
    const stockRows = await this.db
      .select()
      .from(inventoryStock)
      .where(
        and(
          eq(inventoryStock.skuId, s.id),
          eq(inventoryStock.warehouseId, params.warehouseId),
        ),
      );
    return {
      found: true,
      skuId: s.id,
      skuCode: s.skuCode,
      styleNo: s.styleNo,
      color: s.color,
      size: s.size,
      warehouseName: stockRows[0]?.warehouseName ?? '',
      bookQty: stockRows.length ? Number(stockRows[0].quantity) : 0,
    };
  }

  /**
   * 移动盘点：提交实盘数据，生成盘点单（草稿）并按批次记录库存。
   */
  async submit(dto: {
    warehouseId: string;
    stocktakeDate: string;
    items: MobileStocktakeItemInput[];
  }): Promise<MobileStocktakeSubmitResult> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('盘点明细不能为空');
    }
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }
    const wh = whRows[0];

    return this.db.transaction(async (tx) => {
      const stocktakeNo = await this.numberGenerator.generateNextNo(
        tx,
        inventoryStocktake,
        inventoryStocktake.stocktakeNo,
        `PD${dto.stocktakeDate.replace(/-/g, '')}`,
        4,
      );
      const inserted = await tx
        .insert(inventoryStocktake)
        .values({
          stocktakeNo,
          warehouseId: wh.id,
          warehouseName: wh.name,
          stocktakeDate: dto.stocktakeDate,
          itemType: 'sku',
          status: 'draft',
          remark: '移动盘点(PDA)',
        })
        .returning();
      const stocktakeId = inserted[0].id;

      // 批量预取：一次性查出所有条码对应 SKU（替代逐条 SELECT N+1）
      const barcodes = [...new Set(dto.items.map((it) => it.barcode))];
      const skuRowsAll = barcodes.length
        ? await tx.select().from(sku).where(inArray(sku.barcode, barcodes))
        : [];
      const skuByBarcode = new Map<string, (typeof sku.$inferSelect)>();
      for (const s of skuRowsAll) skuByBarcode.set(s.barcode, s);

      // 批量预取：库存（按 仓库+SKU 一次性 inArray，替代逐条 SELECT）
      const skuIds = [...new Set(skuRowsAll.map((s) => s.id))];
      const stockRowsAll = skuIds.length
        ? await tx
            .select()
            .from(inventoryStock)
            .where(
              and(
                eq(inventoryStock.warehouseId, wh.id),
                inArray(inventoryStock.skuId, skuIds),
              ),
            )
        : [];
      const stockByKey = new Map<string, (typeof inventoryStock.$inferSelect)>();
      for (const r of stockRowsAll) stockByKey.set(`${r.skuId}|${wh.id}`, r);

      // 批量预取：批次库存（按 仓库+SKU 一次性 inArray，替代逐条 SELECT）
      const batchRowsAll = skuIds.length
        ? await tx
            .select()
            .from(inventoryBatch)
            .where(
              and(
                eq(inventoryBatch.warehouseId, wh.id),
                inArray(inventoryBatch.skuId, skuIds),
              ),
            )
        : [];
      const batchByKey = new Map<string, (typeof inventoryBatch.$inferSelect)>();
      for (const r of batchRowsAll) {
        batchByKey.set(`${r.skuId}|${r.warehouseId}|${r.batchNo}`, r);
      }

      const itemRows: {
        stocktakeId: string;
        skuId: string;
        itemCode: string;
        itemName: string;
        color: string;
        size: string;
        bookQty: string;
        actualQty: string;
        diffQty: string;
      }[] = [];

      // 批次库存 upsert 收集（按 仓库+SKU+批次 合并，避免多值 upsert 同键冲突）
      const batchUpsertMap = new Map<string, (typeof inventoryBatch.$inferInsert)>();

      for (const it of dto.items) {
        const s = skuByBarcode.get(it.barcode);
        if (!s) {
          throw new BadRequestException(`条码未匹配到SKU: ${it.barcode}`);
        }
        const stockRow = stockByKey.get(`${s.id}|${wh.id}`);
        const bookQty = stockRow ? Number(stockRow.quantity) : 0;
        const actualQty = Number(it.actualQty);

        itemRows.push({
          stocktakeId,
          skuId: s.id,
          itemCode: s.skuCode,
          itemName: `${s.styleNo}/${s.color}/${s.size}`,
          color: s.color,
          size: s.size,
          bookQty: round3(bookQty),
          actualQty: round3(actualQty),
          diffQty: round3(actualQty - bookQty),
        });

        // 按批次记录/更新库存（收集后统一多值 upsert，替代逐条 UPDATE/INSERT N+1）
        const batchNo = it.batchNo || 'DEFAULT';
        const bKey = `${s.id}|${wh.id}|${batchNo}`;
        batchUpsertMap.set(bKey, {
          skuId: s.id,
          skuCode: s.skuCode,
          styleNo: s.styleNo,
          color: s.color,
          size: s.size,
          warehouseId: wh.id,
          warehouseName: wh.name,
          batchNo,
          quantity: round3(actualQty),
          status: 'active',
        });
      }

      // 一次多值 upsert 写入/更新批次库存（已按键合并，不会同键冲突）
      const batchRows = [...batchUpsertMap.values()];
      if (batchRows.length > 0) {
        await bulkUpsert(
          tx,
          inventoryBatch,
          batchRows,
          [inventoryBatch.skuId, inventoryBatch.warehouseId, inventoryBatch.batchNo],
          { quantity: sql`EXCLUDED.quantity` },
        );
      }

      await tx.insert(inventoryStocktakeItem).values(itemRows);
      return { stocktakeNo, itemCount: itemRows.length };
    });
  }

  /**
   * 批次库存查询。
   */
  async listBatches(params: {
    page: number;
    pageSize: number;
    skuCode?: string;
    warehouseId?: string;
    batchNo?: string;
  }): Promise<PaginationResult<InventoryBatch>> {
    const { page, pageSize, skuCode, warehouseId, batchNo } = params;
    const conditions = [];
    if (skuCode) conditions.push(sql`${inventoryBatch.skuCode} like ${`%${skuCode}%`}`);
    if (warehouseId) conditions.push(eq(inventoryBatch.warehouseId, warehouseId));
    if (batchNo) conditions.push(eq(inventoryBatch.batchNo, batchNo));
    // 行级数据权限：批次库存同样按仓库归属经销商隔离，防止跨租户越权读取
    const batchScope = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryBatch.warehouseId },
    );
    if (batchScope) conditions.push(batchScope);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(inventoryBatch).where(where),
      this.db
        .select()
        .from(inventoryBatch)
        .where(where)
        .orderBy(desc(inventoryBatch.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: InventoryBatch[] = rows.map((row) => ({
      id: row.id,
      skuId: row.skuId,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      batchNo: row.batchNo,
      quantity: Number(row.quantity),
      productionDate: row.productionDate ?? undefined,
      expiryDate: row.expiryDate ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }
}
