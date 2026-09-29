import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, gte, lte, lt, desc, sql, inArray } from 'drizzle-orm';
import {
  retailOrder,
  retailOrderItem,
  retailReturn,
  store,
  style,
} from '@server/database/schema';
import type {
  RetailReportSummary,
  RetailStoreRankItem,
  RetailStyleTopItem,
  RetailPayMethodStat,
  RetailTrendItem,
} from '@shared/api.interface';

export interface RetailReportResult {
  summary: RetailReportSummary;
  storeRank: RetailStoreRankItem[];
  styleTop: RetailStyleTopItem[];
  payMethodStats: RetailPayMethodStat[];
  trend: RetailTrendItem[];
}

@Injectable()
export class RetailReportService {
  private readonly logger = new Logger(RetailReportService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getReport(params: {
    startDate: string;
    endDate: string;
    storeId?: string;
    brand?: string;
  }): Promise<RetailReportResult> {
    const { startDate, endDate, storeId, brand } = params;

    if (!startDate || !endDate) {
      throw new BadRequestException('开始日期和结束日期不能为空');
    }

    const [summary, storeRank, styleTop, payMethodStats, trend] =
      await Promise.all([
        this.getSummary(startDate, endDate, storeId, brand),
        this.getStoreRank(startDate, endDate, storeId, brand),
        this.getStyleTop(startDate, endDate, storeId, brand),
        this.getPayMethodStats(startDate, endDate, storeId, brand),
        this.getTrend(startDate, endDate, storeId, brand),
      ]);

    return { summary, storeRank, styleTop, payMethodStats, trend };
  }

  /* ---------- summary ---------- */
  private async getSummary(
    startDate: string,
    endDate: string,
    storeId?: string,
    brand?: string,
  ): Promise<RetailReportSummary> {
    const conditions = this.buildConditions(startDate, endDate, storeId, brand);
    const activeStatuses = ['settled', 'returned'];
    const statusArr = sql`ARRAY[${sql.join(activeStatuses.map((s: string) => sql`${s}`), sql`, `)}]::varchar[]`;

    const rows = await this.db
      .select({
        totalAmount: sql<string>`sum(${retailOrder.receivableAmount})`,
        orderCount: sql<number>`count(*)`,
        totalItemQty:
          sql<string>`coalesce((select sum(${retailOrderItem.quantity}) from ${retailOrderItem} where ${retailOrderItem.retailId} in (select ${retailOrder.id} from ${retailOrder} where ${this.whereSql(conditions)} and ${retailOrder.status} = ANY(${statusArr}))), 0)`,
        totalLineAmount:
          sql<string>`coalesce((select sum(${retailOrderItem.lineAmount}) from ${retailOrderItem} where ${retailOrderItem.retailId} in (select ${retailOrder.id} from ${retailOrder} where ${this.whereSql(conditions)} and ${retailOrder.status} = ANY(${statusArr}))), 0)`,
      })
      .from(retailOrder)
      .where(and(...conditions, inArray(retailOrder.status, activeStatuses)));

    const totalAmount = Number(rows[0]?.totalAmount ?? 0);
    const orderCount = Number(rows[0]?.orderCount ?? 0);
    const totalItemQty = Number(rows[0]?.totalItemQty ?? 0);
    const totalLineAmount = Number(rows[0]?.totalLineAmount ?? 0);

    // 退货金额与单数
    const returnConditions = this.buildReturnConditions(startDate, endDate, storeId, brand);
    const returnRows = await this.db
      .select({
        returnAmount: sql<string>`sum(${retailReturn.totalAmount})`,
        returnOrderCount: sql<number>`count(*)`,
      })
      .from(retailReturn)
      .where(and(...returnConditions, eq(retailReturn.status, 'refunded')));

    const returnAmount = Number(returnRows[0]?.returnAmount ?? 0);
    const returnOrderCount = Number(returnRows[0]?.returnOrderCount ?? 0);
    const netAmount = totalAmount - returnAmount;

    const avgOrderAmount = orderCount > 0 ? netAmount / orderCount : 0;
    const avgItemPrice = totalItemQty > 0 ? totalLineAmount / totalItemQty : 0;

    return {
      totalAmount: this.round2(totalAmount),
      returnAmount: this.round2(returnAmount),
      netAmount: this.round2(netAmount),
      orderCount,
      returnOrderCount,
      avgOrderAmount: this.round2(avgOrderAmount),
      avgItemPrice: this.round2(avgItemPrice),
      totalItemQty: this.round3(totalItemQty),
    };
  }

  /* ---------- store rank ---------- */
  private async getStoreRank(
    startDate: string,
    endDate: string,
    storeId?: string,
    brand?: string,
  ): Promise<RetailStoreRankItem[]> {
    const conditions = this.buildConditions(startDate, endDate, storeId, brand);

    const rows = await this.db
      .select({
        storeId: retailOrder.storeId,
        storeName: retailOrder.storeName,
        amount: sql<string>`sum(${retailOrder.receivableAmount})`,
        orderCount: sql<number>`count(*)`,
      })
      .from(retailOrder)
      .where(and(...conditions, inArray(retailOrder.status, ['settled', 'returned'])))
      .groupBy(retailOrder.storeId, retailOrder.storeName)
      .orderBy(desc(sql`sum(${retailOrder.receivableAmount})`))
      .limit(10);

    return rows.map((r) => ({
      storeId: r.storeId,
      storeName: r.storeName,
      amount: this.round2(Number(r.amount)),
      orderCount: Number(r.orderCount),
    }));
  }

  /* ---------- style top ---------- */
  private async getStyleTop(
    startDate: string,
    endDate: string,
    storeId?: string,
    brand?: string,
  ): Promise<RetailStyleTopItem[]> {
    // settled retail orders join with items
    const conditions = this.buildConditions(startDate, endDate, storeId, brand);
    const whereClause = and(
      ...conditions,
      inArray(retailOrder.status, ['settled', 'returned']),
    );

    const rows = await this.db
      .select({
        styleNo: retailOrderItem.styleNo,
        styleName: style.name,
        brand: style.brand,
        qty: sql<string>`sum(${retailOrderItem.quantity})`,
        amount: sql<string>`sum(${retailOrderItem.lineAmount})`,
      })
      .from(retailOrderItem)
      .innerJoin(
        retailOrder,
        eq(retailOrderItem.retailId, retailOrder.id),
      )
      .innerJoin(style, eq(retailOrderItem.styleNo, style.styleNo))
      .where(whereClause)
       .groupBy(retailOrderItem.styleNo, style.name, style.brand)
      .orderBy(desc(sql`sum(${retailOrderItem.quantity})`))
      .limit(10);

    return rows.map((r) => ({
      styleNo: r.styleNo,
      styleName: r.styleName ?? r.styleNo,
      brand: r.brand ?? undefined,
      qty: this.round3(Number(r.qty)),
      amount: this.round2(Number(r.amount)),
    }));
  }

  /* ---------- pay method stats ---------- */
  private async getPayMethodStats(
    startDate: string,
    endDate: string,
    storeId?: string,
    brand?: string,
  ): Promise<RetailPayMethodStat[]> {
    const conditions = this.buildConditions(startDate, endDate, storeId, brand);

    // payMethods is jsonb array of {method, amount}; use jsonb_array_elements
    const result = await this.db.execute(sql`
      SELECT
        (elem->>'method')::varchar AS method,
        sum((elem->>'amount')::numeric)::text AS amount
      FROM ${retailOrder},
           jsonb_array_elements(${retailOrder.payMethods}) AS elem
       WHERE ${this.whereSql(conditions)}
         AND ${retailOrder.status} = ANY(ARRAY['settled','returned']::varchar[])
      GROUP BY (elem->>'method')::varchar
      ORDER BY amount DESC
    `);

    const rows = result as unknown as Array<{ method: string; amount: string }>;

    return rows.map((r) => ({
      method: r.method,
      amount: this.round2(Number(r.amount)),
    }));
  }

  /* ---------- trend (last 30 days, date ascending) ---------- */
  private async getTrend(
    startDate: string,
    endDate: string,
    storeId?: string,
    brand?: string,
  ): Promise<RetailTrendItem[]> {
    const conditions = this.buildConditions(startDate, endDate, storeId, brand);

    const rows = await this.db
      .select({
        date: retailOrder.saleDate,
        amount: sql<string>`sum(${retailOrder.receivableAmount})`,
        orderCount: sql<number>`count(*)`,
      })
      .from(retailOrder)
      .where(and(...conditions, inArray(retailOrder.status, ['settled', 'returned'])))
      .groupBy(retailOrder.saleDate)
      .orderBy(retailOrder.saleDate);

    return rows.map((r) => ({
      date: r.date,
      amount: this.round2(Number(r.amount)),
      orderCount: Number(r.orderCount),
    }));
  }

  /* ================= helpers ================= */

  private buildConditions(
    startDate: string,
    endDate: string,
    storeId?: string,
    brand?: string,
  ) {
    const conditions = [
      gte(retailOrder.saleDate, startDate),
      lte(retailOrder.saleDate, endDate),
    ];
    if (storeId) {
      conditions.push(eq(retailOrder.storeId, storeId));
    }
    if (brand) {
      // 缺陷修复：该子查询此前只按 style.brand 过滤，不带任何时间条件 ——
      // 主查询注入了时间窗，这里却漏了，于是"按品牌筛选"会退化成 retail_order_item 全表扫描。
      // 补一层时间窗（走 retail_order 的 sale_date 索引），使内外口径一致。
      conditions.push(
        sql`${retailOrder.id} IN (
          SELECT DISTINCT ${retailOrderItem.retailId}
          FROM ${retailOrderItem}
          INNER JOIN ${style} ON ${retailOrderItem.styleNo} = ${style.styleNo}
          WHERE ${style.brand} = ${brand}
            AND ${retailOrderItem.retailId} IN (
              SELECT ${retailOrder.id}
              FROM ${retailOrder}
              WHERE ${retailOrder.saleDate} >= ${startDate}
                AND ${retailOrder.saleDate} <= ${endDate}
            )
        )`,
      );
    }
    return conditions;
  }

  private buildReturnConditions(
    startDate: string,
    endDate: string,
    storeId?: string,
    _brand?: string,
  ) {
    const conditions = [
      gte(retailReturn.returnDate, startDate),
      lte(retailReturn.returnDate, endDate),
    ];
    if (storeId) {
      conditions.push(eq(retailReturn.storeId, storeId));
    }
    // 注意：零售退货单暂无明细表，暂不支持按品牌筛选退货数据
    return conditions;
  }

  // helper: convert drizzle conditions array to raw SQL expression
  // for use in template strings
  private whereSql(conditions: ReturnType<typeof this.buildConditions>) {
    if (conditions.length === 0) return sql`1 = 1`;
    return sql`${and(...conditions)}`;
  }

  private round2(val: number): number {
    return Math.round(val * 100) / 100;
  }
  private round3(val: number): number {
    return Math.round(val * 1000) / 1000;
  }
}
