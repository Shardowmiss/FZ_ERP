import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, desc, sql, and, gte, lt } from 'drizzle-orm';
import { round2, round3, roundMoneyNum } from '../../../common/utils/money';
import {
  monthClose,
  monthCloseDetail,
  monthCloseLog,
  inventoryFlow,
  sku,
  style,
  receivablePayment,
  payablePayment,
  receivable,
  payable,
} from '@server/database/schema';
import { RequestContext, type DealerScope } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import type {
  MonthCloseRecord,
  MonthCloseDetail as MonthCloseDetailType,
  MonthCloseDetailResponse,
} from '@shared/api.interface';



function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const nextMonth = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end };
}

function extractMonth(bizDate: string | Date): string {
  const dateStr = bizDate instanceof Date
    ? bizDate.toISOString().slice(0, 10)
    : bizDate.slice(0, 10);
  return dateStr.slice(0, 7);
}

interface FlowAggRow {
  brand: string | null;
  warehouseId: string;
  warehouseName: string;
  flowType: string | null;
  totalQty: string;
  totalAmount: string;
}

/** 月结头 8 个金额汇总（受限用户读时从可见明细派生）。 */
interface DerivedTotals {
  openingQty: number;
  openingAmount: number;
  inboundQty: number;
  inboundAmount: number;
  outboundQty: number;
  outboundAmount: number;
  closingQty: number;
  closingAmount: number;
}

/** 无可见明细时的零汇总（默认拒绝：受限用户看不到任何跨租户数字）。 */
const ZERO_TOTALS: DerivedTotals = {
  openingQty: 0,
  openingAmount: 0,
  inboundQty: 0,
  inboundAmount: 0,
  outboundQty: 0,
  outboundAmount: 0,
  closingQty: 0,
  closingAmount: 0,
};

