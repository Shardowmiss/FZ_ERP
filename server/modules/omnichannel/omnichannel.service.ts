import { fromCents, toCents } from '@server/database/money';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import { MemberWalletUpstreamService, walletEventKey } from '../members/member-wallet-upstream.service';
import {
  posOmnichannelOrder,
  posOmnichannelItem,
  posStock,
  posSaleOrder,
  posSaleItem,
  posSalePayment,
  posMember,
  posPointsLog,
} from '@server/database/schema';
import { eq, and, count, desc, sql, gte, lte } from 'drizzle-orm';
import type {
  OmnichannelOrder,
  OmnichannelQuery,
  ListResponse,
} from '@shared/api.interface';

@Injectable()
export class OmnichannelService {
  private readonly logger = new Logger(OmnichannelService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    // S3：全渠道履约产生的积分也要进同一张上行 outbox
    private readonly walletUpstream: MemberWalletUpstreamService,
    ) {
    this.db = scopeDatabase(this.db);
  }

  async getOrders(query: OmnichannelQuery): Promise<ListResponse<OmnichannelOrder>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    // 前端枚举 → 数据库枚举映射
    const typeMap: Record<string, string> = {
      ship: 'ship_to_store',
      pickup: 'store_pickup',
    };
    const statusMap: Record<string, string> = {
      pending_ship: 'pending',
      ready: 'ready_for_pickup',
      pending_pickup: 'ready_for_pickup',
    };
    const dbType = query.type ? (typeMap[query.type] ?? query.type) : undefined;
    const dbStatus = query.status ? (statusMap[query.status] ?? query.status) : undefined;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posOmnichannelOrder.storeId, query.storeId));
    if (dbStatus) conditions.push(eq(posOmnichannelOrder.status, dbStatus));
    if (dbType) conditions.push(eq(posOmnichannelOrder.type, dbType));
    if (query.channel) conditions.push(eq(posOmnichannelOrder.channel, query.channel));
    if (query.keyword) {
      conditions.push(
        sql`(${posOmnichannelOrder.orderNo} || ' ' || COALESCE(${posOmnichannelOrder.memberName}, '') || ' ' || COALESCE(${posOmnichannelOrder.memberPhone}, '')) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posOmnichannelOrder)
        .where(whereClause),
      this.db
        .select()
        .from(posOmnichannelOrder)
        .where(whereClause)
        .orderBy(desc(posOmnichannelOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapOrder(row)),
      total,
      page,
      pageSize,
    };
  }

  async getOrderDetail(id: string): Promise<OmnichannelOrder> {
    const rows = await this.db
      .select()
      .from(posOmnichannelOrder)
      .where(eq(posOmnichannelOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('全渠道订单不存在');
    }

    const items = await this.db
      .select()
      .from(posOmnichannelItem)
      .where(eq(posOmnichannelItem.orderId, id));

    return {
      ...this.mapOrder(rows[0]),
      items: items.map((it) => ({
        id: it.id,
        orderId: it.orderId,
        skuId: it.skuId,
        styleId: it.styleId,
        styleName: it.styleName,
        colorId: it.colorId,
        sizeId: it.sizeId,
        qty: it.qty,
        price: fromCents(Number(it.price)),
      })),
    };
  }

  async shipOrder(
    id: string,
    logisticsCompany?: string,
    trackingNo?: string,
  ): Promise<OmnichannelOrder> {
    const rows = await this.db
      .select()
      .from(posOmnichannelOrder)
      .where(eq(posOmnichannelOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    if (rows[0].status !== 'pending' && rows[0].status !== 'paid') {
      throw new BadRequestException('该订单状态不支持发货');
    }

    const order = rows[0];
    const items = await this.db
      .select()
      .from(posOmnichannelItem)
      .where(eq(posOmnichannelItem.orderId, id));

    await this.db.transaction(async (tx) => {
      // P1-2：发货也扣库存（统一口径——ship 与 pickup 均在「门店履约完成」时扣库存；
      // 此前 ship 仅置 shipped、不扣库存，造成全渠道发货虚增可用库存）
      for (const item of items) {
        const stockRows = await tx
          .select()
          .from(posStock)
          .where(
            and(
              eq(posStock.storeId, order.storeId),
              eq(posStock.skuId, item.skuId),
            ),
          );
        if (stockRows.length > 0) {
          const updated = await tx
            .update(posStock)
            .set({ qty: sql<number>`${posStock.qty} - ${item.qty}` })
            .where(
              and(
                eq(posStock.id, stockRows[0].id),
                sql`${posStock.qty} >= ${item.qty}`,
              ),
            )
            .returning({ id: posStock.id });
          if (updated.length === 0) {
            throw new ConflictException(
              `商品 ${item.styleName} (${item.colorId}/${item.sizeId}) 库存不足，无法发货`,
            );
          }
        }
      }

      // P1-2：生成销售单 + 计会员积分（财务闭环，自动纳入班次 EOD）
      await this.fulfillAsSaleOrder(tx, id);

      // 置发货状态
      await tx
        .update(posOmnichannelOrder)
        .set({
          status: 'shipped',
          shippedAt: new Date(),
        })
        .where(eq(posOmnichannelOrder.id, id));
    });

    // 修复：此前的写法是 `const [updated] = await select(...)` 后再 `mapOrder(updated[0])`，
    // 等于把「行」再解构一次取 row['0']，恒为 undefined —— 发货/自提接口永远抛
    // "Cannot read properties of undefined"。数组解构一次已拿到行，直接传入即可。
    const [updated] = await this.db
      .select()
      .from(posOmnichannelOrder)
      .where(eq(posOmnichannelOrder.id, id));
    return this.mapOrder(updated);
  }

  async pickupOrder(id: string, pickupCode: string): Promise<OmnichannelOrder> {
    const rows = await this.db
      .select()
      .from(posOmnichannelOrder)
      .where(eq(posOmnichannelOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    if (rows[0].type !== 'store_pickup') {
      throw new BadRequestException('该订单不是自提订单');
    }
    if (rows[0].status !== 'ready' && rows[0].status !== 'paid') {
      throw new BadRequestException('该订单状态不支持核销');
    }
    if (rows[0].pickupCode !== pickupCode) {
      throw new BadRequestException('核销码不正确');
    }

    const items = await this.db
      .select()
      .from(posOmnichannelItem)
      .where(eq(posOmnichannelItem.orderId, id));

    await this.db.transaction(async (tx) => {
      // 扣减库存
      for (const item of items) {
        const stockRows = await tx
          .select()
          .from(posStock)
          .where(
            and(
              eq(posStock.storeId, rows[0].storeId),
              eq(posStock.skuId, item.skuId),
            ),
          );
        if (stockRows.length > 0) {
          await tx
            .update(posStock)
            .set({ qty: sql<number>`${posStock.qty} - ${item.qty}` })
            .where(eq(posStock.id, stockRows[0].id));
        }
      }

      // P1-2：生成销售单 + 计会员积分（财务闭环，自动纳入班次 EOD）
      await this.fulfillAsSaleOrder(tx, id);

      // 更新订单状态
      await tx
        .update(posOmnichannelOrder)
        .set({
          status: 'completed',
          pickedAt: new Date(),
        })
        .where(eq(posOmnichannelOrder.id, id));
    });

    return this.getOrderDetail(id);
  }

  /**
   * P1-2 全渠道财务闭环核心：把一笔全渠道订单的「门店履约」记账为一笔 POS 销售单。
   *
   * 职责边界：仅做财务记账（销售单 + 明细 + 支付 + 会员积分），**不负责库存扣减**
   * ——库存由各调用方（shipOrder 发货扣 / pickupOrder 核销扣）在调用本方法前已扣减，
   * 双方都在「门店履约完成」动作发生，库存口径统一。
   *
   * 幂等：事务内行锁重查当前行的 saleOrderNo，已生成则直接返回，重复履约/重试不重复记账。
   * 生成的销售单自动被班次 EOD 聚合（EOD 按 storeId+当天+status='completed' 从
   * pos_sale_payment JOIN pos_sale_order 汇总，不依赖 shiftId）。
   */
  private async fulfillAsSaleOrder(
    tx: PostgresJsDatabase,
    orderId: string,
  ): Promise<void> {
    // 行锁重查，保证并发履约的幂等
    const cur = (
      await tx
        .select()
        .from(posOmnichannelOrder)
        .where(eq(posOmnichannelOrder.id, orderId))
        .for('update')
    )[0];
    if (!cur || cur.saleOrderNo) {
      return;
    }

    const items = await tx
      .select()
      .from(posOmnichannelItem)
      .where(eq(posOmnichannelItem.orderId, orderId));

    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);
    const totalAmountCents = Number(cur.totalAmount);
    // 消费 1 元积 1 分（按实付金额；全渠道线上已支付，无积分抵扣）
    const pointsEarned = Math.floor(totalAmountCents / 100);

    // 关联会员：按手机号命中（行锁防并发透支）
    let memberId: string | null = null;
    let member: typeof posMember.$inferSelect | null = null;
    if (cur.memberPhone) {
      const m = await tx
        .select()
        .from(posMember)
        .where(eq(posMember.phone, cur.memberPhone))
        .for('update');
      if (m.length > 0) {
        member = m[0];
        memberId = member.id;
      }
    }

    const saleOrderNo = `OC-${cur.orderNo}`;

    const [saleOrder] = await tx
      .insert(posSaleOrder)
      .values({
        orderNo: saleOrderNo,
        storeId: cur.storeId,
        memberId,
        employeeId: null,
        totalQty,
        totalAmount: totalAmountCents,
        discountAmount: 0,
        payAmount: totalAmountCents,
        pointsUsed: 0,
        pointsEarned,
        status: 'completed',
        channel: 'online',
        shiftId: null,
        remark: `全渠道订单 ${cur.orderNo} (${cur.type})`,
        syncedToErp: false,
        syncStatus: 'pending',
      })
      .returning({ id: posSaleOrder.id });

    const saleItemValues = items.map((it) => ({
      orderId: saleOrder.id,
      skuId: it.skuId,
      styleId: it.styleId,
      styleName: it.styleName,
      colorId: it.colorId,
      sizeId: it.sizeId,
      qty: it.qty,
      tagPrice: Number(it.price),
      unitPrice: Number(it.price),
      discountAmount: 0,
      lineAmount: Number(it.price) * it.qty,
    }));
    if (saleItemValues.length > 0) {
      await tx.insert(posSaleItem).values(saleItemValues);
    }

    // 支付方式标记：线上支付（让 EOD 按 payMethod 聚合计入全渠道销售额）
    await tx.insert(posSalePayment).values({
      orderId: saleOrder.id,
      payMethod: 'online',
      amount: totalAmountCents,
      changeAmount: 0,
      transactionId: cur.sourceNo ?? null,
    });

    // 会员积分
    if (member && memberId) {
      const newPoints = member.points + pointsEarned;
      // 【S3】与 sales / returns 同口径：strict 模式下本地不裁决余额（详见 upstream 服务注释）
      const erpAuthoritative = this.walletUpstream.erpAuthoritative;
      if (erpAuthoritative) {
        await tx
          .update(posMember)
          .set({
            totalSpent: sql`${posMember.totalSpent} + ${totalAmountCents}`,
            totalCount: sql`${posMember.totalCount} + 1`,
            lastPurchaseAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(posMember.id, memberId));
      } else {
        await tx
          .update(posMember)
          .set({
            points: newPoints,
            totalSpent: sql`${posMember.totalSpent} + ${totalAmountCents}`,
            totalCount: sql`${posMember.totalCount} + 1`,
            lastPurchaseAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(posMember.id, memberId));
      }
      if (!erpAuthoritative) {
        await tx.insert(posPointsLog).values({
          memberId,
          change: pointsEarned,
          balance: newPoints,
          type: 'earn',
          sourceNo: saleOrderNo,
          remark: '全渠道消费积分',
        });
      }

      // 【S3】全渠道订单同样要上榜 ERP 会员钱包，否则会员在线上消费拿的积分
      // 只在门店系统里存在，ERP 侧永远看不到 —— 与本轮机判定双轨同源。
      if (this.walletUpstream.enabled && pointsEarned > 0) {
        await this.walletUpstream.enqueue(tx, [
          {
            eventKey: walletEventKey('omnichannel', saleOrderNo, 'points'),
            memberId,
            erpMemberId: member.erpMemberId ?? null,
            kind: 'points',
            changeValue: pointsEarned,
            sourceType: 'omnichannel',
            sourceNo: saleOrderNo,
            storeId: cur.storeId,
          },
        ]);
      }
    }

    // 回写幂等标记 + 履约时间
    await tx
      .update(posOmnichannelOrder)
      .set({
        saleOrderNo,
        fulfilledAt: new Date(),
      })
      .where(eq(posOmnichannelOrder.id, orderId));
  }

  private mapOrder(row: typeof posOmnichannelOrder.$inferSelect): OmnichannelOrder {
    const typeReverseMap: Record<string, string> = {
      ship_to_store: 'ship',
      store_pickup: 'pickup',
    };
    const statusReverseMap: Record<string, string> = {
      ready_for_pickup: 'ready',
    };
    return {
      id: row.id,
      orderNo: row.orderNo,
      channel: row.channel,
      type: typeReverseMap[row.type] ?? row.type,
      storeId: row.storeId,
      memberName: row.memberName ?? undefined,
      memberPhone: row.memberPhone ?? undefined,
      totalAmount: fromCents(row.totalAmount),
      status: statusReverseMap[row.status] ?? row.status,
      address: row.address ?? undefined,
      pickupCode: row.pickupCode ?? undefined,
      pickedAt: row.pickedAt?.toISOString(),
      shippedAt: row.shippedAt?.toISOString(),
      sourceNo: row.sourceNo ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
