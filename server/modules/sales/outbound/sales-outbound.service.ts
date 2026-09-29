import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count, sql, inArray, isNull } from 'drizzle-orm';
import {
  salesOutbound,
  salesOutboundItem,
  salesOrder,
  salesOrderItem,
  warehouse,
  receivable,
  sku,
  style,
} from '@server/database/schema';
import {
  SalesOutboundStatus,
  SalesOrderStatus,
} from '@shared/api.interface';
import type {
  SalesOutbound,
  SalesOutboundItem,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../../finance/month-close/month-close.service';
import { StockService } from '../../inventory/stock/stock.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




function generateReceivableNo(outboundNo: string): string {
  return `AR-${outboundNo}`;
}

interface CreateOutboundDto {
  orderId: string;
  warehouseId: string;
  outboundDate: string;
  remark?: string;
  items: {
    orderItemId: string;
    quantity: number;
    batchNo?: string;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  customerId?: string;
  status?: string;
  orderNo?: string;
  brand?: string;
}

@Injectable()
export class SalesOutboundService {
  private readonly logger = new Logger(SalesOutboundService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateOutboundNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `DO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      salesOutbound,
      salesOutbound.outboundNo,
      prefix,
      4,
    );
  }

  private mapOutbound(row: typeof salesOutbound.$inferSelect): SalesOutbound {
    return {
      id: row.id,
      outboundNo: row.outboundNo,
      orderId: row.orderId,
      orderNo: row.orderNo,
      customerId: row.customerId,
      customerName: row.customerName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      outboundDate: row.outboundDate,
      totalAmount: Number(row.totalAmount),
      costAmount: Number(row.costAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapOutboundItem(row: typeof salesOutboundItem.$inferSelect): SalesOutboundItem {
    return {
      id: row.id,
      outboundId: row.outboundId,
      orderItemId: row.orderItemId,
      skuId: row.skuId,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      quantity: Number(row.quantity),
      price: Number(row.price),
      costPrice: Number(row.costPrice),
      amount: Number(row.amount),
      costAmount: Number(row.costAmount),
      batchNo: row.batchNo ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<SalesOutbound>> {
    const { page, pageSize, customerId, status, orderNo, brand } = query;
    const conditions = [];
    if (customerId) conditions.push(eq(salesOutbound.customerId, customerId));
    if (status) conditions.push(eq(salesOutbound.status, status));
    if (orderNo) conditions.push(eq(salesOutbound.orderNo, orderNo));

    // 软删除过滤：仅返回未删除记录
    conditions.push(isNull(salesOutbound.deletedAt));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    if (brand) {
      // 当有 brand 筛选时，需要通过明细关联 style 表过滤
      const brandFilter = sql`${salesOutbound.id} IN (
        SELECT DISTINCT ${salesOutboundItem.outboundId}
        FROM ${salesOutboundItem}
        INNER JOIN ${style} ON ${salesOutboundItem.styleNo} = ${style.styleNo}
        WHERE ${style.brand} = ${brand}
      )`;

      const brandWhere = where ? and(where, brandFilter) : brandFilter;

      const [countResult, rows] = await Promise.all([
        this.db.select({ count: count() }).from(salesOutbound).where(brandWhere),
        this.db
          .select()
          .from(salesOutbound)
          .where(brandWhere)
          .orderBy(desc(salesOutbound.createdAt))
          .limit(pageSize)
          .offset(offset),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items: rows.map((row) => this.mapOutbound(row)),
        total,
        page,
        pageSize,
      };
    }

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(salesOutbound).where(where),
      this.db
        .select()
        .from(salesOutbound)
        .where(where)
        .orderBy(desc(salesOutbound.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapOutbound(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<SalesOutbound> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内，否则视为不存在
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaCustomer', column: salesOutbound.customerId },
    );
    const where = scopeCond
      ? and(eq(salesOutbound.id, id), scopeCond, isNull(salesOutbound.deletedAt))
      : and(eq(salesOutbound.id, id), isNull(salesOutbound.deletedAt));
    const rows = await this.db
      .select()
      .from(salesOutbound)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('销售出库单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(salesOutboundItem)
      .where(eq(salesOutboundItem.outboundId, id));

    const outbound = this.mapOutbound(rows[0]);
    outbound.items = itemRows.map((row) => this.mapOutboundItem(row));
    return outbound;
  }

  async create(dto: CreateOutboundDto): Promise<SalesOutbound> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('出库明细不能为空');
    }

    // 校验销售订单
    const orderRows = await this.db
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.id, dto.orderId));
    if (orderRows.length === 0) {
      throw new BadRequestException('销售订单不存在');
    }
    const order = orderRows[0];
    if (order.status !== SalesOrderStatus.BOOKED) {
      throw new BadRequestException('只能针对已记账的销售订单出库');
    }

    // 校验仓库
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }
    const wh = whRows[0];

    // 写入端行级权限：被引用的客户/仓库必须属于当前账号可见经销商
    await assertWriteWithinScope(this.db, {
      customerId: order.customerId,
      warehouseId: dto.warehouseId,
    });

    // 取订单明细
    const orderItemIds = dto.items.map((item) => item.orderItemId);
    const orderItemRows = await this.db
      .select()
      .from(salesOrderItem)
      .where(inArray(salesOrderItem.id, orderItemIds));
    const orderItemMap = new Map<string, typeof salesOrderItem.$inferSelect>();
    for (const oi of orderItemRows) {
      if (oi.orderId === dto.orderId) {
        orderItemMap.set(oi.id, oi);
      }
    }

    // 取SKU成本价
    const skuIds = orderItemRows.map((oi) => oi.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    let totalAmount = 0;
    let costTotalAmount = 0;
    const outboundItems: {
      orderItemId: string;
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      costPrice: string;
      amount: string;
      costAmount: string;
      batchNo: string | null;
    }[] = [];

    for (const item of dto.items) {
      const orderItem = orderItemMap.get(item.orderItemId);
      if (!orderItem) {
        throw new BadRequestException(`订单明细不存在: ${item.orderItemId}`);
      }
      const qty = Number(item.quantity);
      const orderedQty = Number(orderItem.quantity);
      const deliveredQty = Number(orderItem.deliveredQty);
      if (qty <= 0) {
        throw new BadRequestException('出库数量必须大于0');
      }
      // 校验：出库数量不能超过订单未出库数量
      if (qty > orderedQty - deliveredQty) {
        throw new BadRequestException(
          `出库数量超过未出库数量：SKU ${orderItem.skuCode}，最大可出库 ${(orderedQty - deliveredQty).toFixed(3)}`,
        );
      }
      const price = Number(orderItem.price);
      const amt = qty * price;
      totalAmount += amt;

      const skuItem = skuMap.get(orderItem.skuId);
      const costPrice = skuItem ? Number(skuItem.costPrice) : 0;
      const costAmt = qty * costPrice;
      costTotalAmount += costAmt;

      outboundItems.push({
        orderItemId: orderItem.id,
        skuId: orderItem.skuId,
        skuCode: orderItem.skuCode,
        styleNo: orderItem.styleNo,
        color: orderItem.color,
        size: orderItem.size,
        quantity: round3(qty),
        price: round4(price),
        costPrice: round4(costPrice),
        amount: round2(amt),
        costAmount: round2(costAmt),
        batchNo: item.batchNo ?? null,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const outboundNo = await this.generateOutboundNo(tx, dto.outboundDate);

      const inserted = await tx
        .insert(salesOutbound)
        .values({
          outboundNo,
          orderId: order.id,
          orderNo: order.orderNo,
          customerId: order.customerId,
          customerName: order.customerName,
          warehouseId: wh.id,
          warehouseName: wh.name,
          outboundDate: dto.outboundDate,
          totalAmount: round2(totalAmount),
          costAmount: round2(costTotalAmount),
          status: SalesOutboundStatus.DRAFT,
          remark: dto.remark ?? null,
        })
        .returning();

      const outboundId = inserted[0].id;
      await tx.insert(salesOutboundItem).values(
        outboundItems.map((item) => ({
          ...item,
          outboundId,
        })),
      );

      return inserted[0];
    });

    return this.getDetail(created.id);
  }

  async audit(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesOutbound)
      .where(eq(salesOutbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售出库单不存在');
    }
    if (rows[0].status !== SalesOutboundStatus.DRAFT) {
      throw new BadRequestException('只有草稿状态的出库单才能审核');
    }
    await this.db
      .update(salesOutbound)
      .set({ status: SalesOutboundStatus.AUDITED, updatedAt: new Date() })
      .where(eq(salesOutbound.id, id));
  }

  async cancelAudit(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesOutbound)
      .where(eq(salesOutbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售出库单不存在');
    }
    if (rows[0].status !== SalesOutboundStatus.AUDITED) {
      throw new BadRequestException('只有已审核状态的出库单才能取消审核');
    }
    await this.db
      .update(salesOutbound)
      .set({ status: SalesOutboundStatus.DRAFT, updatedAt: new Date() })
      .where(eq(salesOutbound.id, id));
  }

  async book(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesOutbound)
      .where(eq(salesOutbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售出库单不存在');
    }
    if (rows[0].status !== SalesOutboundStatus.AUDITED) {
      throw new BadRequestException('只有已审核状态的出库单才能记账');
    }
    const outbound = rows[0];

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(outbound.outboundDate);

    const itemRows = await this.db
      .select()
      .from(salesOutboundItem)
      .where(eq(salesOutboundItem.outboundId, id));

    await this.db.transaction(async (tx) => {
      // 1. 更新出库单状态为已记账（真正生效）
      await tx
        .update(salesOutbound)
        .set({ status: SalesOutboundStatus.BOOKED, updatedAt: new Date() })
        .where(eq(salesOutbound.id, id));

      // 2. 批量更新销售订单明细的 deliveredQty
      const orderItemUpdates = itemRows.map((item) => {
        const qty = Number(item.quantity);
        return sql`WHEN ${salesOrderItem.id} = ${item.orderItemId} THEN ${salesOrderItem.deliveredQty} + ${round3(qty)}::numeric`;
      });
      const orderItemIds = itemRows.map((item) => item.orderItemId);
      await tx
        .update(salesOrderItem)
        .set({
          deliveredQty: sql`CASE ${sql.join(orderItemUpdates, sql` `)} ELSE ${salesOrderItem.deliveredQty} END`,
          updatedAt: new Date(),
        })
        .where(inArray(salesOrderItem.id, orderItemIds));

      // 3. 扣减成品库存 + 生成库存流水
      const stockChanges = itemRows.map((item) => ({
        warehouseId: outbound.warehouseId,
        warehouseName: outbound.warehouseName,
        skuId: item.skuId,
        itemType: 'sku' as const,
        qtyDelta: -Number(item.quantity),
        flowType: 'sales_outbound',
        bizNo: outbound.outboundNo,
        batchNo: item.batchNo ?? undefined,
        unitPrice: item.price,
        skuCode: item.skuCode,
        styleNo: item.styleNo,
        color: item.color,
        size: item.size,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);
      const receivableNo = generateReceivableNo(outbound.outboundNo);
      await tx.insert(receivable).values({
        receivableNo,
        customerId: outbound.customerId,
        customerName: outbound.customerName,
        bizType: 'sales_outbound',
        bizNo: outbound.outboundNo,
        amount: outbound.totalAmount,
        receivedAmount: '0',
        balance: outbound.totalAmount,
        status: 'unpaid',
        remark: `销售出库 ${outbound.outboundNo}`,
      });
    });
  }

  async accept(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesOutbound)
      .where(eq(salesOutbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售出库单不存在');
    }
    if (rows[0].status !== SalesOutboundStatus.BOOKED) {
      throw new BadRequestException('只有已记账状态的出库单才能验收');
    }
    await this.db
      .update(salesOutbound)
      .set({ status: SalesOutboundStatus.ACCEPTED, updatedAt: new Date() })
      .where(eq(salesOutbound.id, id));
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, salesOutbound, id, {
      draftValue: SalesOutboundStatus.DRAFT,
      notFoundMsg: "销售出库单不存在",
      guardMsg: "只能删除草稿状态的出库单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(salesOutbound)
      .where(and(eq(salesOutbound.id, id), isNull(salesOutbound.deletedAt)));
    if (rows.length === 0) {
      throw new NotFoundException('销售出库单不存在');
    }
    if (rows[0].status !== SalesOutboundStatus.DRAFT) {
      throw new BadRequestException('只能删除草稿状态的出库单');
    }
    // 软删除：仅置位 _deleted_at，不物理删除
    await this.db
      .update(salesOutbound)
      .set({ deletedAt: new Date() })
      .where(eq(salesOutbound.id, id));
  }
}
