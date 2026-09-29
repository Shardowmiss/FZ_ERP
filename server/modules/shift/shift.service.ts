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
import {
  posShift,
  posSaleOrder,
  posSaleItem,
  posSalePayment,
  posReturnOrder,
  posEod,
  posEodPayment,
  posEmployee,
} from '@server/database/schema';
import { eq, and, count, desc, sql, gte, lte, sum } from 'drizzle-orm';
import type {
  Shift,
  ShiftQuery,
  ListResponse,
  OpenShiftDto,
  CloseShiftDto,
  Eod,
  EodQuery,
} from '@shared/api.interface';
import type { AuthPrincipal } from '../auth/auth.service';
import { resolveStoreId, enforceStoreScope } from '@server/common/tenant';
import { ErpIntegrationService } from '../erp-integration/erp-integration.service';

@Injectable()
export class ShiftService {
  private readonly logger = new Logger(ShiftService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly erp: ErpIntegrationService,
  ) {
    this.db = scopeDatabase(this.db);
  }

  async getCurrentShift(storeId: string): Promise<Shift | null> {
    const rows = await this.db
      .select({
        id: posShift.id,
        shiftNo: posShift.shiftNo,
        storeId: posShift.storeId,
        cashierId: posShift.cashierId,
        startTime: posShift.startTime,
        endTime: posShift.endTime,
        openingCash: sql<number>`${posShift.openingCash} / 100.0`,
        closingCash: sql<number>`COALESCE(${posShift.closingCash} / 100.0, 0)`,
        status: posShift.status,
        saleCount: posShift.saleCount,
        saleAmount: sql<number>`${posShift.saleAmount} / 100.0`,
        refundAmount: sql<number>`${posShift.refundAmount} / 100.0`,
        cashExpected: sql<number>`${posShift.cashExpected} / 100.0`,
        cashActual: sql<number>`${posShift.cashActual} / 100.0`,
        cashDiff: sql<number>`${posShift.cashDiff} / 100.0`,
        createdAt: posShift.createdAt,
        updatedAt: posShift.updatedAt,
        cashierName: posEmployee.name,
      })
      .from(posShift)
      .leftJoin(posEmployee, eq(posShift.cashierId, posEmployee.id))
      .where(
        and(eq(posShift.storeId, storeId), eq(posShift.status, 'open')),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return this.mapShift(rows[0]);
  }

  /**
   * ============ S-5 口径说明 ============
   * 应收现金 = 备用金 + 现金实收（已扣找零） − 本班现金退款
   * 现金退款的判断：`refundMethod='cash'` 与 `'original'` 视为从钱箱流出。
   * 'original' 实为按原单支付方式退回，此处作为近似处理；若门店要求精确到
   * 支付方式，应在退货落单时把 refundMethod 归一化为真实通道。
   */
  async openShift(dto: OpenShiftDto, principal?: AuthPrincipal | null): Promise<Shift> {
    const openingCash = Number(dto.openingCash);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      throw new BadRequestException('备用金不能为负');
    }

    // P0-1：开班门店归属服务端权威推导，忽略客户端下发的 dto.storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal, dto.storeId);
    const operatorId = principal?.employeeId ?? null;

    const shiftNo = generateDocNo('SH');

    // S-6：检查与写入必须在同一事务内。
    // 原先先查后插，两个并发请求能同时通过检查开出两个开放班次，
    // 导致订单归属与营业收入统计错乱。
    const result = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: posShift.id })
        .from(posShift)
        .where(
          and(eq(posShift.storeId, storeId), eq(posShift.status, 'open')),
        )
        .for('update');
      if (existing.length > 0) {
        throw new ConflictException('当前门店已有未关闭的班次');
      }
      const [row] = await tx
        .insert(posShift)
        .values({
          shiftNo,
          storeId,
          cashierId: dto.cashierId,
          startTime: new Date(),
          openingCash: toCents(openingCash),
          status: 'open',
        })
        .returning();

      // P0-2：开班审计
      await auditAction(tx, {
        storeId,
        employeeId: operatorId,
        module: 'shift',
        action: 'open',
        targetNo: shiftNo,
        content: { shiftNo, storeId, cashierId: dto.cashierId },
      });
      return row;
    });

    const rows = await this.db
      .select({
        id: posShift.id,
        shiftNo: posShift.shiftNo,
        storeId: posShift.storeId,
        cashierId: posShift.cashierId,
        startTime: posShift.startTime,
        endTime: posShift.endTime,
        openingCash: sql<number>`${posShift.openingCash} / 100.0`,
        closingCash: sql<number>`COALESCE(${posShift.closingCash} / 100.0, 0)`,
        status: posShift.status,
        saleCount: posShift.saleCount,
        saleAmount: sql<number>`${posShift.saleAmount} / 100.0`,
        refundAmount: sql<number>`${posShift.refundAmount} / 100.0`,
        cashExpected: sql<number>`${posShift.cashExpected} / 100.0`,
        cashActual: sql<number>`${posShift.cashActual} / 100.0`,
        cashDiff: sql<number>`${posShift.cashDiff} / 100.0`,
        createdAt: posShift.createdAt,
        updatedAt: posShift.updatedAt,
        cashierName: posEmployee.name,
      })
      .from(posShift)
      .leftJoin(posEmployee, eq(posShift.cashierId, posEmployee.id))
      .where(eq(posShift.id, result.id));

    return this.mapShift(rows[0]);
  }

  /**
   * 将日结（交班）单据异步推送到 ERP 接收端（server-to-server）。
   * paymentStats 为本班支付按渠道汇总（单位：分），此处换算为元并按渠道拆分写入扁平字段；
   * 失败由 ErpIntegrationService.pushUpstream 记 posSyncLog(failed) 并可重试；fire-and-forget 不阻断本地业务。
   */
  private pushEodUpstream(
    row: { storeId: string; shiftNo: string; cashierName?: string | null; saleAmount: number; refundAmount: number },
    paymentStats: Array<{ payMethod: string; amount: number }>,
  ): Promise<void> {
    const byMethod = (m: string) =>
      fromCents(paymentStats.find((p) => p.payMethod === m)?.amount ?? 0);
    const cash = byMethod('cash');
    const card = byMethod('card');
    const wechat = byMethod('wechat');
    const alipay = byMethod('alipay');
    const other = paymentStats
      .filter((p) => !['cash', 'card', 'wechat', 'alipay'].includes(p.payMethod))
      .reduce((s, p) => s + fromCents(p.amount), 0);
    const netSales = round2((Number(row.saleAmount) || 0) - (Number(row.refundAmount) || 0));
    const payload = {
      storeId: row.storeId,
      eodNo: row.shiftNo,
      eodDate: new Date().toISOString().slice(0, 10),
      cashAmount: cash,
      cardAmount: card,
      wechatAmount: wechat,
      alipayAmount: alipay,
      otherAmount: round2(other),
      totalAmount: netSales,
      cashierName: row.cashierName ?? undefined,
    };
    return this.erp.pushUpstream('eod', row.shiftNo, payload);
  }

  async closeShift(id: string, dto: CloseShiftDto, operatorId?: string | null): Promise<Shift> {
    // paymentStats 需跨事务作用域，供事务提交后异步推送 ERP 使用
    let paymentStats: Array<{ payMethod: string; amount: number }> = [];
    const updatedId = await this.db.transaction(async (tx) => {
      // S-6：行锁 + 状态复核。原先「先查状态、事后更新」非原子，
      // 两个并发请求能各算一次并互相覆盖统计结果。
      const rows = await tx
        .select()
        .from(posShift)
        .where(eq(posShift.id, id))
        .for('update');
      if (rows.length === 0) {
        throw new NotFoundException('班次不存在');
      }
      if (rows[0].status !== 'open') {
        throw new BadRequestException('该班次已关闭');
      }

      // 统计本班销售
      const [saleStats, refundStats, ps] = await Promise.all([
        tx
          .select({
            count: count(),
            totalAmount: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}), 0)`,
          })
          .from(posSaleOrder)
          .where(eq(posSaleOrder.shiftId, id)),
        tx
          .select({
            totalRefund: sql<number>`COALESCE(SUM(CASE
              WHEN ${posReturnOrder.refundMethod} = 'cash' THEN ${posReturnOrder.refundAmount}
              WHEN ${posReturnOrder.refundMethod} = 'original' THEN ${posReturnOrder.refundAmount}
              ELSE 0 END), 0)`,
          })
          .from(posReturnOrder)
          .where(eq(posReturnOrder.shiftId, id)),
        // S-5：实收 = 收取金额 − 找零。原先只 SUM(amount)，每笔找零都会虚增应收，
        // 造成系统性的「假短款」。
        tx
          .select({
            payMethod: posSalePayment.payMethod,
            amount: sql<number>`COALESCE(SUM(${posSalePayment.amount}) - SUM(COALESCE(${posSalePayment.changeAmount}, 0)), 0)`,
          })
          .from(posSalePayment)
          .innerJoin(posSaleOrder, eq(posSalePayment.orderId, posSaleOrder.id))
          .where(eq(posSaleOrder.shiftId, id))
          .groupBy(posSalePayment.payMethod),
      ]);

      paymentStats = ps;

      const saleCount = Number(saleStats[0]?.count ?? 0);
      const saleAmount = Number(saleStats[0]?.totalAmount ?? 0);
      // 已剔除微信/支付宝等非现金退款；'original' 视作原路现金退回（近似，见方法注释）
      const refundAmount = Number(refundStats[0]?.totalRefund ?? 0);
      const cashPayment = Number(
        paymentStats.find((p) => p.payMethod === 'cash')?.amount ?? 0,
      );
      const cashExpected =
        Number(rows[0].openingCash) + cashPayment - refundAmount;
      const cashDiff = dto.cashActual - cashExpected;

      const [updated] = await tx
        .update(posShift)
        .set({
          status: 'closed',
          endTime: new Date(),
          closingCash: toCents(dto.closingCash),
          saleCount,
          saleAmount: toCents(round2(saleAmount)),
          refundAmount: toCents(round2(refundAmount)),
          cashExpected: toCents(round2(cashExpected)),
          cashActual: toCents(dto.cashActual),
          cashDiff: toCents(round2(cashDiff)),
        })
        // 条件更新：只有仍为 open 才能结班，防止重复交班
        .where(and(eq(posShift.id, id), eq(posShift.status, 'open')))
        .returning();

      if (!updated) {
        throw new ConflictException('班次状态已变更，请刷新后重试');
      }

      // P0-2：交班审计
      await auditAction(tx, {
        storeId: rows[0].storeId,
        employeeId: operatorId ?? null,
        module: 'shift',
        action: 'close',
        targetNo: rows[0].shiftNo,
        content: {
          shiftNo: rows[0].shiftNo,
          storeId: rows[0].storeId,
          saleCount,
          saleAmount: round2(saleAmount),
          cashDiff: round2(cashDiff),
        },
      });
      return updated.id;
    });

    // 事务提交后重新取带收银员姓名的完整班次
    const rows = await this.db
      .select({
        id: posShift.id,
        shiftNo: posShift.shiftNo,
        storeId: posShift.storeId,
        cashierId: posShift.cashierId,
        startTime: posShift.startTime,
        endTime: posShift.endTime,
        openingCash: sql<number>`${posShift.openingCash} / 100.0`,
        closingCash: sql<number>`COALESCE(${posShift.closingCash} / 100.0, 0)`,
        status: posShift.status,
        saleCount: posShift.saleCount,
        saleAmount: sql<number>`${posShift.saleAmount} / 100.0`,
        refundAmount: sql<number>`${posShift.refundAmount} / 100.0`,
        cashExpected: sql<number>`${posShift.cashExpected} / 100.0`,
        cashActual: sql<number>`${posShift.cashActual} / 100.0`,
        cashDiff: sql<number>`${posShift.cashDiff} / 100.0`,
        createdAt: posShift.createdAt,
        updatedAt: posShift.updatedAt,
        cashierName: posEmployee.name,
      })
      .from(posShift)
      .leftJoin(posEmployee, eq(posShift.cashierId, posEmployee.id))
      .where(eq(posShift.id, updatedId));

    const shift = this.mapShift(rows[0]);
    // 上行 ERP：交班日结后异步推送（不阻断本地业务；失败由 ErpIntegrationService 记 posSyncLog 并可重试）
    this.pushEodUpstream(rows[0], paymentStats).catch((e) =>
      this.logger.warn(`[上行ERP] 日结 ${rows[0].shiftNo} 推送失败: ${String(e)}`),
    );
    return shift;
  }

  async getShiftHistory(query: ShiftQuery): Promise<ListResponse<Shift>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posShift.storeId, query.storeId));
    if (query.status) conditions.push(eq(posShift.status, query.status));
    if (query.startDate) conditions.push(gte(posShift.startTime, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(posShift.startTime, new Date(query.endDate)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, shiftRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posShift)
        .where(whereClause),
      this.db
        .select({
          id: posShift.id,
          shiftNo: posShift.shiftNo,
          storeId: posShift.storeId,
          cashierId: posShift.cashierId,
          startTime: posShift.startTime,
          endTime: posShift.endTime,
          openingCash: sql<number>`${posShift.openingCash} / 100.0`,
          closingCash: sql<number>`COALESCE(${posShift.closingCash} / 100.0, 0)`,
          status: posShift.status,
          saleCount: posShift.saleCount,
          saleAmount: sql<number>`${posShift.saleAmount} / 100.0`,
          refundAmount: sql<number>`${posShift.refundAmount} / 100.0`,
          cashExpected: sql<number>`${posShift.cashExpected} / 100.0`,
          cashActual: sql<number>`${posShift.cashActual} / 100.0`,
          cashDiff: sql<number>`${posShift.cashDiff} / 100.0`,
          createdAt: posShift.createdAt,
          updatedAt: posShift.updatedAt,
          cashierName: posEmployee.name,
        })
        .from(posShift)
        .leftJoin(posEmployee, eq(posShift.cashierId, posEmployee.id))
        .where(whereClause)
        .orderBy(desc(posShift.startTime))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: shiftRows.map((row) => this.mapShift(row)),
      total,
      page,
      pageSize,
    };
  }

  // ============ 日结 ============
  async getEodList(query: EodQuery): Promise<ListResponse<Eod>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posEod.storeId, query.storeId));
    if (query.status) conditions.push(eq(posEod.status, query.status));
    if (query.startDate) conditions.push(gte(posEod.eodDate, query.startDate));
    if (query.endDate) conditions.push(lte(posEod.eodDate, query.endDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posEod)
        .where(whereClause),
      this.db
        .select()
        .from(posEod)
        .where(whereClause)
        .orderBy(desc(posEod.eodDate))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapEod(row)),
      total,
      page,
      pageSize,
    };
  }

  async executeEod(
    principal: AuthPrincipal | null | undefined,
    eodDate: string,
  ): Promise<Eod> {
    // P0-1：日结门店归属服务端权威推导，忽略客户端下发的 storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal);
    const operatorId = principal?.employeeId ?? null;
    // S-7：日期合法性与上界校验，杜绝对未来日期做日结生成虚假报表
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eodDate)) {
      throw new BadRequestException('日结日期格式应为 YYYY-MM-DD');
    }
    const now = new Date();
    const todayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    if (eodDate > todayStr) {
      throw new BadRequestException(
        `日结日期 ${eodDate} 不能晚于今天（${todayStr}）`,
      );
    }

    // 检查当天是否已日结
    const existing = await this.db
      .select()
      .from(posEod)
      .where(and(eq(posEod.storeId, storeId), eq(posEod.eodDate, eodDate)));
    if (existing.length > 0 && existing[0].status === 'closed') {
      throw new ConflictException('当天已执行日结');
    }

    const startOfDay = new Date(`${eodDate}T00:00:00`);
    const endOfDay = new Date(`${eodDate}T23:59:59`);

    // 统计当日销售
    const [saleStats, refundStats, orderItems, paymentStats] = await Promise.all([
      this.db
        .select({
          count: count(),
          totalSales: sql<number>`COALESCE(SUM(${posSaleOrder.totalAmount}), 0)`,
          totalDiscount: sql<number>`COALESCE(SUM(${posSaleOrder.discountAmount}), 0)`,
          netSales: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}), 0)`,
          memberCount: sql<number>`COUNT(DISTINCT ${posSaleOrder.memberId}) FILTER (WHERE ${posSaleOrder.memberId} IS NOT NULL)`,
          memberSale: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}) FILTER (WHERE ${posSaleOrder.memberId} IS NOT NULL), 0)`,
        })
        .from(posSaleOrder)
        .where(
          and(
            eq(posSaleOrder.storeId, storeId),
            gte(posSaleOrder.createdAt, startOfDay),
            lte(posSaleOrder.createdAt, endOfDay),
            eq(posSaleOrder.status, 'completed'),
          ),
        ),
      this.db
        .select({
          totalRefund: sql<number>`COALESCE(SUM(${posReturnOrder.refundAmount}), 0)`,
        })
        .from(posReturnOrder)
        .where(
          and(
            eq(posReturnOrder.storeId, storeId),
            gte(posReturnOrder.createdAt, startOfDay),
            lte(posReturnOrder.createdAt, endOfDay),
            eq(posReturnOrder.status, 'completed'),
          ),
        ),
      this.db
        .select({
          qty: sql<number>`COALESCE(SUM(${posSaleItem.qty}), 0)`,
        })
        .from(posSaleItem)
        .innerJoin(posSaleOrder, eq(posSaleItem.orderId, posSaleOrder.id))
        .where(
          and(
            eq(posSaleOrder.storeId, storeId),
            gte(posSaleOrder.createdAt, startOfDay),
            lte(posSaleOrder.createdAt, endOfDay),
            eq(posSaleOrder.status, 'completed'),
          ),
        ),
      this.db
        .select({
          payMethod: posSalePayment.payMethod,
          saleAmount: sql<number>`COALESCE(SUM(${posSalePayment.amount}), 0)`,
        })
        .from(posSalePayment)
        .innerJoin(posSaleOrder, eq(posSalePayment.orderId, posSaleOrder.id))
        .where(
          and(
            eq(posSaleOrder.storeId, storeId),
            gte(posSaleOrder.createdAt, startOfDay),
            lte(posSaleOrder.createdAt, endOfDay),
            eq(posSaleOrder.status, 'completed'),
          ),
        )
        .groupBy(posSalePayment.payMethod),
    ]);

    const orderCount = Number(saleStats[0]?.count ?? 0);
    const totalSales = Number(saleStats[0]?.totalSales ?? 0);
    const totalDiscount = Number(saleStats[0]?.totalDiscount ?? 0);
    const totalRefund = Number(refundStats[0]?.totalRefund ?? 0);
    const netSales = Number(saleStats[0]?.netSales ?? 0) - totalRefund;
    const itemCount = Number(orderItems[0]?.qty ?? 0);
    const customerCount = Number(saleStats[0]?.memberCount ?? 0);
    const avgTicket = orderCount > 0 ? netSales / orderCount : 0;
    const attachRate = orderCount > 0 ? itemCount / orderCount : 0;
    const memberSaleRatio = netSales > 0 ? Number(saleStats[0]?.memberSale ?? 0) / netSales : 0;

    const eodNo = `EOD${eodDate.replace(/-/g, '')}`;

    let eodId = '';

    await this.db.transaction(async (tx) => {
      let eodResult;
      if (existing.length > 0) {
        [eodResult] = await tx
          .update(posEod)
          .set({
          status: 'closed',
          totalSales: toCents(round2(totalSales)),
          totalRefund: toCents(round2(totalRefund)),
          totalDiscount: toCents(round2(totalDiscount)),
          netSales: toCents(round2(netSales)),
          orderCount,
          itemCount,
          customerCount,
          avgTicket: toCents(avgTicket),
          attachRate: attachRate.toString(),
          memberSaleRatio: memberSaleRatio.toString(),
            closedAt: new Date(),
          })
          .where(eq(posEod.id, existing[0].id))
          .returning({ id: posEod.id });
      } else {
        [eodResult] = await tx
          .insert(posEod)
          .values({
            eodNo,
            storeId,
            eodDate,
          status: 'closed',
          totalSales: toCents(round2(totalSales)),
          totalRefund: toCents(round2(totalRefund)),
          totalDiscount: toCents(round2(totalDiscount)),
          netSales: toCents(round2(netSales)),
          orderCount,
          itemCount,
          customerCount,
          avgTicket: toCents(avgTicket),
          attachRate: attachRate.toString(),
          memberSaleRatio: memberSaleRatio.toString(),
            closedAt: new Date(),
          })
          .returning({ id: posEod.id });
      }
      eodId = eodResult.id;

      // S-7：写入支付方式明细前先清空旧明细。
      // 原先每次执行都无条件 insert，重复日结会让支付方式明细成倍累加，
      // 导致 Z 报不可信。
      await tx.delete(posEodPayment).where(eq(posEodPayment.eodId, eodResult.id));

      for (const pay of paymentStats) {
        await tx.insert(posEodPayment).values({
          eodId: eodResult.id,
          payMethod: pay.payMethod,
          saleAmount: toCents(round2(pay.saleAmount)),
          refundAmount: 0,
          netAmount: toCents(round2(pay.saleAmount)),
        });
      }

      // P0-2：日结封账审计（与日结同事务，失败仅告警不回滚主流程）
      await auditAction(tx, {
        storeId,
        employeeId: operatorId ?? null,
        module: 'shift',
        action: 'execute_eod',
        targetNo: eodNo,
        content: { eodNo, storeId, eodDate, orderCount, netSales },
      });
    });

    return this.getEodDetail(eodId);
  }

  async getEodDetail(id: string): Promise<Eod> {
    const rows = await this.db
      .select()
      .from(posEod)
      .where(eq(posEod.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('日结单不存在');
    }

    const payments = await this.db
      .select()
      .from(posEodPayment)
      .where(eq(posEodPayment.eodId, id));

    return {
      ...this.mapEod(rows[0]),
      payments: payments.map((p) => ({
        id: p.id,
        eodId: p.eodId,
        payMethod: p.payMethod,
        saleAmount: fromCents(Number(p.saleAmount)),
        refundAmount: fromCents(Number(p.refundAmount)),
        netAmount: fromCents(Number(p.netAmount)),
      })),
    };
  }

  private mapShift(row: {
    id: string;
    shiftNo: string;
    storeId: string;
    cashierId: string | null;
    startTime: Date;
    endTime: Date | null;
    openingCash: string | number;
    closingCash: string | number | null;
    status: string;
    saleCount: number;
    saleAmount: string | number;
    refundAmount: string | number;
    cashExpected: string | number | null;
    cashActual: string | number | null;
    cashDiff: string | number | null;
    createdAt: Date;
    updatedAt: Date;
    cashierName?: string | null;
  }): Shift {
    return {
      id: row.id,
      shiftNo: row.shiftNo,
      storeId: row.storeId,
      cashierId: row.cashierId ?? undefined,
      startTime: row.startTime.toISOString(),
      endTime: row.endTime?.toISOString(),
      openingCash: fromCents(row.openingCash),
      closingCash: row.closingCash != null ? fromCents(row.closingCash) : undefined,
      status: row.status,
      saleCount: row.saleCount,
      saleAmount: fromCents(row.saleAmount),
      refundAmount: fromCents(row.refundAmount),
      cashExpected: row.cashExpected != null ? fromCents(row.cashExpected) : undefined,
      cashActual: row.cashActual != null ? fromCents(row.cashActual) : undefined,
      cashDiff: row.cashDiff != null ? fromCents(row.cashDiff) : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      cashierName: row.cashierName ?? undefined,
    };
  }

  private mapEod(row: typeof posEod.$inferSelect): Eod {
    return {
      id: row.id,
      eodNo: row.eodNo,
      storeId: row.storeId,
      eodDate: new Date(row.eodDate).toISOString().split('T')[0],
      status: row.status,
      totalSales: fromCents(row.totalSales),
      totalRefund: fromCents(row.totalRefund),
      totalDiscount: fromCents(row.totalDiscount),
      netSales: fromCents(row.netSales),
      orderCount: row.orderCount,
      itemCount: row.itemCount,
      customerCount: row.customerCount,
      avgTicket: fromCents(row.avgTicket),
      attachRate: Number(row.attachRate),
      memberSaleRatio: Number(row.memberSaleRatio),
      closedAt: row.closedAt?.toISOString(),
      syncedToErp: row.syncedToErp,
      syncStatus: row.syncStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
