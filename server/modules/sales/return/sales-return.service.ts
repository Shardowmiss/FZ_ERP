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
import { eq, and, desc, count, sql, inArray, isNull, gte, lte } from 'drizzle-orm';
import {
  salesReturn,
  salesReturnItem,
  salesOutbound,
  salesOutboundItem,
  receivable,
  sku,
} from '@server/database/schema';
import {
  SalesReturnStatus,
  SalesOutboundStatus,
} from '@shared/api.interface';
import type {
  SalesReturn,
  SalesReturnItem,
  PaginationResult,
} from '@shared/api.interface';
import { StockService } from '../../inventory/stock/stock.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { DistributionMirrorService } from '../../distribution/distribution-mirror.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




interface CreateReturnDto {
  outboundId: string;
  returnDate: string;
  remark?: string;
  items: {
    skuId: string;
    quantity: number;
    price: number;
    batchNo?: string;
  }[];
}

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
export class SalesReturnService {
  private readonly logger = new Logger(SalesReturnService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly distributionMirror: DistributionMirrorService,
  ) {}

  private async generateReturnNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `SR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      salesReturn,
      salesReturn.returnNo,
      prefix,
      4,
    );
  }

  private mapReturn(row: typeof salesReturn.$inferSelect): SalesReturn {
    return {
      id: row.id,
      returnNo: row.returnNo,
      outboundId: row.outboundId,
      outboundNo: row.outboundNo,
      dealerId: row.dealerId,
      customerName: row.customerName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      returnDate: row.returnDate,
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapReturnItem(row: typeof salesReturnItem.$inferSelect): SalesReturnItem {
    return {
      id: row.id,
      returnId: row.returnId,
      skuId: row.skuId,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      batchNo: row.batchNo ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<SalesReturn>> {
    const { page, pageSize, status, warehouseId, docStartDate, docEndDate, startDate, endDate } = query;
    const conditions = [];
    if (status) conditions.push(eq(salesReturn.status, status));
    // 店仓（仓库）精确过滤
    if (warehouseId) conditions.push(eq(salesReturn.warehouseId, warehouseId));
    // 单据日期（系统创建时间 createdAt）区间过滤，结束日用次日开区间含入整日
    if (docStartDate) conditions.push(sql`${salesReturn.createdAt} >= ${docStartDate}`);
    if (docEndDate) {
      const [y, m, d] = docEndDate.split('-').map(Number);
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 1);
      const nextDay = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      conditions.push(sql`${salesReturn.createdAt} < ${nextDay}`);
    }
    // 业务日期（退货日期 returnDate）区间过滤
    if (startDate) conditions.push(gte(salesReturn.returnDate, startDate));
    if (endDate) conditions.push(lte(salesReturn.returnDate, endDate));

    // 行级数据权限：仅可见当前用户所属经销商的客户关联销售退货单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: salesReturn.dealerId },
    );
    if (scopeCond) conditions.push(scopeCond);

    // 软删除过滤：仅返回未删除记录
    conditions.push(isNull(salesReturn.deletedAt));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(salesReturn).where(where),
      this.db
        .select()
        .from(salesReturn)
        .where(where)
        .orderBy(desc(salesReturn.createdAt))
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

  async getDetail(id: string): Promise<SalesReturn> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: salesReturn.dealerId },
    );
    const where = scopeCond
      ? and(eq(salesReturn.id, id), scopeCond, isNull(salesReturn.deletedAt))
      : and(eq(salesReturn.id, id), isNull(salesReturn.deletedAt));
    const rows = await this.db
      .select()
      .from(salesReturn)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('销售退货单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(salesReturnItem)
      .where(eq(salesReturnItem.returnId, id));

    const ret = this.mapReturn(rows[0]);
    ret.items = itemRows.map((row) => this.mapReturnItem(row));
    return ret;
  }

  /**
   * 校验退货明细：SKU 存在性 + 数量不超过原出库数量 - 已退货数量
   */
  private async validateReturnItems(
    outboundId: string,
    items: { skuId: string; quantity: number }[],
    excludeReturnId?: string,
  ): Promise<void> {
    // 查询原出库单明细
    const outboundItems = await this.db
      .select()
      .from(salesOutboundItem)
      .where(eq(salesOutboundItem.outboundId, outboundId));

    if (outboundItems.length === 0) {
      throw new BadRequestException('原出库单无明细');
    }

    // 构建原出库数量 Map
    const outboundQtyMap = new Map<string, number>();
    for (const oi of outboundItems) {
      outboundQtyMap.set(oi.skuId, Number(oi.quantity));
    }

    // 校验 SKU 是否在原出库单中
    for (const item of items) {
      if (!outboundQtyMap.has(item.skuId)) {
        throw new ConflictException('SKU不在原出库单中');
      }
    }

    // 查询已审核的退货数量（按 outbound_id + sku_id 汇总）
    const skuIds = items.map((item) => item.skuId);
    const returnedRows = await this.db
      .select({
        skuId: salesReturnItem.skuId,
        returnedQty: sql<number>`sum(${salesReturnItem.quantity})`,
      })
      .from(salesReturnItem)
      .innerJoin(salesReturn, eq(salesReturnItem.returnId, salesReturn.id))
      .where(
        and(
          eq(salesReturn.outboundId, outboundId),
          inArray(salesReturn.status, [SalesReturnStatus.BOOKED, SalesReturnStatus.ACCEPTED]),
          inArray(salesReturnItem.skuId, skuIds),
          ...(excludeReturnId ? [sql`${salesReturn.id} != ${excludeReturnId}`] : []),
        ),
      )
      .groupBy(salesReturnItem.skuId);

    const returnedQtyMap = new Map<string, number>();
    for (const row of returnedRows) {
      returnedQtyMap.set(row.skuId, Number(row.returnedQty ?? 0));
    }

    // 校验数量
    for (const item of items) {
      const origQty = outboundQtyMap.get(item.skuId) ?? 0;
      const returnedQty = returnedQtyMap.get(item.skuId) ?? 0;
      const available = origQty - returnedQty;
      if (item.quantity > available + 0.0001) {
        throw new ConflictException('退货数量超过原出库数量');
      }
    }
  }

  async create(dto: CreateReturnDto): Promise<SalesReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    // 校验出库单
    const outboundRows = await this.db
      .select()
      .from(salesOutbound)
      .where(eq(salesOutbound.id, dto.outboundId));
    if (outboundRows.length === 0) {
      throw new BadRequestException('出库单不存在');
    }
    if (outboundRows[0].status !== SalesOutboundStatus.BOOKED) {
      throw new BadRequestException('只能基于已记账的出库单退货');
    }
    const outbound = outboundRows[0];

    await assertWriteWithinScope(this.db, { dealerId: outbound.dealerId });

    // 校验退货明细 SKU 和数量
    await this.validateReturnItems(dto.outboundId, dto.items);

    // 校验退货总金额不超过原单可退金额
    const approvedReturnRows = await this.db
      .select({ totalAmount: salesReturn.totalAmount })
      .from(salesReturn)
        .where(
          and(
            eq(salesReturn.outboundId, dto.outboundId),
            inArray(salesReturn.status, [SalesReturnStatus.BOOKED, SalesReturnStatus.ACCEPTED]),
          ),
        );
    const returnedAmount = approvedReturnRows.reduce(
      (sum: number, row) => sum + Number(row.totalAmount),
      0,
    );
    const outboundTotal = Number(outbound.totalAmount);
    const availableAmount = outboundTotal - returnedAmount;
    // 先计算本次退货总金额（与后面计算逻辑一致）
    let createTotalAmount = 0;
    for (const item of dto.items) {
      createTotalAmount += Number(item.quantity) * Number(item.price);
    }
    if (createTotalAmount > availableAmount + 0.01) {
      throw new ConflictException('退货金额超过原单金额');
    }

    // 取SKU信息
    const skuIds = dto.items.map((item) => item.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    let totalAmount = 0;
    const returnItems: {
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      colorId: string | null;
      sizeId: string | null;
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
      const skuItem = skuMap.get(item.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${item.skuId}`);
      }
      const amt = qty * prc;
      totalAmount += amt;

      returnItems.push({
        skuId: skuItem.id,
        skuCode: skuItem.skuCode,
        styleNo: skuItem.styleNo,
        color: skuItem.color,
        size: skuItem.size,
        colorId: skuItem.colorId ?? null,
        sizeId: skuItem.sizeId ?? null,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        batchNo: item.batchNo ?? null,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const returnNo = await this.generateReturnNo(tx, dto.returnDate);

      const inserted = await tx
        .insert(salesReturn)
        .values({
          returnNo,
          outboundId: outbound.id,
          outboundNo: outbound.outboundNo,
          dealerId: outbound.dealerId,
          customerName: outbound.customerName,
          warehouseId: outbound.warehouseId,
          warehouseName: outbound.warehouseName,
          returnDate: dto.returnDate,
          totalAmount: round2(totalAmount),
          status: SalesReturnStatus.DRAFT,
          remark: dto.remark ?? null,
        })
        .returning();

      const returnId = inserted[0].id;
      await tx.insert(salesReturnItem).values(
        returnItems.map((item) => ({
          ...item,
          returnId,
        })),
      );

      return inserted[0];
    });

    return this.getDetail(created.id);
  }

  async audit(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesReturn)
      .where(eq(salesReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售退货单不存在');
    }
    if (rows[0].status !== SalesReturnStatus.DRAFT) {
      throw new BadRequestException('只有草稿状态的退货单才能审核');
    }
    await this.db
      .update(salesReturn)
      .set({ status: SalesReturnStatus.AUDITED, updatedAt: new Date() })
      .where(eq(salesReturn.id, id));
  }

  async cancelAudit(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesReturn)
      .where(eq(salesReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售退货单不存在');
    }
    if (rows[0].status !== SalesReturnStatus.AUDITED) {
      throw new BadRequestException('只有已审核状态的退货单才能取消审核');
    }
    await this.db
      .update(salesReturn)
      .set({ status: SalesReturnStatus.DRAFT, updatedAt: new Date() })
      .where(eq(salesReturn.id, id));
  }

  async book(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesReturn)
      .where(eq(salesReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售退货单不存在');
    }
    if (rows[0].status !== SalesReturnStatus.AUDITED) {
      throw new BadRequestException('只有已审核状态的退货单才能记账');
    }
    const ret = rows[0];

    const itemRows = await this.db
      .select()
      .from(salesReturnItem)
      .where(eq(salesReturnItem.returnId, id));

    // 记账时再次校验退货数量（防止并发或期间其他退货已记账）
    await this.validateReturnItems(
      ret.outboundId,
      itemRows.map((item) => ({
        skuId: item.skuId,
        quantity: Number(item.quantity),
      })),
      id,
    );

    await this.db.transaction(async (tx) => {
      // 1. 更新退货单状态为已记账（真正生效）
      await tx
        .update(salesReturn)
        .set({ status: SalesReturnStatus.BOOKED, updatedAt: new Date() })
        .where(eq(salesReturn.id, id));

      // 2. 增加成品库存 + 生成库存流水
      const stockChanges = itemRows.map((item) => ({
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        skuId: item.skuId,
        itemType: 'sku' as const,
        qtyDelta: Number(item.quantity),
        flowType: 'sales_return',
        bizNo: ret.returnNo,
        batchNo: item.batchNo ?? undefined,
        unitPrice: item.price,
        skuCode: item.skuCode,
        styleNo: item.styleNo,
        color: item.color,
        size: item.size,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 3. 冲减应收（找对应的 receivable）
      const receivableRows = await tx
        .select()
        .from(receivable)
        .where(
          and(
            eq(receivable.bizType, 'sales_outbound'),
            eq(receivable.bizNo, ret.outboundNo),
          ),
        );

      if (receivableRows.length > 0) {
        const rec = receivableRows[0];
        const returnAmt = Number(ret.totalAmount);
        const curBalance = Number(rec.balance);
        if (returnAmt > curBalance + 0.01) {
          throw new ConflictException('退货金额超过原单金额');
        }
        const newBalance = curBalance - returnAmt;
        const newAmount = Number(rec.amount) - returnAmt;
        await tx
          .update(receivable)
          .set({
            amount: round2(newAmount),
            balance: round2(newBalance),
            status: newBalance <= 0.01 ? 'paid' : rec.status,
            updatedAt: new Date(),
          })
          .where(eq(receivable.id, rec.id));
      }
    });

    // 分销镜像：记账后向下级分销商生成采购退货单（服务内部已吞掉异常，不影响主流程）
    await this.distributionMirror.mirrorFromSalesReturn(id);
  }

  async accept(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesReturn)
      .where(eq(salesReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售退货单不存在');
    }
    if (rows[0].status !== SalesReturnStatus.BOOKED) {
      throw new BadRequestException('只有已记账状态的退货单才能验收');
    }
    await this.db
      .update(salesReturn)
      .set({ status: SalesReturnStatus.ACCEPTED, updatedAt: new Date() })
      .where(eq(salesReturn.id, id));
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, salesReturn, id, {
      draftValue: SalesReturnStatus.DRAFT,
      notFoundMsg: "销售退货单不存在",
      guardMsg: "只能删除草稿状态的退货单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesReturn)
      .where(and(eq(salesReturn.id, id), isNull(salesReturn.deletedAt)));
    if (rows.length === 0) {
      throw new NotFoundException('销售退货单不存在');
    }
    if (rows[0].status !== SalesReturnStatus.DRAFT) {
      throw new BadRequestException('只能删除草稿状态的退货单');
    }
    // 软删除：仅置位 _deleted_at，不物理删除
    await this.db
      .update(salesReturn)
      .set({ deletedAt: new Date() })
      .where(eq(salesReturn.id, id));
  }
}
