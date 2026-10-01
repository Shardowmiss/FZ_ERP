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
import { generateDocNo } from '@server/database/id';
import { round2, fromCents, toCents } from '@server/database/money';
import { auditAction } from '@server/common/audit';
import { maskPhone } from '@server/common/pii';
import { ErpIntegrationService } from '../erp-integration/erp-integration.service';
import { MemberWalletUpstreamService, walletEventKey } from '../members/member-wallet-upstream.service';
import {
  posReturnOrder,
  posReturnItem,
  posSaleOrder,
  posSaleItem,
  posSalePayment,
  posStock,
  posMember,
  posEmployee,
  posShift,
  posPointsLog,
  posStoredLog,
} from '@server/database/schema';
import { eq, and, count, desc, ilike, sql, gte, lte } from 'drizzle-orm';
import type {
  ReturnOrder,
  ReturnOrderQuery,
  ListResponse,
  CreateReturnOrderDto,
  SaleOrder,
} from '@shared/api.interface';

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly erp: ErpIntegrationService,
    // S3：退货产生负向钱包事件，与销售单共用同一张 outbox
    private readonly walletUpstream: MemberWalletUpstreamService,
  ) {
    this.db = scopeDatabase(this.db);
  }

  async findOriginalOrder(orderNo: string, phone?: string): Promise<SaleOrder | null> {
    let query = this.db
      .select()
      .from(posSaleOrder)
      .where(eq(posSaleOrder.orderNo, orderNo));

    const orders = await query;
    if (orders.length === 0) return null;

    const order = orders[0];

    // 验证手机号（如果提供了会员ID）
    if (phone && order.memberId) {
      const memberRows = await this.db
        .select()
        .from(posMember)
        .where(eq(posMember.id, order.memberId));
      if (memberRows.length > 0 && memberRows[0].phone !== phone) {
        throw new BadRequestException('手机号与订单会员不匹配');
      }
    }

    const items = await this.db
      .select()
      .from(posSaleItem)
      .where(eq(posSaleItem.orderId, order.id));

    return {
      id: order.id,
      orderNo: order.orderNo,
      storeId: order.storeId,
      memberId: order.memberId ?? undefined,
      employeeId: order.employeeId ?? undefined,
      totalQty: order.totalQty,
      totalAmount: fromCents(Number(order.totalAmount)),
      discountAmount: fromCents(Number(order.discountAmount)),
      payAmount: fromCents(Number(order.payAmount)),
      pointsUsed: order.pointsUsed,
      pointsEarned: order.pointsEarned,
      status: order.status,
      channel: order.channel,
      saleDate: order.saleDate,
      shiftId: order.shiftId ?? undefined,
      remark: order.remark ?? undefined,
      syncedToErp: order.syncedToErp,
      syncStatus: order.syncStatus,
      syncAt: order.syncAt?.toISOString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: items.map((it) => ({
        id: it.id,
        orderId: it.orderId,
        skuId: it.skuId,
        styleId: it.styleId,
        styleName: it.styleName,
        colorId: it.colorId,
        sizeId: it.sizeId,
        qty: it.qty,
        tagPrice: fromCents(Number(it.tagPrice)),
        unitPrice: fromCents(Number(it.unitPrice)),
        discountAmount: fromCents(Number(it.discountAmount)),
        lineAmount: fromCents(Number(it.lineAmount)),
        refundedQty: it.refundedQty,
      })),
    };
  }

  /**
   * F-5：解析并校验退货单所属班次。
   * 班次必须存在且属于同店；若班次已结（离线单可能滞后同步）仅告警，不阻断。
   */
  private async resolveShiftId(
    shiftId: string,
    storeId: string,
  ): Promise<string> {
    const rows = await this.db
      .select()
      .from(posShift)
      .where(eq(posShift.id, shiftId));
    const shift = rows[0];
    if (!shift) {
      throw new BadRequestException(`班次 ${shiftId} 不存在`);
    }
    if (shift.storeId !== storeId) {
      throw new BadRequestException('班次与门店不匹配，禁止跨店归属');
    }
    if (shift.status !== 'open') {
      this.logger.warn(
        `退货单归属到已结班班次 ${shiftId}，请人工核对是否漏记长短款`,
      );
    }
    return shiftId;
  }

  /**
   * 将退货单据异步推送到 ERP 接收端（server-to-server）。
   * 失败由 ErpIntegrationService.pushUpstream 记 posSyncLog(failed) 并可重试；fire-and-forget 不阻断本地业务。
   */
  private pushReturnsUpstream(ret: ReturnOrder): Promise<void> {
    const payload = {
      storeId: ret.storeId,
      returnNo: ret.returnNo,
      originalOrderNo: ret.originalOrderNo,
      refundAmount: ret.refundAmount,
      remark: ret.remark,
      items: (ret.items ?? []).map((it) => ({
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        qty: it.qty,
        // 退货明细金额在 getReturnDetail 中已 fromCents（元），直接透传
        refundPrice: it.refundPrice,
        lineAmount: it.lineAmount,
      })),
    };
    return this.erp.pushUpstream('returns', ret.returnNo, payload);
  }

  async createReturn(dto: CreateReturnOrderDto): Promise<ReturnOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    // 幂等：如果 clientId 已存在，直接返回已有退货单
    if (dto.clientId) {
      const existing = await this.db
        .select()
        .from(posReturnOrder)
        .where(eq(posReturnOrder.clientId, dto.clientId));
      if (existing.length > 0) {
        return this.getReturnDetail(existing[0].id);
      }
    }

    // ============ F-3：校验原单状态与跨店退货 ============
    const originRows = await this.db
      .select()
      .from(posSaleOrder)
      .where(eq(posSaleOrder.orderNo, dto.originalOrderNo));
    const origin = originRows[0];
    if (!origin) {
      throw new NotFoundException(`原单 ${dto.originalOrderNo} 不存在`);
    }
    if (origin.status !== 'completed') {
      throw new BadRequestException(`原单状态为 ${origin.status}，不可退货`);
    }
    if (origin.storeId !== dto.storeId) {
      throw new BadRequestException('退货门店与原单门店不一致，禁止跨店退货');
    }

    // 该原单历史累计已退金额（用于阶梯退款的超额闸门）
    const returnedRows = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${posReturnOrder.refundAmount}), 0)`,
      })
      .from(posReturnOrder)
      .where(
        and(
          eq(posReturnOrder.originalOrderNo, dto.originalOrderNo),
          sql`COALESCE(${posReturnOrder.status}, '') <> 'cancelled'`,
        ),
      );
    const alreadyRefunded = fromCents(Number(returnedRows[0]?.total ?? 0));
    const originPayable = fromCents(Number(origin.payAmount));
    const refundable = Math.round((originPayable - alreadyRefunded) * 100) / 100;

    // ============ F-5：班次归属校验 ============
    const validatedShiftId = dto.shiftId
      ? await this.resolveShiftId(dto.shiftId, origin.storeId)
      : undefined;

    const returnNo = generateDocNo('RT');
    let totalQty = 0;
    let refundAmount = 0;
    let pointsRevert = 0;
    let storedRefund = 0;

    let returnId = '';

    await this.db.transaction(async (tx) => {
      const [result] = await tx
        .insert(posReturnOrder)
        .values({
          returnNo,
          originalOrderNo: dto.originalOrderNo,
          storeId: origin.storeId,
          memberId: dto.memberId ?? origin.memberId,
          employeeId: dto.employeeId,
          totalQty: 0,
          refundAmount: 0,
          refundMethod: dto.refundMethod,
          status: 'completed',
          // F-5：使用经过校验的班次
          shiftId: validatedShiftId,
          remark: dto.remark,
          clientId: dto.clientId,
        })
        .returning({ id: posReturnOrder.id });
      returnId = result.id;

      // P1-5：退货明细收集后统一批量 insert，避免事务内 N+1 写尖峰
      const returnItemValues: Array<{
        returnId: string;
        originalItemId: string;
        skuId: string;
        styleId: string;
        styleName: string;
        colorId: string;
        sizeId: string;
        qty: number;
        refundPrice: number;
        lineAmount: number;
      }> = [];

      for (const item of dto.items) {
        // ---- 数量合法性 ----
        if (!Number.isInteger(item.qty) || item.qty <= 0) {
          throw new BadRequestException('退货数量必须为正整数');
        }
        if (!item.originalItemId) {
          throw new BadRequestException('退货明细缺少原单明细 ID');
        }

        // ---- 行锁 + 归属校验 ----
        const origRows = await tx
          .select()
          .from(posSaleItem)
          .where(eq(posSaleItem.id, item.originalItemId))
          .for('update');
        const orig = origRows[0];
        if (!orig) {
          throw new NotFoundException(`原单明细 ${item.originalItemId} 不存在`);
        }
        if (orig.orderId !== origin.id) {
          throw new BadRequestException('退货明细不属于该原单');
        }

        // ---- 可退余量闸门（杜绝同一行重复无限退） ----
        const remain = orig.qty - (orig.refundedQty ?? 0);
        if (item.qty > remain) {
          throw new BadRequestException(
            `明细「${orig.styleName}」最多可退 ${remain} 件，本次申请 ${item.qty} 件`,
          );
        }

        // ---- 服务端重算退款金额，不采信客户端 lineAmount ----
        const unitPaid = orig.qty > 0 ? fromCents(Number(orig.lineAmount)) / orig.qty : 0;
        const lineAmount = Math.round(unitPaid * item.qty * 100) / 100;
        item.refundPrice = Math.round(unitPaid * 100) / 100;
        item.lineAmount = lineAmount;
        totalQty += item.qty;
        refundAmount = Math.round((refundAmount + lineAmount) * 100) / 100;

        returnItemValues.push({
          returnId: result.id,
          originalItemId: item.originalItemId,
          skuId: item.skuId,
          styleId: item.styleId,
          styleName: item.styleName,
          colorId: item.colorId,
          sizeId: item.sizeId,
          qty: item.qty,
          refundPrice: toCents(item.refundPrice),
          lineAmount: toCents(lineAmount),
        });

        // 更新销售明细的已退数量
        await tx
          .update(posSaleItem)
          .set({ refundedQty: sql`${posSaleItem.refundedQty} + ${item.qty}` })
          .where(eq(posSaleItem.id, item.originalItemId));

        // ---- 库存回补：只更新既有库存记录，禁止凭空新建 ----
        const stockRows = await tx
          .select()
          .from(posStock)
          .where(
            and(
              eq(posStock.storeId, origin.storeId),
              eq(posStock.skuId, item.skuId),
            ),
          );
        if (stockRows.length === 0) {
          throw new ConflictException(
            `商品 ${item.styleName} 在本店无库存记录，无法回补库存（请核对 SKU 是否属于本店）`,
          );
        }
        await tx
          .update(posStock)
          .set({ qty: sql<number>`${posStock.qty} + ${item.qty}` })
          .where(eq(posStock.id, stockRows[0].id));
      }

      // P1-5：退货明细循环收集后单次批量 insert（事务内，失败整体回滚）
      if (returnItemValues.length > 0) {
        await tx.insert(posReturnItem).values(returnItemValues);
      }

      // ---- 整单退款上限闸门 ----
      if (refundAmount > refundable + 0.01) {
        throw new BadRequestException(
          `退款金额超限：该单剩余可退 ¥${refundable.toFixed(2)}，本次申请 ¥${refundAmount.toFixed(2)}`,
        );
      }

      // 写回合计
      await tx
        .update(posReturnOrder)
        .set({
          totalQty,
          refundAmount: toCents(round2(refundAmount)),
        })
        .where(eq(posReturnOrder.id, result.id));

      // ============ F-4：按退款比例回退会员积分与储值 ============
      const memberId = dto.memberId ?? origin.memberId;
      if (memberId) {
        const ratio = originPayable > 0 ? refundAmount / originPayable : 0;

        const paymentRows = await tx
          .select()
          .from(posSalePayment)
          .where(eq(posSalePayment.orderId, origin.id));
        const storedPaid = paymentRows
          .filter((p) => p.payMethod === 'stored_value')
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        pointsRevert = Math.floor((Number(origin.pointsEarned) || 0) * ratio);
        storedRefund =
          dto.refundMethod === 'original' || dto.refundMethod === 'stored_value'
            ? Math.round(storedPaid * ratio * 100) / 100
            : 0;

        const memberRows = await tx
          .select()
          .from(posMember)
          .where(eq(posMember.id, memberId));
        const member = memberRows[0];
        if (member) {
          pointsRevert = Math.min(pointsRevert, member.points);
          storedRefund = Math.min(storedRefund, fromCents(member.storedValue));

          // 【S3】两种模式的分野（详见 member-wallet-upstream.service.ts 头部说明）：
          // shadow —— 本地照旧改余额并存流水（零行为变化），同时上报；
          // strict —— 本地不再裁决资金列，积分回冲与储值退回都由 ERP 入账。
          const erpAuthoritative = this.walletUpstream.erpAuthoritative;

          if (erpAuthoritative) {
            await tx
              .update(posMember)
              .set({
                totalSpent: sql`GREATEST(0, ${posMember.totalSpent} - ${toCents(refundAmount)}::numeric)`,
              })
              .where(eq(posMember.id, memberId));
          } else {
            await tx
              .update(posMember)
              .set({
                totalSpent: sql`GREATEST(0, ${posMember.totalSpent} - ${toCents(refundAmount)}::numeric)`,
                points: sql`GREATEST(0, ${posMember.points} - ${pointsRevert})`,
                storedValue: sql`GREATEST(0, ${posMember.storedValue} + ${toCents(storedRefund)}::numeric)`,
              })
              .where(eq(posMember.id, memberId));
          }

          if (pointsRevert > 0 && !erpAuthoritative) {
            await tx.insert(posPointsLog).values({
              memberId,
              change: -pointsRevert,
              balance: Math.max(0, member.points - pointsRevert),
              type: 'return_revert',
              sourceNo: returnNo,
              remark: `退货单 ${returnNo} 按比例回冲本次消费所获积分`,
            });
          }
          if (storedRefund > 0 && !erpAuthoritative) {
            await tx.insert(posStoredLog).values({
              memberId,
              change: toCents(storedRefund),
              balance: toCents(
                Math.max(0, fromCents(member.storedValue) + storedRefund),
              ),
              type: 'return_refund',
              sourceNo: returnNo,
              remark: `退货单 ${returnNo} 储值按原支付方式退回`,
            });
          }

          // 【S3】回报 ERP：退货是**负向**钱包变动，必须与销售单同一套口径上报，
          // 否则门店退了货而 ERP 会员积分没回冲，会员端会「只涨不跌」。
          if (this.walletUpstream.enabled) {
            const walletEvents: Array<Parameters<MemberWalletUpstreamService['enqueue']>[1][number]> = [];
            if (pointsRevert > 0) {
              walletEvents.push({
                eventKey: walletEventKey('return', returnNo, 'points'),
                memberId,
                erpMemberId: member.erpMemberId ?? null,
                kind: 'points',
                changeValue: -pointsRevert,
                sourceType: 'return',
                sourceNo: returnNo,
                storeId: origin.storeId,
              });
            }
            if (storedRefund > 0) {
              walletEvents.push({
                eventKey: walletEventKey('return', returnNo, 'stored_value'),
                memberId,
                erpMemberId: member.erpMemberId ?? null,
                kind: 'stored_value',
                changeValue: toCents(storedRefund),
                sourceType: 'return',
                sourceNo: returnNo,
                storeId: origin.storeId,
              });
            }
            if (walletEvents.length > 0) {
              await this.walletUpstream.enqueue(tx, walletEvents);
            }
          }
        }
      }

      // P0-2：退货单创建审计（与退货同事务，失败仅告警不回滚主流程）
      await auditAction(tx, {
        storeId: origin.storeId,
        employeeId: dto.employeeId ?? null,
        module: 'returns',
        action: 'create',
        targetNo: returnNo,
        content: {
          returnNo,
          originalOrderNo: dto.originalOrderNo,
          storeId: origin.storeId,
          refundAmount: round2(refundAmount),
          refundMethod: dto.refundMethod,
        },
      });
    });

    const ret = await this.getReturnDetail(returnId);
    // 上行 ERP：退货完成后异步推送（不阻断本地业务；失败由 ErpIntegrationService 记 posSyncLog 并可重试）
    this.pushReturnsUpstream(ret).catch(() => {});
    // S3：钱包事件已在事务内入队，这里顺手推一把；失败不影响本次退货落单。
    this.walletUpstream.kick();
    return ret;
  }

  async getReturnList(query: ReturnOrderQuery): Promise<ListResponse<ReturnOrder>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posReturnOrder.storeId, query.storeId));
    if (query.status) conditions.push(eq(posReturnOrder.status, query.status));
    if (query.startDate) conditions.push(gte(posReturnOrder.createdAt, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(posReturnOrder.createdAt, new Date(query.endDate)));
    if (query.keyword) {
      conditions.push(
        sql`(${posReturnOrder.returnNo} || ' ' || ${posReturnOrder.originalOrderNo}) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posReturnOrder)
        .where(whereClause),
      this.db
        .select({
          id: posReturnOrder.id,
          returnNo: posReturnOrder.returnNo,
          originalOrderNo: posReturnOrder.originalOrderNo,
          storeId: posReturnOrder.storeId,
          memberId: posReturnOrder.memberId,
          employeeId: posReturnOrder.employeeId,
          totalQty: posReturnOrder.totalQty,
          refundAmount: sql<number>`${posReturnOrder.refundAmount} / 100.0`,
          refundMethod: posReturnOrder.refundMethod,
          status: posReturnOrder.status,
          shiftId: posReturnOrder.shiftId,
          remark: posReturnOrder.remark,
          syncedToErp: posReturnOrder.syncedToErp,
          syncStatus: posReturnOrder.syncStatus,
          syncAt: posReturnOrder.syncAt,
          createdAt: posReturnOrder.createdAt,
          updatedAt: posReturnOrder.updatedAt,
          memberName: posMember.name,
          memberPhone: posMember.phone,
          employeeName: posEmployee.name,
        })
        .from(posReturnOrder)
        .leftJoin(posMember, eq(posReturnOrder.memberId, posMember.id))
        .leftJoin(posEmployee, eq(posReturnOrder.employeeId, posEmployee.id))
        .where(whereClause)
        .orderBy(desc(posReturnOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        returnNo: row.returnNo,
        originalOrderNo: row.originalOrderNo,
        storeId: row.storeId,
        memberId: row.memberId ?? undefined,
        employeeId: row.employeeId ?? undefined,
        totalQty: row.totalQty,
        refundAmount: fromCents(row.refundAmount),
        refundMethod: row.refundMethod,
        status: row.status,
        shiftId: row.shiftId ?? undefined,
        remark: row.remark ?? undefined,
        syncedToErp: row.syncedToErp,
        syncStatus: row.syncStatus,
        syncAt: row.syncAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        memberName: row.memberName ?? undefined,
        // P1-b：会员手机号脱敏返回
        memberPhone: row.memberPhone ? maskPhone(row.memberPhone) : undefined,
        employeeName: row.employeeName ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getReturnDetail(id: string): Promise<ReturnOrder> {
    const rows = await this.db
      .select({
        id: posReturnOrder.id,
        returnNo: posReturnOrder.returnNo,
        originalOrderNo: posReturnOrder.originalOrderNo,
        storeId: posReturnOrder.storeId,
        memberId: posReturnOrder.memberId,
        employeeId: posReturnOrder.employeeId,
        totalQty: posReturnOrder.totalQty,
        refundAmount: sql<number>`${posReturnOrder.refundAmount} / 100.0`,
        refundMethod: posReturnOrder.refundMethod,
        status: posReturnOrder.status,
        shiftId: posReturnOrder.shiftId,
        remark: posReturnOrder.remark,
        syncedToErp: posReturnOrder.syncedToErp,
        syncStatus: posReturnOrder.syncStatus,
        syncAt: posReturnOrder.syncAt,
        createdAt: posReturnOrder.createdAt,
        updatedAt: posReturnOrder.updatedAt,
        memberName: posMember.name,
        memberPhone: posMember.phone,
        employeeName: posEmployee.name,
      })
      .from(posReturnOrder)
      .leftJoin(posMember, eq(posReturnOrder.memberId, posMember.id))
      .leftJoin(posEmployee, eq(posReturnOrder.employeeId, posEmployee.id))
      .where(eq(posReturnOrder.id, id));

    if (rows.length === 0) {
      throw new NotFoundException('退货单不存在');
    }

    const row = rows[0];
    const items = await this.db
      .select()
      .from(posReturnItem)
      .where(eq(posReturnItem.returnId, id));

    return {
      id: row.id,
      returnNo: row.returnNo,
      originalOrderNo: row.originalOrderNo,
      storeId: row.storeId,
      memberId: row.memberId ?? undefined,
      employeeId: row.employeeId ?? undefined,
      totalQty: row.totalQty,
      refundAmount: fromCents(row.refundAmount),
      refundMethod: row.refundMethod,
      status: row.status,
      shiftId: row.shiftId ?? undefined,
      remark: row.remark ?? undefined,
      syncedToErp: row.syncedToErp,
      syncStatus: row.syncStatus,
      syncAt: row.syncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      memberName: row.memberName ?? undefined,
      // P1-b：会员手机号脱敏返回
      memberPhone: row.memberPhone ? maskPhone(row.memberPhone) : undefined,
      employeeName: row.employeeName ?? undefined,
      items: items.map((it) => ({
        id: it.id,
        returnId: it.returnId,
        originalItemId: it.originalItemId,
        skuId: it.skuId,
        styleId: it.styleId,
        styleName: it.styleName,
        colorId: it.colorId,
        sizeId: it.sizeId,
        qty: it.qty,
        refundPrice: fromCents(Number(it.refundPrice)),
        lineAmount: fromCents(Number(it.lineAmount)),
      })),
    };
  }
}