@Injectable()
export class MonthCloseService {
  private readonly logger = new Logger(MonthCloseService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /* ========== 列表 ========== */
  async list(): Promise<MonthCloseRecord[]> {
    const rows = await this.db
      .select()
      .from(monthClose)
      .orderBy(desc(monthClose.month));

    const scope = RequestContext.getDealerScope();
    // 超管 / 单租户 / 非请求上下文：返回存储的全局汇总（与改造前完全一致）
    if (!scope || scope.type === 'all') {
      return rows.map((row) => this.mapRecord(row));
    }
    // 受限经销商：头汇总由可见明细读时派生（不泄露其它经销商的全局数字）
    const summaries = await this.deriveSummaries(scope);
    return rows.map((row) => {
      const d = summaries.get(row.id);
      return d ? this.mapDerived(row, d) : this.mapDerived(row, ZERO_TOTALS);
    });
  }

  /* ========== 详情 ========== */
  async getById(id: string): Promise<MonthCloseRecord> {
    const rows = await this.db
      .select()
      .from(monthClose)
      .where(eq(monthClose.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('月结记录不存在');
    }
    const scope = RequestContext.getDealerScope();
    // 超管 / 单租户 / 非请求上下文：返回存储的全局汇总
    if (!scope || scope.type === 'all') {
      return this.mapRecord(rows[0]);
    }
    const summaries = await this.deriveSummaries(scope);
    const d = summaries.get(id);
    return d ? this.mapDerived(rows[0], d) : this.mapDerived(rows[0], ZERO_TOTALS);
  }

  /* ========== 月结校验（供其他服务调用） ========== */
  async checkMonthClosed(bizDate: string | Date): Promise<void> {
    const month = extractMonth(bizDate);
    const rows = await this.db
      .select({ status: monthClose.status })
      .from(monthClose)
      .where(eq(monthClose.month, month))
      .limit(1);

    if (rows.length > 0 && rows[0].status === 'closed') {
      throw new BadRequestException('已月结的单据不允许操作');
    }
  }

  /* ========== 执行月结 ========== */
  async close(id: string, userId: string): Promise<MonthCloseRecord> {
    const rows = await this.db
      .select()
      .from(monthClose)
      .where(eq(monthClose.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('月结记录不存在');
    }
    const record = rows[0];
    if (record.status === 'closed') {
      throw new BadRequestException('该月份已月结');
    }

    const month = record.month;
    const { start, end } = getMonthRange(month);
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();

    await this.db.transaction(async (tx) => {
      // 1. 计算期初库存（截止到月初，按品牌+仓库分组）
      const openingRows = await this.calcOpeningStock(tx, startIso);

      // 2. 计算本期入库（按 flow_type + 仓库分组）
      const inboundRows = await this.calcFlowByType(tx, 'in', startIso, endIso);

      // 3. 计算本期出库（按 flow_type + 仓库分组）
      const outboundRows = await this.calcFlowByType(tx, 'out', startIso, endIso);

      // 4. 计算期末库存（期初 + 入库 - 出库，按品牌+仓库分组）
      const closingRows = this.calcClosingStock(openingRows, inboundRows, outboundRows);

      // 5. 汇总主表数据
      const totals = this.sumAll(openingRows, inboundRows, outboundRows);

      // 6. 清空旧明细
      await tx.delete(monthCloseDetail).where(eq(monthCloseDetail.closeId, id));

      // 7. 写入明细
      const detailValues: Array<typeof monthCloseDetail.$inferInsert> = [];

      for (const row of openingRows) {
        detailValues.push({
          closeId: id,
          dimensionType: 'opening',
          brand: row.brand,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          flowType: null,
          qty: row.totalQty,
          amount: row.totalAmount,
        });
      }
      for (const row of inboundRows) {
        detailValues.push({
          closeId: id,
          dimensionType: 'inbound_by_type',
          brand: row.brand,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          flowType: row.flowType,
          qty: row.totalQty,
          amount: row.totalAmount,
        });
      }
      for (const row of outboundRows) {
        detailValues.push({
          closeId: id,
          dimensionType: 'outbound_by_type',
          brand: row.brand,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          flowType: row.flowType,
          qty: row.totalQty,
          amount: row.totalAmount,
        });
      }
      for (const row of closingRows) {
        detailValues.push({
          closeId: id,
          dimensionType: 'closing',
          brand: row.brand,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          flowType: null,
          qty: row.totalQty,
          amount: row.totalAmount,
        });
      }

      if (detailValues.length > 0) {
        await tx.insert(monthCloseDetail).values(detailValues);
      }

      // 8. 更新主表状态和数据
      await tx
        .update(monthClose)
        .set({
          status: 'closed',
          closedBy: userId,
          closedAt: new Date(),
          openingQty: totals.openingQty,
          openingAmount: totals.openingAmount,
          inboundQty: totals.inboundQty,
          inboundAmount: totals.inboundAmount,
          outboundQty: totals.outboundQty,
          outboundAmount: totals.outboundAmount,
          closingQty: totals.closingQty,
          closingAmount: totals.closingAmount,
        })
        .where(eq(monthClose.id, id));

      // 9. 写操作日志
      await tx.insert(monthCloseLog).values({
        month,
        action: 'close',
        operator: userId,
        operatedAt: new Date(),
      });
    });

    return this.mapStoredRecord(id);
  }

  /* ========== 反月结 ========== */
  async reopen(id: string, userId: string, remark?: string): Promise<MonthCloseRecord> {
    const rows = await this.db
      .select()
      .from(monthClose)
      .where(eq(monthClose.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('月结记录不存在');
    }
    const record = rows[0];
    if (record.status !== 'closed') {
      throw new BadRequestException('只有已月结状态才能反月结');
    }

    await this.db.transaction(async (tx) => {
      // 清空统计数据和明细，保留记录
      await tx
        .update(monthClose)
        .set({
          status: 'open',
          closedBy: null,
          closedAt: null,
          openingQty: '0',
          openingAmount: '0',
          inboundQty: '0',
          inboundAmount: '0',
          outboundQty: '0',
          outboundAmount: '0',
          closingQty: '0',
          closingAmount: '0',
        })
        .where(eq(monthClose.id, id));

      // 清空明细
      await tx.delete(monthCloseDetail).where(eq(monthCloseDetail.closeId, id));

      // 写操作日志
      await tx.insert(monthCloseLog).values({
        month: record.month,
        action: 'reopen',
        operator: userId,
        operatedAt: new Date(),
        remark: remark ?? null,
      });
    });

    return this.mapStoredRecord(id);
  }

  /* ========== 月结明细报表 ========== */
  async getDetail(id: string): Promise<MonthCloseDetailResponse> {
    const record = await this.getById(id);

    const scope = RequestContext.getDealerScope();
    // 受限经销商：明细按仓库反查经销商过滤；超管/单租户不加限制
    const dCond =
      scope && scope.type !== 'all'
        ? buildDealerScopeCondition(scope, { kind: 'viaWarehouse', column: monthCloseDetail.warehouseId })
        : undefined;
    const detailWhere = dCond
      ? and(eq(monthCloseDetail.closeId, id), dCond)
      : eq(monthCloseDetail.closeId, id);

    const detailRows = await this.db
      .select()
      .from(monthCloseDetail)
      .where(detailWhere);

    const opening: MonthCloseDetailType[] = [];
    const inboundByType: MonthCloseDetailType[] = [];
    const outboundByType: MonthCloseDetailType[] = [];
    const closing: MonthCloseDetailType[] = [];

    for (const row of detailRows) {
      const item: MonthCloseDetailType = {
        id: row.id,
        dimensionType: row.dimensionType,
        brand: row.brand ?? undefined,
        warehouseId: row.warehouseId ?? undefined,
        warehouseName: row.warehouseName ?? undefined,
        flowType: row.flowType ?? undefined,
        qty: Number(row.qty),
        amount: Number(row.amount),
      };
      switch (row.dimensionType) {
        case 'opening':
          opening.push(item);
          break;
        case 'inbound_by_type':
          inboundByType.push(item);
          break;
        case 'outbound_by_type':
          outboundByType.push(item);
          break;
        case 'closing':
          closing.push(item);
          break;
      }
    }

    // 应收/应付发生额
    const { start, end } = getMonthRange(record.month);
    // 受限经销商：应收（客户主数据已移除，不再按经销商隔离，unscoped 全量可见）；
    // 应付经 payable→supplier→partner(dealer) 反查过滤；超管/单租户不加限制
    const recvCond =
      scope && scope.type !== 'all'
        ? buildDealerScopeCondition(scope, { kind: 'dealerColumn', column: receivable.dealerId })
        : undefined;
    const payCond =
      scope && scope.type !== 'all'
        ? buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: payable.supplierId })
        : undefined;

    const recvQuery = this.db
      .select({ total: sql<number>`COALESCE(SUM(${receivablePayment.amount}), 0)::numeric` })
      .from(receivablePayment)
      .leftJoin(receivable, eq(receivablePayment.receivableId, receivable.id));
    const payQuery = this.db
      .select({ total: sql<number>`COALESCE(SUM(${payablePayment.amount}), 0)::numeric` })
      .from(payablePayment)
      .leftJoin(payable, eq(payablePayment.payableId, payable.id));

    if (recvCond) {
      recvQuery.where(and(gte(receivablePayment.paymentDate, start), lt(receivablePayment.paymentDate, end), recvCond));
    } else {
      recvQuery.where(and(gte(receivablePayment.paymentDate, start), lt(receivablePayment.paymentDate, end)));
    }
    if (payCond) {
      payQuery.where(and(gte(payablePayment.paymentDate, start), lt(payablePayment.paymentDate, end), payCond));
    } else {
      payQuery.where(and(gte(payablePayment.paymentDate, start), lt(payablePayment.paymentDate, end)));
    }

    const [recvResult, payResult] = await Promise.all([recvQuery, payQuery]);

    const receivableAmount = Number(recvResult[0]?.total ?? 0);
    const payableAmount = Number(payResult[0]?.total ?? 0);

    return {
      opening,
      inboundByType,
      outboundByType,
      closing,
      receivableAmount,
      payableAmount,
    };
  }

  /* ========== 内部计算方法 ========== */

  private async calcOpeningStock(
    tx: PostgresJsDatabase,
    startIso: string,
  ): Promise<FlowAggRow[]> {
    // 期初 = 截止到月初的累计流水
    // in 加，out 减，按 brand + warehouse 分组
    // brand 从 style 表通过 style_no 关联
    const result = await tx.execute(sql<FlowAggRow>`
      SELECT
        s.brand AS brand,
        f.warehouse_id AS "warehouseId",
        f.warehouse_name AS "warehouseName",
        NULL::varchar AS "flowType",
        COALESCE(SUM(CASE WHEN f.direction = 'in' THEN f.quantity ELSE -f.quantity END), 0)::numeric AS "totalQty",
        COALESCE(SUM(CASE
          WHEN f.direction = 'in' THEN f.quantity * COALESCE(f.unit_price, 0)
          ELSE -(f.quantity * COALESCE(f.unit_price, 0))
        END), 0)::numeric AS "totalAmount"
      FROM ${inventoryFlow} f
      LEFT JOIN ${style} s ON f.style_no = s.style_no
      WHERE f._created_at < ${startIso}
        AND f.item_type = 'sku'
      GROUP BY s.brand, f.warehouse_id, f.warehouse_name
      ORDER BY s.brand NULLS FIRST, f.warehouse_name
    `);

    return result as unknown as FlowAggRow[];
  }

  private async calcFlowByType(
    tx: PostgresJsDatabase,
    direction: 'in' | 'out',
    startIso: string,
    endIso: string,
  ): Promise<FlowAggRow[]> {
    const result = await tx.execute(sql<FlowAggRow>`
      SELECT
        s.brand AS brand,
        f.warehouse_id AS "warehouseId",
        f.warehouse_name AS "warehouseName",
        f.flow_type AS "flowType",
        COALESCE(SUM(f.quantity), 0)::numeric AS "totalQty",
        COALESCE(SUM(f.quantity * COALESCE(f.unit_price, 0)), 0)::numeric AS "totalAmount"
      FROM ${inventoryFlow} f
      LEFT JOIN ${style} s ON f.style_no = s.style_no
      WHERE f._created_at >= ${startIso}
        AND f._created_at < ${endIso}
        AND f.direction = ${direction}
        AND f.item_type = 'sku'
      GROUP BY s.brand, f.warehouse_id, f.warehouse_name, f.flow_type
      ORDER BY s.brand NULLS FIRST, f.warehouse_name, f.flow_type
    `);

    return result as unknown as FlowAggRow[];
  }

  private calcClosingStock(
    openingRows: FlowAggRow[],
    inboundRows: FlowAggRow[],
    outboundRows: FlowAggRow[],
  ): FlowAggRow[] {
    const map = new Map<string, FlowAggRow>();

    const keyOf = (row: { brand: string | null; warehouseId: string }): string =>
      `${row.brand ?? ''}|${row.warehouseId}`;

    // 期初
    for (const row of openingRows) {
      map.set(keyOf(row), {
        brand: row.brand,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        flowType: null,
        totalQty: row.totalQty,
        totalAmount: row.totalAmount,
      });
    }

    // 加入库
    for (const row of inboundRows) {
      const key = keyOf(row);
      const existing = map.get(key);
      if (existing) {
        const qty = Number(existing.totalQty) + Number(row.totalQty);
        const amt = Number(existing.totalAmount) + Number(row.totalAmount);
        existing.totalQty = round3(qty);
        existing.totalAmount = round2(amt);
      } else {
        map.set(key, {
          brand: row.brand,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          flowType: null,
          totalQty: row.totalQty,
          totalAmount: row.totalAmount,
        });
      }
    }

    // 减出库
    for (const row of outboundRows) {
      const key = keyOf(row);
      const existing = map.get(key);
      if (existing) {
        const qty = Number(existing.totalQty) - Number(row.totalQty);
        const amt = Number(existing.totalAmount) - Number(row.totalAmount);
        existing.totalQty = round3(qty);
        existing.totalAmount = round2(amt);
      } else {
        map.set(key, {
          brand: row.brand,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          flowType: null,
          totalQty: String(-Number(row.totalQty)),
          totalAmount: String(-Number(row.totalAmount)),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const aBrand = a.brand ?? '';
      const bBrand = b.brand ?? '';
      if (aBrand !== bBrand) return aBrand.localeCompare(bBrand);
      return a.warehouseName.localeCompare(b.warehouseName);
    });
  }

  private sumAll(
    openingRows: FlowAggRow[],
    inboundRows: FlowAggRow[],
    outboundRows: FlowAggRow[],
  ): {
    openingQty: string;
    openingAmount: string;
    inboundQty: string;
    inboundAmount: string;
    outboundQty: string;
    outboundAmount: string;
    closingQty: string;
    closingAmount: string;
  } {
    let openingQty = 0;
    let openingAmount = 0;
    for (const row of openingRows) {
      openingQty += Number(row.totalQty);
      openingAmount += Number(row.totalAmount);
    }

    let inboundQty = 0;
    let inboundAmount = 0;
    for (const row of inboundRows) {
      inboundQty += Number(row.totalQty);
      inboundAmount += Number(row.totalAmount);
    }

    let outboundQty = 0;
    let outboundAmount = 0;
    for (const row of outboundRows) {
      outboundQty += Number(row.totalQty);
      outboundAmount += Number(row.totalAmount);
    }

    const closingQty = openingQty + inboundQty - outboundQty;
    const closingAmount = openingAmount + inboundAmount - outboundAmount;

    return {
      openingQty: round3(openingQty),
      openingAmount: round2(openingAmount),
      inboundQty: round3(inboundQty),
      inboundAmount: round2(inboundAmount),
      outboundQty: round3(outboundQty),
      outboundAmount: round2(outboundAmount),
      closingQty: round3(closingQty),
      closingAmount: round2(closingAmount),
    };
  }

  /* ========== 经销商作用域辅助（路线 C：纯读时过滤，写不变） ========== */

  /** 受限用户可见的月结头汇总（由可见明细读时派生）。 */
  private async deriveSummaries(
    scope: DealerScope,
  ): Promise<Map<string, DerivedTotals>> {
    const cond = buildDealerScopeCondition(scope, {
      kind: 'viaWarehouse',
      column: monthCloseDetail.warehouseId,
    });

    const rows = await this.db
      .select({
        closeId: monthCloseDetail.closeId,
        dimensionType: monthCloseDetail.dimensionType,
        qty: sql<number>`COALESCE(SUM(${monthCloseDetail.qty}), 0)::numeric`,
        amount: sql<number>`COALESCE(SUM(${monthCloseDetail.amount}), 0)::numeric`,
      })
      .from(monthCloseDetail)
      .where(cond ? cond : undefined)
      .groupBy(monthCloseDetail.closeId, monthCloseDetail.dimensionType);

    const map = new Map<string, DerivedTotals>();
    for (const r of rows) {
      const id = r.closeId;
      if (!map.has(id)) {
        map.set(id, { ...ZERO_TOTALS });
      }
      const t = map.get(id)!;
      const qty = Number(r.qty);
      const amount = Number(r.amount);
      switch (r.dimensionType) {
        case 'opening':
          t.openingQty += qty;
          t.openingAmount += amount;
          break;
        case 'inbound_by_type':
          t.inboundQty += qty;
          t.inboundAmount += amount;
          break;
        case 'outbound_by_type':
          t.outboundQty += qty;
          t.outboundAmount += amount;
          break;
        case 'closing':
          t.closingQty += qty;
          t.closingAmount += amount;
          break;
      }
    }

    // 四维度汇总后统一 rounding，与 close() 的 round3/round2 口径一致。
    // DerivedTotals 字段为 number，故用 roundMoneyNum（返回 number）而非 round3/round2（返回 string）。
    for (const t of map.values()) {
      t.openingQty = roundMoneyNum(t.openingQty, 3);
      t.openingAmount = roundMoneyNum(t.openingAmount, 2);
      t.inboundQty = roundMoneyNum(t.inboundQty, 3);
      t.inboundAmount = roundMoneyNum(t.inboundAmount, 2);
      t.outboundQty = roundMoneyNum(t.outboundQty, 3);
      t.outboundAmount = roundMoneyNum(t.outboundAmount, 2);
      t.closingQty = roundMoneyNum(t.closingQty, 3);
      t.closingAmount = roundMoneyNum(t.closingAmount, 2);
    }
    return map;
  }

  /** 用派生的汇总值覆盖月结头的 8 个金额字段（其余字段来自存储行）。 */
  private mapDerived(
    row: typeof monthClose.$inferSelect,
    d: DerivedTotals,
  ): MonthCloseRecord {
    return {
      ...this.mapRecord(row),
      openingQty: d.openingQty,
      openingAmount: d.openingAmount,
      inboundQty: d.inboundQty,
      inboundAmount: d.inboundAmount,
      outboundQty: d.outboundQty,
      outboundAmount: d.outboundAmount,
      closingQty: d.closingQty,
      closingAmount: d.closingAmount,
    };
  }

  /** 写操作后返回存储的全局月结头（不受当前请求作用域影响）。 */
  private async mapStoredRecord(id: string): Promise<MonthCloseRecord> {
    const rows = await this.db
      .select()
      .from(monthClose)
      .where(eq(monthClose.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('月结记录不存在');
    }
    return this.mapRecord(rows[0]);
  }

  private mapRecord(row: typeof monthClose.$inferSelect): MonthCloseRecord {
    return {
      id: row.id,
      month: row.month,
      status: row.status as 'open' | 'closed',
      closedBy: row.closedBy ?? undefined,
      closedAt: row.closedAt ? row.closedAt.toISOString() : undefined,
      remark: row.remark ?? undefined,
      openingQty: Number(row.openingQty),
      openingAmount: Number(row.openingAmount),
      inboundQty: Number(row.inboundQty),
      inboundAmount: Number(row.inboundAmount),
      outboundQty: Number(row.outboundQty),
      outboundAmount: Number(row.outboundAmount),
      closingQty: Number(row.closingQty),
      closingAmount: Number(row.closingAmount),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
