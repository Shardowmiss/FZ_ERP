import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import {
  garmentPurchaseReturn,
  garmentPurchaseReturnSku,
  garmentPurchaseInbound,
  garmentPurchaseInboundSku,
  inventoryStock,
  payable,
  sku,
} from '@server/database/schema';
import type {
  GarmentPurchaseReturn,
  GarmentPurchaseReturnSku,
  GarmentPurchaseReturnCreateDto,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { StockService, StockChangeItem } from '../../inventory/stock/stock.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




type TxLike =
  PostgresJsDatabase |
  Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

interface ListQuery {
  page: number;
  pageSize: number;
  status?: string;
}

@Injectable()
export class GarmentPurchaseReturnService {
  private readonly logger = new Logger(GarmentPurchaseReturnService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly stockService: StockService,
  ) {}

  private async generateReturnNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart: string = dateStr.replace(/-/g, '');
    const prefix: string = `GPR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      garmentPurchaseReturn,
      garmentPurchaseReturn.returnNo,
      prefix,
      4,
    );
  }

  private mapReturn(row: typeof garmentPurchaseReturn.$inferSelect): GarmentPurchaseReturn {
    return {
      id: row.id,
      returnNo: row.returnNo,
      inboundId: row.inboundId,
      inboundNo: row.inboundNo,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      returnDate: row.returnDate,
      totalAmount: Number(row.totalAmount),
      totalQty: Number(row.totalQty),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapReturnSku(row: typeof garmentPurchaseReturnSku.$inferSelect): GarmentPurchaseReturnSku {
    return {
      id: row.id,
      returnId: row.returnId,
      inboundSkuId: row.inboundSkuId ?? undefined,
      styleId: row.styleId,
      styleNo: row.styleNo,
      skuId: row.skuId,
      color: row.color,
      size: row.size,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      batchNo: row.batchNo ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<GarmentPurchaseReturn>> {
    const { page, pageSize, status } = query;
    const conditions = [];
    if (status) conditions.push(eq(garmentPurchaseReturn.status, status));

    // 行级数据权限：仅可见当前用户所属经销商的供应商关联成衣采购退货单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: garmentPurchaseReturn.supplierId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset: number = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(garmentPurchaseReturn).where(where),
      this.db
        .select()
        .from(garmentPurchaseReturn)
        .where(where)
        .orderBy(desc(garmentPurchaseReturn.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total: number = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapReturn(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<GarmentPurchaseReturn> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: garmentPurchaseReturn.supplierId },
    );
    const where = scopeCond
      ? and(eq(garmentPurchaseReturn.id, id), scopeCond)
      : eq(garmentPurchaseReturn.id, id);
    const rows = await this.db
      .select()
      .from(garmentPurchaseReturn)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购退货单不存在');
    }

    const skuRows = await this.db
      .select()
      .from(garmentPurchaseReturnSku)
      .where(eq(garmentPurchaseReturnSku.returnId, id));

    const ret: GarmentPurchaseReturn = this.mapReturn(rows[0]);
    ret.skus = skuRows.map((row) => this.mapReturnSku(row));
    return ret;
  }

  async create(
    dto: GarmentPurchaseReturnCreateDto,
    tx?: TxLike,
  ): Promise<GarmentPurchaseReturn> {
    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    // 校验入库单
    const inboundRows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, dto.inboundId));
    if (inboundRows.length === 0) {
      throw new BadRequestException('入库单不存在');
    }
    if (inboundRows[0].status !== 'approved') {
      throw new BadRequestException('只能基于已审核的入库单退货');
    }
    const inbound = inboundRows[0];

    await assertWriteWithinScope(this.db, { supplierId: inbound.supplierId, warehouseId: inbound.warehouseId });

    // 取入库单 SKU 明细
    const inboundSkuRows = await this.db
      .select()
      .from(garmentPurchaseInboundSku)
      .where(eq(garmentPurchaseInboundSku.inboundId, dto.inboundId));
    const inboundSkuMap = new Map<string, typeof garmentPurchaseInboundSku.$inferSelect>();
    for (const is of inboundSkuRows) {
      if (is.id) inboundSkuMap.set(is.id, is);
    }

    // 校验 SKU
    const skuIds: string[] = dto.skus.map((s) => s.skuId);
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    let totalAmount: number = 0;
    let totalQty: number = 0;
    const returnSkus: {
      inboundSkuId: string | null;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      amount: string;
      batchNo: string | null;
    }[] = [];

    for (const s of dto.skus) {
      const qty: number = Number(s.quantity);
      const prc: number = Number(s.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const skuItem = skuMap.get(s.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${s.skuId}`);
      }

      // 有 inboundSkuId 时校验退货数量不超过入库数量
      if (s.inboundSkuId) {
        const inboundSku = inboundSkuMap.get(s.inboundSkuId);
        if (!inboundSku) {
          throw new BadRequestException(`入库SKU明细不存在: ${s.inboundSkuId}`);
        }
        const inboundQty: number = Number(inboundSku.quantity);
        if (qty > inboundQty) {
          throw new BadRequestException(
            `退货数量超过入库数量：SKU ${skuItem.skuCode}，最大可退 ${inboundQty.toFixed(3)}`,
          );
        }
      }

      const amt: number = qty * prc;
      totalAmount += amt;
      totalQty += qty;

      // 校验库存是否足够
      const stockRows = await this.db
        .select()
        .from(inventoryStock)
        .where(
          and(
            eq(inventoryStock.skuId, s.skuId),
            eq(inventoryStock.warehouseId, inbound.warehouseId),
          ),
        );
      if (stockRows.length === 0 || Number(stockRows[0].quantity) < qty) {
        throw new BadRequestException(`SKU ${skuItem.skuCode} 库存不足，无法退货`);
      }

      returnSkus.push({
        inboundSkuId: s.inboundSkuId ?? null,
        styleId: s.styleId,
        styleNo: s.styleNo,
        skuId: skuItem.id,
        color: skuItem.color,
        size: skuItem.size,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        batchNo: s.batchNo ?? null,
      });
    }

    const exec = async (runner: TxLike): Promise<GarmentPurchaseReturn> => {
      const returnNo: string = await this.generateReturnNo(runner, dto.returnDate);
      const inserted = await runner
        .insert(garmentPurchaseReturn)
        .values({
          returnNo,
          inboundId: inbound.id,
          inboundNo: inbound.inboundNo,
          supplierId: inbound.supplierId,
          supplierName: inbound.supplierName,
          warehouseId: inbound.warehouseId,
          warehouseName: inbound.warehouseName,
          returnDate: dto.returnDate,
          totalAmount: round2(totalAmount),
          totalQty: round3(totalQty),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const returnId: string = inserted[0].id;
      await runner.insert(garmentPurchaseReturnSku).values(
        returnSkus.map((item) => ({
          ...item,
          returnId,
        })),
      );

      const skuRows = await runner
        .select()
        .from(garmentPurchaseReturnSku)
        .where(eq(garmentPurchaseReturnSku.returnId, returnId));
      const ret = this.mapReturn(inserted[0]);
      ret.skus = skuRows.map((r) => this.mapReturnSku(r));
      return ret;
    };

    if (tx) {
      return exec(tx);
    }
    return this.db.transaction(async (t) => exec(t));
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseReturn)
      .where(eq(garmentPurchaseReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购退货单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的退货单才能审核');
    }
    const ret = rows[0];

    const skuRows = await this.db
      .select()
      .from(garmentPurchaseReturnSku)
      .where(eq(garmentPurchaseReturnSku.returnId, id));

    await this.db.transaction(async (tx) => {
      // 1. 更新退货单状态
      await tx
        .update(garmentPurchaseReturn)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(garmentPurchaseReturn.id, id));

      // 2+3. 扣减成品库存 + 生成库存流水（统一收敛到 StockService：原子扣减带库存不足校验 + 批量流水）
      const stockChanges: StockChangeItem[] = skuRows.map((s) => ({
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        skuId: s.skuId,
        itemType: 'sku',
        qtyDelta: -Number(s.quantity),
        flowType: 'garment_purchase_return',
        bizNo: ret.returnNo,
        batchNo: s.batchNo ?? null,
        unitPrice: s.price ?? null,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 4. 冲减应付：找对应的 payable（bizNo = 入库单号）
      const payableRows = await tx
        .select()
        .from(payable)
        .where(
          and(
            eq(payable.bizNo, ret.inboundNo),
            eq(payable.bizType, 'garment_purchase_inbound'),
          ),
        );
      if (payableRows.length > 0) {
        const p = payableRows[0];
        const returnAmt: number = Number(ret.totalAmount);
        const newAmount: number = Math.max(0, Number(p.amount) - returnAmt);
        const newBalance: number = Math.max(0, Number(p.balance) - returnAmt);
        await tx
          .update(payable)
          .set({
            amount: round2(newAmount),
            balance: round2(newBalance),
            status: newBalance <= 0 ? 'paid' : p.status,
            updatedAt: new Date(),
          })
          .where(eq(payable.id, p.id));
      }
    });
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, garmentPurchaseReturn, id, {
      draftValue: 'draft',
      notFoundMsg: "成衣采购退货单不存在",
      guardMsg: "只能删除草稿状态的退货单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseReturn)
      .where(eq(garmentPurchaseReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购退货单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的退货单');
    }
    await this.db.delete(garmentPurchaseReturn).where(eq(garmentPurchaseReturn.id, id));
  }
}
