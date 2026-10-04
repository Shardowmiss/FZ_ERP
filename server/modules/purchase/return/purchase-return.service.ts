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
import { eq, and, desc, count, sql, inArray, gte, lte, like, or } from 'drizzle-orm';
import {
  purchaseReturn,
  purchaseReturnItem,
  purchaseInbound,
  purchaseInboundItem,
  payable,
  material,
  materialStock,
} from '@server/database/schema';
import type {
  PurchaseReturn,
  PurchaseReturnItem,
  PaginationResult,
} from '@shared/api.interface';
import { StockService } from '../../inventory/stock/stock.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




interface CreateReturnDto {
  inboundId: string;
  returnDate: string;
  remark?: string;
  items: {
    materialId: string;
    quantity: number;
    price: number;
    batchNo?: string;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  supplierId?: string;
  warehouseId?: string;
  keyword?: string;
}

@Injectable()
export class PurchaseReturnService {
  private readonly logger = new Logger(PurchaseReturnService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateReturnNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `PR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      purchaseReturn,
      purchaseReturn.returnNo,
      prefix,
      4,
    );
  }

  private mapReturn(row: typeof purchaseReturn.$inferSelect): PurchaseReturn {
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
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapReturnItem(row: typeof purchaseReturnItem.$inferSelect): PurchaseReturnItem {
    return {
      id: row.id,
      returnId: row.returnId,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      batchNo: row.batchNo ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<PurchaseReturn>> {
    const { page, pageSize, status, startDate, endDate, supplierId, warehouseId, keyword } = query;
    const conditions = [];
    if (status) conditions.push(eq(purchaseReturn.status, status));
    if (startDate) conditions.push(gte(purchaseReturn.returnDate, startDate));
    if (endDate) conditions.push(lte(purchaseReturn.returnDate, endDate));
    if (supplierId) conditions.push(eq(purchaseReturn.supplierId, supplierId));
    if (warehouseId) conditions.push(eq(purchaseReturn.warehouseId, warehouseId));
    if (keyword) {
      conditions.push(
        or(
          like(purchaseReturn.returnNo, `%${keyword}%`),
          like(purchaseReturn.supplierName, `%${keyword}%`),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseReturn).where(where),
      this.db
        .select()
        .from(purchaseReturn)
        .where(where)
        .orderBy(desc(purchaseReturn.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapReturn(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<PurchaseReturn> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: purchaseReturn.supplierId },
    );
    const where = scopeCond
      ? and(eq(purchaseReturn.id, id), scopeCond)
      : eq(purchaseReturn.id, id);
    const rows = await this.db
      .select()
      .from(purchaseReturn)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('采购退货单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(purchaseReturnItem)
      .where(eq(purchaseReturnItem.returnId, id));

    const ret = this.mapReturn(rows[0]);
    ret.items = itemRows.map((row) => this.mapReturnItem(row));
    return ret;
  }

  /**
   * 校验退货明细：物料存在性 + 数量不超过原入库数量 - 已退货数量
   */
  private async validateReturnItems(
    inboundId: string,
    items: { materialId: string; quantity: number }[],
    excludeReturnId?: string,
  ): Promise<void> {
    // 查询原入库单明细
    const inboundItems = await this.db
      .select()
      .from(purchaseInboundItem)
      .where(eq(purchaseInboundItem.inboundId, inboundId));

    if (inboundItems.length === 0) {
      throw new BadRequestException('原入库单无明细');
    }

    // 构建原入库数量 Map
    const inboundQtyMap = new Map<string, number>();
    for (const ii of inboundItems) {
      inboundQtyMap.set(ii.materialId, Number(ii.quantity));
    }

    // 校验物料是否在原入库单中
    for (const item of items) {
      if (!inboundQtyMap.has(item.materialId)) {
        throw new ConflictException('物料不在原入库单中');
      }
    }

    // 查询已审核的退货数量（按 inbound_id + material_id 汇总）
    const materialIds = items.map((item) => item.materialId);
    const returnedRows = await this.db
      .select({
        materialId: purchaseReturnItem.materialId,
        returnedQty: sql<number>`sum(${purchaseReturnItem.quantity})`,
      })
      .from(purchaseReturnItem)
      .innerJoin(purchaseReturn, eq(purchaseReturnItem.returnId, purchaseReturn.id))
      .where(
        and(
          eq(purchaseReturn.inboundId, inboundId),
          eq(purchaseReturn.status, 'approved'),
          inArray(purchaseReturnItem.materialId, materialIds),
          ...(excludeReturnId ? [sql`${purchaseReturn.id} != ${excludeReturnId}`] : []),
        ),
      )
      .groupBy(purchaseReturnItem.materialId);

    const returnedQtyMap = new Map<string, number>();
    for (const row of returnedRows) {
      returnedQtyMap.set(row.materialId, Number(row.returnedQty ?? 0));
    }

    // 校验数量
    for (const item of items) {
      const origQty = inboundQtyMap.get(item.materialId) ?? 0;
      const returnedQty = returnedQtyMap.get(item.materialId) ?? 0;
      const available = origQty - returnedQty;
      if (item.quantity > available + 0.0001) {
        throw new ConflictException('退货数量超过原入库数量');
      }
    }
  }

  async create(dto: CreateReturnDto): Promise<PurchaseReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    // 校验入库单
    const inboundRows = await this.db
      .select()
      .from(purchaseInbound)
      .where(eq(purchaseInbound.id, dto.inboundId));
    if (inboundRows.length === 0) {
      throw new BadRequestException('入库单不存在');
    }
    if (inboundRows[0].status !== 'approved') {
      throw new BadRequestException('只能基于已审核的入库单退货');
    }
    const inbound = inboundRows[0];

    await assertWriteWithinScope(this.db, { supplierId: inbound.supplierId });

    // 校验退货明细物料和数量
    await this.validateReturnItems(dto.inboundId, dto.items);

    // 校验退货总金额不超过原单可退金额
    const approvedReturnRows = await this.db
      .select({ totalAmount: purchaseReturn.totalAmount })
      .from(purchaseReturn)
      .where(
        and(
          eq(purchaseReturn.inboundId, dto.inboundId),
          eq(purchaseReturn.status, 'approved'),
        ),
      );
    const returnedAmount = approvedReturnRows.reduce(
      (sum: number, row) => sum + Number(row.totalAmount),
      0,
    );
    const inboundTotal = Number(inbound.totalAmount);
    const availableAmount = inboundTotal - returnedAmount;
    // 先计算本次退货总金额（与后面计算逻辑一致）
    let createTotalAmount = 0;
    for (const item of dto.items) {
      createTotalAmount += Number(item.quantity) * Number(item.price);
    }
    if (createTotalAmount > availableAmount + 0.01) {
      throw new ConflictException('退货金额超过原单金额');
    }

    // 取物料信息
    const materialIds = dto.items.map((item) => item.materialId);
    const matRows = await this.db
      .select()
      .from(material)
      .where(sql`${material.id} = ANY(ARRAY[${sql.join(materialIds.map((mid) => sql`${mid}`), sql`, `)}]::uuid[])`);
    const matMap = new Map<string, typeof material.$inferSelect>();
    for (const m of matRows) {
      matMap.set(m.id, m);
    }

    let totalAmount = 0;
    const returnItems: {
      materialId: string;
      materialCode: string;
      materialName: string;
      unit: string;
      quantity: string;
      price: string;
      amount: string;
      batchNo: string | null;
    }[] = [];

    for (const item of dto.items) {
      const qty = Number(item.quantity);
      const prc = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const mat = matMap.get(item.materialId);
      if (!mat) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
      const amt = qty * prc;
      totalAmount += amt;

      // 校验库存是否足够
      const stockRows = await this.db
        .select()
        .from(materialStock)
        .where(
          and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, inbound.warehouseId),
          ),
        );
      if (stockRows.length === 0 || Number(stockRows[0].quantity) < qty) {
        throw new BadRequestException(`物料 ${mat.name} 库存不足，无法退货`);
      }

      returnItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        unit: mat.unit,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        batchNo: item.batchNo ?? null,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const returnNo = await this.generateReturnNo(tx, dto.returnDate);

      const inserted = await tx
        .insert(purchaseReturn)
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
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const returnId = inserted[0].id;
      await tx.insert(purchaseReturnItem).values(
        returnItems.map((item) => ({
          ...item,
          returnId,
        })),
      );

      return inserted[0];
    });

    return this.getDetail(created.id);
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(purchaseReturn)
      .where(eq(purchaseReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购退货单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的退货单才能审核');
    }
    const ret = rows[0];

    const itemRows = await this.db
      .select()
      .from(purchaseReturnItem)
      .where(eq(purchaseReturnItem.returnId, id));

    // 审核时再次校验退货数量（防止并发或期间其他退货已审核）
    await this.validateReturnItems(
      ret.inboundId,
      itemRows.map((item) => ({
        materialId: item.materialId,
        quantity: Number(item.quantity),
      })),
      id,
    );

    await this.db.transaction(async (tx) => {
      // 1. 更新退货单状态
      await tx
        .update(purchaseReturn)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(purchaseReturn.id, id));

      // 2. 扣减面辅料库存 + 生成库存流水
      const stockChanges = itemRows.map((item) => ({
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        materialId: item.materialId,
        itemType: 'material' as const,
        qtyDelta: -Number(item.quantity),
        flowType: 'purchase_return',
        bizNo: ret.returnNo,
        batchNo: item.batchNo ?? undefined,
        unitPrice: item.price,
        materialCode: item.materialCode,
        materialName: item.materialName,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 3. 冲减应付：找对应的 payable（bizNo = 入库单号）
      const payableRows = await tx
        .select()
        .from(payable)
        .where(
          and(
            eq(payable.bizNo, ret.inboundNo),
            eq(payable.bizType, 'purchase_inbound'),
          ),
        );
      if (payableRows.length > 0) {
        const p = payableRows[0];
        const returnAmt = Number(ret.totalAmount);
        const curBalance = Number(p.balance);
        if (returnAmt > curBalance + 0.01) {
          throw new ConflictException('退货金额超过原单金额');
        }
        const newAmount = Number(p.amount) - returnAmt;
        const newBalance = curBalance - returnAmt;
        await tx
          .update(payable)
          .set({
            amount: round2(newAmount),
            balance: round2(newBalance),
            status: newBalance <= 0.01 ? 'paid' : p.status,
            updatedAt: new Date(),
          })
          .where(eq(payable.id, p.id));
      }
    });
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, purchaseReturn, id, {
      draftValue: 'draft',
      notFoundMsg: "采购退货单不存在",
      guardMsg: "只能删除草稿状态的退货单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(purchaseReturn)
      .where(eq(purchaseReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购退货单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的退货单');
    }
    await this.db.delete(purchaseReturn).where(eq(purchaseReturn.id, id));
  }
}
