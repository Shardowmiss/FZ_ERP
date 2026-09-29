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
import { eq, and, sql, inArray } from 'drizzle-orm';
import {
  inventoryStock,
  sku,
  supplier,
  garmentPurchaseOrder,
  garmentPurchaseOrderSku,
} from '@server/database/schema';
import type {
  ReplenishGenerateResult,
  ReplenishSuggestion,
} from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3 } from '../../../common/utils/money';



@Injectable()
export class InventoryReplenishService {
  private readonly logger = new Logger(InventoryReplenishService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  /**
   * 基于低于安全下限的库存，计算补货建议（目标：补到安全上限）。
   */
  async suggest(params: {
    warehouseId?: string;
    keyword?: string;
  }): Promise<ReplenishSuggestion[]> {
    const { warehouseId, keyword } = params;
    const conditions = [sql`${inventoryStock.quantity} < ${sku.safetyStockMin}`];
    if (warehouseId) {
      conditions.push(eq(inventoryStock.warehouseId, warehouseId));
    }
    // 行级数据权限：补货建议仅基于当前用户所属经销商的仓库库存，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryStock.warehouseId },
    );
    if (scopeCond) conditions.push(scopeCond);
    if (keyword) {
      conditions.push(
        sql`(${inventoryStock.skuCode} LIKE ${`%${keyword}%`} OR ${inventoryStock.styleNo} LIKE ${`%${keyword}%`})`,
      );
    }

    const rows = await this.db
      .select({
        skuId: inventoryStock.skuId,
        skuCode: inventoryStock.skuCode,
        styleNo: inventoryStock.styleNo,
        color: inventoryStock.color,
        size: inventoryStock.size,
        warehouseId: inventoryStock.warehouseId,
        warehouseName: inventoryStock.warehouseName,
        quantity: inventoryStock.quantity,
        safetyMin: sku.safetyStockMin,
        safetyMax: sku.safetyStockMax,
      })
      .from(inventoryStock)
      .innerJoin(sku, eq(inventoryStock.skuId, sku.id))
      .where(and(...conditions))
      .orderBy(inventoryStock.warehouseName, inventoryStock.skuCode);

    return rows.map((row) => {
      const qty = Number(row.quantity);
      const min = Number(row.safetyMin);
      const max = Number(row.safetyMax);
      const suggestQty = Math.max(max - qty, 0);
      return {
        skuId: row.skuId,
        skuCode: row.skuCode,
        styleNo: row.styleNo,
        color: row.color,
        size: row.size,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        quantity: qty,
        safetyMin: min,
        safetyMax: max,
        suggestQty: suggestQty < min ? min : suggestQty,
      };
    });
  }

  /**
   * 一键生成成衣采购订单草稿：按供应商分组，每个供应商生成一张订单。
   */
  async generate(dto: {
    orderDate: string;
    items: {
      skuId: string;
      supplierId: string;
      quantity: number;
    }[];
  }): Promise<ReplenishGenerateResult> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('补货明细不能为空');
    }
    const skuIds = [...new Set(dto.items.map((it) => it.skuId))];
    const supplierIds = [...new Set(dto.items.map((it) => it.supplierId))];

    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) skuMap.set(s.id, s);

    const supRows = await this.db
      .select()
      .from(supplier)
      .where(inArray(supplier.id, supplierIds));
    const supMap = new Map<string, typeof supplier.$inferSelect>();
    for (const sp of supRows) supMap.set(sp.id, sp);

    // 按供应商分组
    const bySupplier = new Map<string, typeof dto.items>();
    for (const it of dto.items) {
      if (!skuMap.has(it.skuId)) {
        throw new BadRequestException(`SKU不存在: ${it.skuId}`);
      }
      if (!supMap.has(it.supplierId)) {
        throw new BadRequestException(`供应商不存在: ${it.supplierId}`);
      }
      if (it.quantity <= 0) {
        throw new BadRequestException('补货数量必须大于0');
      }
      const list = bySupplier.get(it.supplierId) ?? [];
      list.push(it);
      bySupplier.set(it.supplierId, list);
    }

    const orderNos: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const [supplierId, items] of bySupplier.entries()) {
        const sup = supMap.get(supplierId)!;
        const orderNo = await this.numberGenerator.generateNextNo(
          tx,
          garmentPurchaseOrder,
          garmentPurchaseOrder.orderNo,
          `GPO${dto.orderDate.replace(/-/g, '')}`,
          4,
        );
        let totalAmount = 0;
        let totalQty = 0;
        const skuItems: {
          orderId: string;
          styleId: string;
          styleNo: string;
          skuId: string;
          color: string;
          size: string;
          quantity: string;
          price: string;
          amount: string;
          receivedQty: string;
        }[] = [];

        for (const it of items) {
          const s = skuMap.get(it.skuId)!;
          const price = Number(s.costPrice ?? 0);
          const amount = price * it.quantity;
          totalAmount += amount;
          totalQty += it.quantity;
          skuItems.push({
            orderId: '',
            styleId: s.styleId,
            styleNo: s.styleNo,
            skuId: s.id,
            color: s.color,
            size: s.size,
            quantity: round3(it.quantity),
            price: round2(price),
            amount: round2(amount),
            receivedQty: '0',
          });
        }

        const inserted = await tx
          .insert(garmentPurchaseOrder)
          .values({
            orderNo,
            supplierId: sup.id,
            supplierName: sup.name,
            orderDate: dto.orderDate,
            totalAmount: round2(totalAmount),
            totalQty: round3(totalQty),
            status: 'draft',
            remark: '库存预警自动补货',
          })
          .returning();
        const orderId = inserted[0].id;
        await tx.insert(garmentPurchaseOrderSku).values(
          skuItems.map((si) => ({ ...si, orderId })),
        );
        orderNos.push(orderNo);
      }
    });

    return {
      orderCount: orderNos.length,
      totalSkuCount: dto.items.length,
      orderNos,
    };
  }
}
