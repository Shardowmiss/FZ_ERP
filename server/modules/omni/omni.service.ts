import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, desc, and, inArray } from 'drizzle-orm';
import {
  omniOrder,
  omniOrderItem,
  salesChannel,
  inventoryStock,
} from '@server/database/schema';
import { StockService } from '@server/modules/inventory/stock/stock.service';
import { NumberGeneratorService } from '@server/modules/system/code-rule/number-generator.service';
import { round2 } from '../../common/utils/money';
import type {
  SalesChannel,
  OmniOrder,
  OmniOrderItem,
  OmniOrderDetail,
  OmniAllocateResult,
  OmniAllocateItem,
  OmniShipResult,
} from '@shared/api.interface';


@Injectable()
export class OmniService {
  private readonly logger = new Logger(OmniService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  // ===== 渠道 =====
  async listChannels(): Promise<SalesChannel[]> {
    return (await this.db
      .select()
      .from(salesChannel)
      .orderBy(salesChannel.channelCode)) as unknown as SalesChannel[];
  }

  async createChannel(body: Partial<SalesChannel>): Promise<SalesChannel> {
    const [row] = await this.db
      .insert(salesChannel)
      .values({
        channelCode: body.channelCode ?? '',
        name: body.name ?? '',
        platform: body.platform ?? 'other',
        status: body.status ?? 'active',
        remark: body.remark,
      })
      .returning();
    return row as unknown as SalesChannel;
  }

  // ===== 订单 =====
  async listOrders(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    channelId?: string;
  }): Promise<{ list: OmniOrder[]; total: number }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 20));
    const conditions: ReturnType<typeof eq>[] = [];
    if (params.status) conditions.push(eq(omniOrder.status, params.status));
    if (params.channelId) conditions.push(eq(omniOrder.channelId, params.channelId));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(omniOrder)
        .where(where)
        .orderBy(desc(omniOrder.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ c: sql`count(*)` }).from(omniOrder).where(where),
    ]);
    return {
      list: rows as unknown as OmniOrder[],
      total: Number(countRows[0]?.c ?? 0),
    };
  }

  async getOrder(id: string): Promise<OmniOrderDetail> {
    const [o] = await this.db
      .select()
      .from(omniOrder)
      .where(eq(omniOrder.id, id))
      .limit(1);
    if (!o) throw new NotFoundException('订单不存在');
    const items = (await this.db
      .select()
      .from(omniOrderItem)
      .where(eq(omniOrderItem.omniOrderId, id))) as unknown as OmniOrderItem[];
    return { ...(o as unknown as OmniOrder), items };
  }

  async createOrder(body: {
    channelId: string;
    externalNo?: string;
    customerName: string;
    contactPhone?: string;
    address?: string;
    remark?: string;
    items: Array<{
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
    }>;
  }): Promise<OmniOrder> {
    if (!body?.channelId || !body?.items?.length)
      throw new BadRequestException('channelId 与 items 必填');
    const [ch] = await this.db
      .select({ id: salesChannel.id, name: salesChannel.name })
      .from(salesChannel)
      .where(eq(salesChannel.id, body.channelId))
      .limit(1);
    if (!ch) throw new NotFoundException('渠道不存在');
    const totalAmount = round2(
      body.items.reduce((s, it) => s + it.quantity * it.price, 0),
    );

    return this.db.transaction(async (tx) => {
      const orderNo = await this.numberGenerator.generateNextNo(
        tx,
        omniOrder,
        omniOrder.orderNo,
        `OM${new Date().getFullYear()}`,
        5,
      );
      const [o] = await tx
        .insert(omniOrder)
        .values({
          orderNo,
          channelId: body.channelId,
          channelName: (ch as { name: string }).name,
          externalNo: body.externalNo,
          customerName: body.customerName,
          contactPhone: body.contactPhone,
          address: body.address,
          totalAmount: String(totalAmount),
          itemCount: body.items.length,
          status: 'pending',
          shipStatus: 'unshipped',
          remark: body.remark,
        })
        .returning();
      await tx.insert(omniOrderItem).values(
        body.items.map((it) => ({
          omniOrderId: (o as { id: string }).id,
          skuId: it.skuId,
          skuCode: it.skuCode,
          styleNo: it.styleNo,
          color: it.color,
          size: it.size,
          quantity: String(it.quantity),
          price: String(it.price),
          amount: String(round2(it.quantity * it.price)),
        })),
      );
      return o as unknown as OmniOrder;
    });
  }

  // 审单：pending -> approved
  async audit(orderId: string): Promise<{ updated: number }> {
    const r = await this.db
      .update(omniOrder)
      .set({ status: 'approved' })
      .where(and(eq(omniOrder.id, orderId), eq(omniOrder.status, 'pending')))
      .returning();
    return { updated: r.length };
  }

  // 防超卖分配：按 SKU 当前库存分配，记录缺口
  async allocate(orderId: string): Promise<OmniAllocateResult> {
    const items = (await this.db
      .select()
      .from(omniOrderItem)
      .where(eq(omniOrderItem.omniOrderId, orderId))) as unknown as Array<{
      id: string;
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: string;
    }>;
    if (items.length === 0) return { allocated: 0, shortage: 0, items: [] };

    const skuIds = items.map((i) => i.skuId);
    const stockRows = (await this.db.execute(sql`
      SELECT sku_id AS sku_id, COALESCE(SUM(quantity),0) AS q
      FROM inventory_stock WHERE ${inArray(inventoryStock.skuId, skuIds)}
      GROUP BY sku_id
    `)) as unknown as Array<{ sku_id: string; q: string }>;
    const stockMap = new Map<string, number>();
    for (const r of stockRows) stockMap.set(r.sku_id, Number(r.q ?? 0));

    const result: OmniAllocateItem[] = [];
    let totalAllocated = 0;
    let totalShortage = 0;

    await this.db.transaction(async (tx) => {
      for (const it of items) {
        const required = Number(it.quantity);
        const available = stockMap.get(it.skuId) ?? 0;
        const allocated = Math.min(required, available);
        const shortage = required - allocated;
        await tx
          .update(omniOrderItem)
          .set({
            allocatedQty: String(allocated),
            shortageQty: String(shortage),
          })
          .where(eq(omniOrderItem.id, it.id));
        totalAllocated += allocated;
        totalShortage += shortage;
        result.push({
          skuCode: it.skuCode,
          styleNo: it.styleNo,
          color: it.color,
          size: it.size,
          required,
          available,
          allocated,
          shortage,
        });
      }
    });

    return { allocated: totalAllocated, shortage: totalShortage, items: result };
  }

  // 发货：扣减库存（按库存最多仓库），更新发货状态
  async ship(orderId: string): Promise<OmniShipResult> {
    const items = (await this.db
      .select()
      .from(omniOrderItem)
      .where(eq(omniOrderItem.omniOrderId, orderId))) as unknown as Array<{
      id: string;
      skuId: string;
      allocatedQty: string;
    }>;
    let shipped = 0;
    await this.db.transaction(async (tx) => {
      for (const it of items) {
        const qty = Number(it.allocatedQty);
        if (qty <= 0) continue;
        const [wh] = (await tx.execute(sql`
          SELECT warehouse_id AS wid, warehouse_name AS wn, quantity AS q
          FROM inventory_stock WHERE sku_id = ${it.skuId} ORDER BY quantity DESC LIMIT 1
        `)) as unknown as Array<{ wid: string; wn: string; q: string }>;
        if (!wh || Number(wh.q) <= 0) {
          throw new ConflictException(`SKU ${it.skuId} 无可用库存，无法发货`);
        }
        await this.stockService.changeStock(tx, {
          warehouseId: wh.wid,
          warehouseName: wh.wn,
          skuId: it.skuId,
          itemType: 'sku',
          qtyDelta: -qty,
          flowType: 'out',
          bizNo: orderId,
          remark: 'OMS发货',
        });
        shipped += qty;
      }
      await tx
        .update(omniOrder)
        .set({ shipStatus: 'shipped', status: 'completed' })
        .where(eq(omniOrder.id, orderId));
    });
    return { shipped };
  }
}
