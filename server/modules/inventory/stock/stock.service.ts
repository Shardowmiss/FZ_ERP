import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { round3 } from '../../../common/utils/money';
import {
  inventoryStock,
  materialStock,
  inventoryFlow,
  sku,
  material,
} from '@server/database/schema';
import { bulkUpsert } from '@server/common/batch';

export type ItemType = 'sku' | 'material';

/**
 * 库存类型（服装零售核心维度，迁移 0048）。
 * 与 inventory_stock.stock_type 的 CHECK 约束保持一致。
 */
export const STOCK_TYPES = [
  'normal',
  'defective',
  'sample',
  'leftover',
  'clearance',
] as const;

export type StockType = (typeof STOCK_TYPES)[number];

/** 缺省库存类型：存量数据与未显式指定的业务一律走 normal，行为与改造前一致 */
export const DEFAULT_STOCK_TYPE: StockType = 'normal';

export interface StockChangeItem {
  warehouseId: string;
  warehouseName: string;
  skuId?: string;
  materialId?: string;
  itemType: ItemType;
  qtyDelta: number;
  flowType: string;
  bizNo: string;
  bizItemId?: string;
  batchNo?: string;
  unitPrice?: string;
  operator?: string;
  remark?: string;
  /** sku 展示字段，已知时传入可减少一次查询 */
  skuCode?: string;
  styleNo?: string;
  color?: string;
  size?: string;
  /** material 展示字段，已知时传入可减少一次查询 */
  materialCode?: string;
  materialName?: string;
  /**
   * 库存类型（服装零售核心维度，迁移 0048）：
   *   'normal' 正常品（默认，存量行为） / 'defective' 残次品 / 'sample' 样品
   *   / 'leftover' 尾货 / 'clearance' 清仓
   *
   * 为可选字段，**不传等价于 'normal'**，因此 18 个调用方 service
   * （采购/销售/零售/调拨/盘点/生产/委外/订货会）无需改动即保持原有行为。
   * 只有明确需要把库存记入非正常品类的单据才显式传入（如残次品退货入库、
   * 样品领用、季末尾货清理）。
   */
  stockType?: StockType;
}

type TxLike = PostgresJsDatabase | Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];


