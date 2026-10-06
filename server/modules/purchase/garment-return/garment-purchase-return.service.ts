import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, count, inArray, sql, gte, lte, eq } from 'drizzle-orm';
import {
  garmentPurchaseReturn,
  garmentPurchaseReturnSku,
  inventoryStock,
  payable,
  sku,
  dealer,
  store,
  warehouse,
  supplier,
} from '@server/database/schema';
import type {
  GarmentPurchaseReturn,
  GarmentPurchaseReturnSku,
  GarmentPurchaseReturnCreateDto,
  ReturnContext,
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
  warehouseId?: string;
  docStartDate?: string;
  docEndDate?: string;
  startDate?: string;
  endDate?: string;
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
      inboundId: row.inboundId ?? null,
      inboundNo: row.inboundNo ?? null,
      supplierId: row.supplierId ?? null,
      supplierName: row.supplierName ?? null,
      dealerId: row.dealerId ?? null,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      receiverType: row.receiverType as 'supplier' | 'store',
      receiverId: row.receiverId ?? null,
      receiverName: row.receiverName ?? null,
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
    const { page, pageSize, status, warehouseId, docStartDate, docEndDate, startDate, endDate } = query;
    const conditions = [];
    if (status) conditions.push(eq(garmentPurchaseReturn.status, status));
    // 店仓（仓库）精确过滤
    if (warehouseId) conditions.push(eq(garmentPurchaseReturn.warehouseId, warehouseId));
    // 单据日期（系统创建时间 createdAt）区间过滤，结束日用次日开区间含入整日
    if (docStartDate) conditions.push(sql`${garmentPurchaseReturn.createdAt} >= ${docStartDate}`);
    if (docEndDate) {
      const [y, m, d] = docEndDate.split('-').map(Number);
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 1);
      const nextDay = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      conditions.push(sql`${garmentPurchaseReturn.createdAt} < ${nextDay}`);
    }
    // 业务日期（退货日期 returnDate）区间过滤
    if (startDate) conditions.push(gte(garmentPurchaseReturn.returnDate, startDate));
    if (endDate) conditions.push(lte(garmentPurchaseReturn.returnDate, endDate));

    // 行级数据权限：直连 dealerId 列（HQ 全量，经销商仅本经销商）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: garmentPurchaseReturn.dealerId },
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
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: garmentPurchaseReturn.dealerId },
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

  /**
   * 退货新增页上下文（同面辅料退货语义）。
   */
  async getReturnContext(): Promise<ReturnContext> {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    if (scope.type === 'all') {
      return {
        accountType: 'hq',
        returnWarehouse: { id: '', name: '', readonly: false },
        receiver: { type: 'supplier', readonly: false },
      };
    }

    const dealerId = scope.dealerIds[0];
    const [cur] = await this.db.select().from(dealer).where(eq(dealer.id, dealerId));

    const [myStore] = await this.db
      .select({ id: store.id, name: store.name, warehouseId: store.warehouseId })
      .from(store)
      .where(eq(store.dealerId, dealerId));
    let returnWarehouse = { id: '', name: '', readonly: true as const };
    if (myStore?.warehouseId) {
      const [wh] = await this.db
        .select({ name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, myStore.warehouseId));
      returnWarehouse = {
        id: myStore.warehouseId,
        name: wh?.name ?? myStore.name,
        readonly: true,
      };
    }

    let parentStore:
      | { id: string; name: string; dealerId: string; dealerName: string }
      | undefined;
    if (cur?.parentId) {
      const [parent] = await this.db.select().from(dealer).where(eq(dealer.id, cur.parentId));
      const [ps] = await this.db
        .select({ id: store.id, name: store.name })
        .from(store)
        .where(eq(store.dealerId, cur.parentId));
      if (ps) {
        parentStore = {
          id: ps.id,
          name: ps.name,
          dealerId: parent?.id ?? '',
          dealerName: parent?.name ?? '',
        };
      }
    }

    return {
      accountType: 'dealer',
      dealerId,
      dealerName: cur?.name,
      returnWarehouse,
      receiver: { type: 'store', readonly: true, store: parentStore },
    };
  }

  async create(
    dto: GarmentPurchaseReturnCreateDto,
    tx?: TxLike,
  ): Promise<GarmentPurchaseReturn> {
    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const isHq = scope.type === 'all';
    const curDealerId: string | null = isHq ? null : scope.dealerIds[0];

    let warehouseId: string;
    let warehouseName: string;
    let dealerId: string | null = curDealerId;
    let receiverType: 'supplier' | 'store';
    let receiverId: string;
    let receiverName: string;
    let supplierId: string | null = null;
    let supplierName: string | null = null;

    if (isHq) {
      if (!dto.warehouseId) throw new BadRequestException('请选择退货店仓');
      if (!dto.receiver || dto.receiver.type !== 'supplier' || !dto.receiver.id) {
        throw new BadRequestException('请选择收货供应商');
      }
      const [wh] = await this.db
        .select({ id: warehouse.id, name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, dto.warehouseId));
      if (!wh) throw new BadRequestException('退货店仓不存在');
      const [sup] = await this.db
        .select({ id: supplier.id, name: supplier.name })
        .from(supplier)
        .where(eq(supplier.id, dto.receiver.id));
      if (!sup) throw new BadRequestException('收货供应商不存在');
      warehouseId = wh.id;
      warehouseName = wh.name;
      receiverType = 'supplier';
      receiverId = sup.id;
      receiverName = sup.name;
      supplierId = sup.id;
      supplierName = sup.name;
    } else {
      const ctx = await this.getReturnContext();
      if (!ctx.returnWarehouse.id) {
        throw new BadRequestException('当前经销商无关联店仓，无法退货');
      }
      if (!ctx.receiver.store) {
        throw new BadRequestException('当前经销商无上级经销商店仓，无法退货');
      }
      warehouseId = ctx.returnWarehouse.id;
      warehouseName = ctx.returnWarehouse.name;
      receiverType = 'store';
      receiverId = ctx.receiver.store.id;
      receiverName = ctx.receiver.store.name;
    }

    await assertWriteWithinScope(this.db, {
      dealerId,
      warehouseId,
      supplierId: receiverType === 'supplier' ? receiverId : null,
    });

    // 校验 SKU 存在性
    const skuIds: string[] = dto.skus.map((s) => s.skuId);
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map(skuRows.map((s) => [s.id, s]));

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
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException('退货数量必须大于 0');
      }
      if (!Number.isFinite(prc) || prc < 0) {
        throw new BadRequestException('退货单价不合法');
      }
      const skuItem = skuMap.get(s.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${s.skuId}`);
      }
      // 校验退货店仓库存是否充足（仅控库存，不控原单上限）
      const [stk] = await this.db
        .select()
        .from(inventoryStock)
        .where(
          and(
            eq(inventoryStock.skuId, s.skuId),
            eq(inventoryStock.warehouseId, warehouseId),
          ),
        );
      if (!stk || Number(stk.quantity) < qty) {
        throw new BadRequestException(`SKU ${skuItem.skuCode} 在退货店仓库存不足，无法退货`);
      }

      const amt: number = qty * prc;
      totalAmount += amt;
      totalQty += qty;

      returnSkus.push({
        inboundSkuId: s.inboundSkuId ?? null,
        styleId: s.styleId,
        styleNo: s.styleNo,
        skuId: skuItem.id,
        color: s.color,
        size: s.size,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        batchNo: s.batchNo ?? null,
      });
    }

    const exec = async (runner: TxLike): Promise<GarmentPurchaseReturn> => {
      const returnNo: string = await this.generateReturnNo(runner, dto.returnDate);
      const [inserted] = await runner
        .insert(garmentPurchaseReturn)
        .values({
          returnNo,
          inboundId: dto.inboundId ?? null,
          inboundNo: null,
          supplierId,
          supplierName,
          dealerId,
          warehouseId,
          warehouseName,
          receiverType,
          receiverId,
          receiverName,
          returnDate: dto.returnDate,
          totalAmount: round2(totalAmount),
          totalQty: round3(totalQty),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const returnId: string = inserted.id;
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
      const ret = this.mapReturn(inserted);
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

    // 审核时再次校验退货店仓库存充足
    for (const s of skuRows) {
      const [stk] = await this.db
        .select()
        .from(inventoryStock)
        .where(
          and(
            eq(inventoryStock.skuId, s.skuId),
            eq(inventoryStock.warehouseId, ret.warehouseId),
          ),
        );
      if (!stk || Number(stk.quantity) < Number(s.quantity)) {
        throw new ConflictException(
          `SKU ${s.skuId} 在退货店仓库存不足，无法审核退货`,
        );
      }
    }

    await this.db.transaction(async (tx) => {
      // 1. 更新退货单状态
      await tx
        .update(garmentPurchaseReturn)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(garmentPurchaseReturn.id, id));

      // 2+3. 扣减成品库存 + 生成库存流水
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

      // 4. 总部退货（收货方=供应商）：生成应付红冲（负数应付单）
      if (ret.receiverType === 'supplier' && ret.supplierId) {
        const payableNo = `GAPR-${ret.returnNo}`;
        await tx.insert(payable).values({
          payableNo,
          supplierId: ret.supplierId,
          supplierName: ret.supplierName ?? '',
          bizType: 'garment_purchase_return',
          bizNo: ret.returnNo,
          amount: round2(-Number(ret.totalAmount)),
          paidAmount: '0',
          balance: round2(-Number(ret.totalAmount)),
          status: 'unpaid',
          remark: `成衣采购退货冲减应付 ${ret.returnNo}`,
        });
      }
      // 经销商退货（收货方=上级店仓）为内部调拨，不产生应付。
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