@Injectable()
export class StockService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 通用库存变动方法
   * qtyDelta > 0 表示增加库存，qtyDelta < 0 表示扣减库存
   * 扣减时使用原子 UPDATE（带数量校验），不足则抛 ConflictException('库存不足')
   * 增加时使用 upsert（存在则累加，不存在则插入）
   * 同时写入 inventory_flow 流水
   */
  async changeStock(
    tx: TxLike,
    item: StockChangeItem,
  ): Promise<void> {
    await this.batchChangeStock(tx, [item]);
  }

  /**
   * 单个 SKU 库存扣减：原子 UPDATE + 数量校验
   * 数量不足抛 ConflictException('库存不足')
   *
   * stockType（迁移 0048）：按库存类型定位/扣减对应行。缺省 normal，
   * 保证未传该参数的 18 个调用方行为与改造前完全一致。
   */
  private async decreaseSkuStock(
    tx: TxLike,
    params: {
      skuId: string;
      warehouseId: string;
      qty: number;
      skuCode?: string;
      stockType?: StockType;
    },
  ): Promise<void> {
    const { skuId, warehouseId, qty, skuCode } = params;
    const stockType = params.stockType ?? DEFAULT_STOCK_TYPE;
    const result = await tx
      .update(inventoryStock)
      .set({
        quantity: sql`${inventoryStock.quantity} - ${round3(qty)}::numeric`,
      })
      .where(
        and(
          eq(inventoryStock.skuId, skuId),
          eq(inventoryStock.warehouseId, warehouseId),
          eq(inventoryStock.stockType, stockType),
          sql`${inventoryStock.quantity} >= ${round3(qty)}::numeric`,
        ),
      )
      .returning({ id: inventoryStock.id });

    if (result.length === 0) {
      throw new ConflictException(
        `库存不足：SKU ${skuCode ?? skuId}`,
      );
    }
  }

  /**
   * 单个 SKU 库存增加：INSERT ... ON CONFLICT DO UPDATE (upsert)
   * 依赖 idx_inventory_stock_sku_wh_type 唯一索引（含 stock_type，迁移 0048）
   */
  private async increaseSkuStock(
    tx: TxLike,
    params: {
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      warehouseId: string;
      warehouseName: string;
      qty: number;
      stockType?: StockType;
    },
  ): Promise<void> {
    const { skuId, skuCode, styleNo, color, size, warehouseId, warehouseName, qty } = params;
    const stockType = params.stockType ?? DEFAULT_STOCK_TYPE;
    await tx
      .insert(inventoryStock)
      .values({
        skuId,
        skuCode,
        styleNo,
        color,
        size,
        warehouseId,
        warehouseName,
        quantity: round3(qty),
        stockType,
      })
      .onConflictDoUpdate({
        target: [inventoryStock.skuId, inventoryStock.warehouseId, inventoryStock.stockType],
        set: {
          quantity: sql`${inventoryStock.quantity} + EXCLUDED.quantity`,
        },
      });
  }

  /**
   * 单个物料库存扣减：原子 UPDATE + 数量校验
   */
  private async decreaseMaterialStock(
    tx: TxLike,
    params: { materialId: string; warehouseId: string; qty: number; materialCode?: string },
  ): Promise<void> {
    const { materialId, warehouseId, qty, materialCode } = params;
    const result = await tx
      .update(materialStock)
      .set({
        quantity: sql`${materialStock.quantity} - ${round3(qty)}::numeric`,
      })
      .where(
        and(
          eq(materialStock.materialId, materialId),
          eq(materialStock.warehouseId, warehouseId),
          sql`${materialStock.quantity} >= ${round3(qty)}::numeric`,
        ),
      )
      .returning({ id: materialStock.id });

    if (result.length === 0) {
      throw new ConflictException(
        `库存不足：物料 ${materialCode ?? materialId}`,
      );
    }
  }

  /**
   * 单个物料库存增加：INSERT ... ON CONFLICT DO UPDATE (upsert)
   * 依赖 idx_material_stock_mat_wh 唯一索引
   */
  private async increaseMaterialStock(
    tx: TxLike,
    params: {
      materialId: string;
      materialCode: string;
      materialName: string;
      warehouseId: string;
      warehouseName: string;
      qty: number;
    },
  ): Promise<void> {
    const { materialId, materialCode, materialName, warehouseId, warehouseName, qty } = params;
    await tx
      .insert(materialStock)
      .values({
        materialId,
        materialCode,
        materialName,
        warehouseId,
        warehouseName,
        quantity: round3(qty),
      })
      .onConflictDoUpdate({
        target: [materialStock.materialId, materialStock.warehouseId],
        set: {
          quantity: sql`${materialStock.quantity} + EXCLUDED.quantity`,
        },
      });
  }

  /**
   * 查询单个库存数量
   */
  async getStock(
    tx: TxLike,
    warehouseId: string,
    itemId: string,
    itemType: ItemType,
  ): Promise<number> {
    if (itemType === 'sku') {
      const rows = await tx
        .select()
        .from(inventoryStock)
        .where(
          and(
            eq(inventoryStock.skuId, itemId),
            eq(inventoryStock.warehouseId, warehouseId),
          ),
        )
        .limit(1);
      return rows.length > 0 ? Number(rows[0].quantity) : 0;
    } else {
      const rows = await tx
        .select()
        .from(materialStock)
        .where(
          and(
            eq(materialStock.materialId, itemId),
            eq(materialStock.warehouseId, warehouseId),
          ),
        )
        .limit(1);
      return rows.length > 0 ? Number(rows[0].quantity) : 0;
    }
  }

  /**
   * 批量库存变动
   * - 批量补齐 SKU/物料展示字段（1 次查询）
   * - 增加用 upsert（1 次查询/条，比 SELECT+UPDATE/INSERT 少 1 次）
   * - 扣减用原子 UPDATE（1 次查询/条，带库存不足校验）
   * - 流水批量 INSERT（1 次查询）
   */
  async batchChangeStock(
    tx: TxLike,
    changes: StockChangeItem[],
  ): Promise<void> {
    const valid = changes.filter((c) => c.qtyDelta !== 0);
    if (valid.length === 0) return;

    // 按类型分组
    const skuItems: (StockChangeItem & { skuId: string })[] = [];
    const materialItems: (StockChangeItem & { materialId: string })[] = [];

    for (const c of valid) {
      if (c.itemType === 'sku' && c.skuId) {
        skuItems.push({ ...c, skuId: c.skuId });
      } else if (c.itemType === 'material' && c.materialId) {
        materialItems.push({ ...c, materialId: c.materialId });
      }
    }

    const flowRecords: typeof inventoryFlow.$inferInsert[] = [];

    // 处理 SKU 库存变动
    if (skuItems.length > 0) {
      const { items: filled, flows } = await this.fillSkuDisplayFields(tx, skuItems);
      flowRecords.push(...flows);

      // 先扣减（库存不足时尽早失败）
      for (const item of filled) {
        if (item.qtyDelta < 0) {
          await this.decreaseSkuStock(tx, {
            skuId: item.skuId,
            warehouseId: item.warehouseId,
            qty: Math.abs(item.qtyDelta),
            skuCode: item.skuCode,
            stockType: item.stockType,
          });
        }
      }

      // 再增加（批量多值 upsert；同一 sku+仓库+类型的多次增加先按键合并累加，
      // 避免单条多值 ON CONFLICT 同键冲突。合并键含 stockType，迁移 0048）
      const skuIncreaseMap = new Map<string, (typeof inventoryStock.$inferInsert)>();
      for (const item of filled) {
        if (item.qtyDelta > 0) {
          const itemStockType = item.stockType ?? DEFAULT_STOCK_TYPE;
          const key = `${item.skuId}|${item.warehouseId}|${itemStockType}`;
          const q = round3(item.qtyDelta);
          const exist = skuIncreaseMap.get(key);
          if (exist) {
            exist.quantity = round3(Number(exist.quantity) + Number(q));
          } else {
            skuIncreaseMap.set(key, {
              skuId: item.skuId,
              skuCode: item.skuCode!,
              styleNo: item.styleNo!,
              color: item.color!,
              size: item.size!,
              warehouseId: item.warehouseId,
              warehouseName: item.warehouseName,
              quantity: q,
              stockType: itemStockType,
            });
          }
        }
      }
      const skuIncreaseRows = [...skuIncreaseMap.values()];
      if (skuIncreaseRows.length > 0) {
        await bulkUpsert(
          tx,
          inventoryStock,
          skuIncreaseRows,
          [inventoryStock.skuId, inventoryStock.warehouseId, inventoryStock.stockType],
          { quantity: sql`${inventoryStock.quantity} + EXCLUDED.quantity` },
        );
      }
    }

    // 处理物料库存变动
    if (materialItems.length > 0) {
      const { items: filled, flows } = await this.fillMaterialDisplayFields(tx, materialItems);
      flowRecords.push(...flows);

      // 先扣减
      for (const item of filled) {
        if (item.qtyDelta < 0) {
          await this.decreaseMaterialStock(tx, {
            materialId: item.materialId,
            warehouseId: item.warehouseId,
            qty: Math.abs(item.qtyDelta),
            materialCode: item.materialCode,
          });
        }
      }

      // 再增加（批量多值 upsert；同 material+仓库多次增加按键合并累加，避免 ON CONFLICT 同键冲突）
      const materialIncreaseMap = new Map<string, (typeof materialStock.$inferInsert)>();
      for (const item of filled) {
        if (item.qtyDelta > 0) {
          const key = `${item.materialId}|${item.warehouseId}`;
          const q = round3(item.qtyDelta);
          const exist = materialIncreaseMap.get(key);
          if (exist) {
            exist.quantity = round3(Number(exist.quantity) + Number(q));
          } else {
            materialIncreaseMap.set(key, {
              materialId: item.materialId,
              materialCode: item.materialCode!,
              materialName: item.materialName!,
              warehouseId: item.warehouseId,
              warehouseName: item.warehouseName,
              quantity: q,
            });
          }
        }
      }
      const materialIncreaseRows = [...materialIncreaseMap.values()];
      if (materialIncreaseRows.length > 0) {
        await bulkUpsert(
          tx,
          materialStock,
          materialIncreaseRows,
          [materialStock.materialId, materialStock.warehouseId],
          { quantity: sql`${materialStock.quantity} + EXCLUDED.quantity` },
        );
      }
    }

    // 批量插入流水
    if (flowRecords.length > 0) {
      await tx.insert(inventoryFlow).values(flowRecords);
    }
  }

  /**
   * 批量补齐 SKU 展示字段（skuCode/styleNo/color/size）
   * 同时生成 flow 记录所需的完整数据
   */
  private async fillSkuDisplayFields(
    tx: TxLike,
    items: (StockChangeItem & { skuId: string })[],
  ): Promise<{
    items: (StockChangeItem & {
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
    })[];
    flows: typeof inventoryFlow.$inferInsert[];
  }> {
    // 找出需要查 SKU 信息的
    const needLookup = items.filter(
      (i) => !i.skuCode || !i.styleNo || !i.color || !i.size,
    );

    const skuMap = new Map<string, { skuCode: string; styleNo: string; color: string; size: string }>();

    if (needLookup.length > 0) {
      const skuIds = [...new Set(needLookup.map((i) => i.skuId))];
      const rows = await tx
        .select({ id: sku.id, skuCode: sku.skuCode, styleNo: sku.styleNo, color: sku.color, size: sku.size })
        .from(sku)
        .where(inArray(sku.id, skuIds));
      for (const row of rows) {
        skuMap.set(row.id, {
          skuCode: row.skuCode,
          styleNo: row.styleNo,
          color: row.color,
          size: row.size,
        });
      }
    }

    const filled: (StockChangeItem & {
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
    })[] = [];
    const flows: typeof inventoryFlow.$inferInsert[] = [];

    for (const item of items) {
      let skuCodeVal = item.skuCode;
      let styleNoVal = item.styleNo;
      let colorVal = item.color;
      let sizeVal = item.size;

      if (!skuCodeVal || !styleNoVal || !colorVal || !sizeVal) {
        const info = skuMap.get(item.skuId);
        if (!info) {
          throw new NotFoundException(`SKU不存在: ${item.skuId}`);
        }
        skuCodeVal = info.skuCode;
        styleNoVal = info.styleNo;
        colorVal = info.color;
        sizeVal = info.size;
      }

      const filledItem = {
        ...item,
        skuId: item.skuId,
        skuCode: skuCodeVal,
        styleNo: styleNoVal,
        color: colorVal,
        size: sizeVal,
      };
      filled.push(filledItem);

      // 生成流水记录
      const direction = item.qtyDelta > 0 ? 'in' : 'out';
      const absQty = round3(Math.abs(item.qtyDelta));
      flows.push({
        flowType: item.flowType,
        bizNo: item.bizNo,
        direction,
        itemType: 'sku',
        skuId: item.skuId,
        materialId: null,
        styleNo: styleNoVal,
        color: colorVal,
        size: sizeVal,
        materialCode: null,
        materialName: null,
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        quantity: absQty,
        batchNo: item.batchNo ?? null,
        unitPrice: item.unitPrice ?? null,
        operator: item.operator ?? null,
        remark: item.remark ?? null,
      });
    }

    return { items: filled, flows };
  }

  /**
   * 批量补齐物料展示字段（materialCode/materialName）
   * 同时生成 flow 记录
   */
  private async fillMaterialDisplayFields(
    tx: TxLike,
    items: (StockChangeItem & { materialId: string })[],
  ): Promise<{
    items: (StockChangeItem & {
      materialId: string;
      materialCode: string;
      materialName: string;
    })[];
    flows: typeof inventoryFlow.$inferInsert[];
  }> {
    const needLookup = items.filter((i) => !i.materialCode || !i.materialName);

    const matMap = new Map<string, { materialCode: string; materialName: string }>();

    if (needLookup.length > 0) {
      const matIds = [...new Set(needLookup.map((i) => i.materialId))];
      const rows = await tx
        .select({ id: material.id, materialCode: material.code, materialName: material.name })
        .from(material)
        .where(inArray(material.id, matIds));
      for (const row of rows) {
        matMap.set(row.id, {
          materialCode: row.materialCode,
          materialName: row.materialName,
        });
      }
    }

    const filled: (StockChangeItem & {
      materialId: string;
      materialCode: string;
      materialName: string;
    })[] = [];
    const flows: typeof inventoryFlow.$inferInsert[] = [];

    for (const item of items) {
      let materialCodeVal = item.materialCode;
      let materialNameVal = item.materialName;

      if (!materialCodeVal || !materialNameVal) {
        const info = matMap.get(item.materialId);
        if (!info) {
          throw new NotFoundException(`物料不存在: ${item.materialId}`);
        }
        materialCodeVal = info.materialCode;
        materialNameVal = info.materialName;
      }

      const filledItem = {
        ...item,
        materialId: item.materialId,
        materialCode: materialCodeVal,
        materialName: materialNameVal,
      };
      filled.push(filledItem);

      const direction = item.qtyDelta > 0 ? 'in' : 'out';
      const absQty = round3(Math.abs(item.qtyDelta));
      flows.push({
        flowType: item.flowType,
        bizNo: item.bizNo,
        direction,
        itemType: 'material',
        skuId: null,
        materialId: item.materialId,
        styleNo: null,
        color: null,
        size: null,
        materialCode: materialCodeVal,
        materialName: materialNameVal,
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        quantity: absQty,
        batchNo: item.batchNo ?? null,
        unitPrice: item.unitPrice ?? null,
        operator: item.operator ?? null,
        remark: item.remark ?? null,
      });
    }

    return { items: filled, flows };
  }
}
