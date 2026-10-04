import { fromCents } from '@server/database/money';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import {
  posSaleOrder,
  posSaleItem,
  posEmployee,
  posStyle,
} from '@server/database/schema';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import type {
  TodayKpi,
  SalesTrendPoint,
  SalesTrendQuery,
  TopStyleItem,
  TopStyleQuery,
  ListResponse,
  EmployeeRankingItem,
  EmployeeRankingQuery,
  CategorySalesItem,
  CategorySalesQuery,
} from '@shared/api.interface';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    ) {
    this.db = scopeDatabase(this.db);
  }

  private toShanghaiDayStart(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map((s: string) => parseInt(s, 10));
    const dt = new Date(Date.UTC(y, m - 1, d, -8, 0, 0, 0));
    return dt;
  }

  private toShanghaiDayEnd(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map((s: string) => parseInt(s, 10));
    const dt = new Date(Date.UTC(y, m - 1, d + 1, -8, 0, 0, -1));
    return dt;
  }

  async getTodayKpi(storeId: string): Promise<TodayKpi> {
    const today = new Date();
    const todayStr = today.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const startOfToday = new Date(Date.UTC(y, m, d - 1, 16, 0, 0));
    const endOfToday = new Date(Date.UTC(y, m, d, 15, 59, 59, 999));
    const startOfYesterday = new Date(Date.UTC(y, m, d - 2, 16, 0, 0));
    const endOfYesterday = new Date(Date.UTC(y, m, d - 1, 15, 59, 59, 999));

    const [todayStats, yesterdayStats, itemStats, refundStats, discountStats] =
      await Promise.all([
        this.db
          .select({
            totalSales: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}), 0)`,
            orderCount: sql<number>`COUNT(*)`,
            customerCount: sql<number>`COUNT(DISTINCT ${posSaleOrder.memberId}) FILTER (WHERE ${posSaleOrder.memberId} IS NOT NULL)`,
            memberSale: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}) FILTER (WHERE ${posSaleOrder.memberId} IS NOT NULL), 0)`,
          })
          .from(posSaleOrder)
          .where(
            and(
              eq(posSaleOrder.storeId, storeId),
              gte(posSaleOrder.createdAt, startOfToday),
              lte(posSaleOrder.createdAt, endOfToday),
              eq(posSaleOrder.status, 'completed'),
            ),
          ),
        this.db
          .select({
            totalSales: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}), 0)`,
            orderCount: sql<number>`COUNT(*)`,
          })
          .from(posSaleOrder)
          .where(
            and(
              eq(posSaleOrder.storeId, storeId),
              gte(posSaleOrder.createdAt, startOfYesterday),
              lte(posSaleOrder.createdAt, endOfYesterday),
              eq(posSaleOrder.status, 'completed'),
            ),
          ),
        this.db
          .select({
            itemCount: sql<number>`COALESCE(SUM(${posSaleItem.qty}), 0)`,
          })
          .from(posSaleItem)
          .innerJoin(posSaleOrder, eq(posSaleItem.orderId, posSaleOrder.id))
          .where(
            and(
              eq(posSaleOrder.storeId, storeId),
              gte(posSaleOrder.createdAt, startOfToday),
              lte(posSaleOrder.createdAt, endOfToday),
              eq(posSaleOrder.status, 'completed'),
            ),
          ),
        // 退款暂用0
        Promise.resolve([{ totalRefund: 0 }]),
        this.db
          .select({
            totalDiscount: sql<number>`COALESCE(SUM(${posSaleOrder.discountAmount}), 0)`,
          })
          .from(posSaleOrder)
          .where(
            and(
              eq(posSaleOrder.storeId, storeId),
              gte(posSaleOrder.createdAt, startOfToday),
              lte(posSaleOrder.createdAt, endOfToday),
              eq(posSaleOrder.status, 'completed'),
            ),
          ),
      ]);

    const totalSales = fromCents(Number(todayStats[0]?.totalSales ?? 0));
    const orderCount = Number(todayStats[0]?.orderCount ?? 0);
    const itemCount = Number(itemStats[0]?.itemCount ?? 0);
    const customerCount = Number(todayStats[0]?.customerCount ?? 0);
    const totalRefund = Number(refundStats[0]?.totalRefund ?? 0);
    const totalDiscount = fromCents(Number(discountStats[0]?.totalDiscount ?? 0));
    const netSales = totalSales - totalRefund;
    const avgTicket = orderCount > 0 ? netSales / orderCount : 0;
    const attachRate = orderCount > 0 ? itemCount / orderCount : 0;
    const memberSaleRatio = totalSales > 0 ? fromCents(Number(todayStats[0]?.memberSale ?? 0)) / totalSales : 0;

    const yesterdaySales = fromCents(Number(yesterdayStats[0]?.totalSales ?? 0));
    const yesterdayOrders = Number(yesterdayStats[0]?.orderCount ?? 0);
    const growthRate = yesterdaySales > 0 ? (totalSales - yesterdaySales) / yesterdaySales : 0;

    return {
      totalSales: Math.round(totalSales * 100) / 100,
      orderCount,
      itemCount,
      customerCount,
      avgTicket: Math.round(avgTicket * 100) / 100,
      attachRate: Math.round(attachRate * 100) / 100,
      memberSaleRatio: Math.round(memberSaleRatio * 10000) / 10000,
      totalRefund: Math.round(totalRefund * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
      comparedYesterday: {
        totalSales: Math.round(yesterdaySales * 100) / 100,
        orderCount: yesterdayOrders,
        growthRate: Math.round(growthRate * 10000) / 10000,
      },
    };
  }

  async getSalesTrend(query: SalesTrendQuery): Promise<SalesTrendPoint[]> {
    const { storeId, startDate, endDate, granularity } = query;

    // P0-3：无日期参数时注入默认回看窗口，避免 toShanghaiDayStart(undefined) 崩溃 500。
    // 默认 90 天，可由 DASHBOARD_LOOKBACK_DAYS 覆盖；显式传参时与改造前完全等价。
    const lookbackDays = Math.max(1, Number(process.env.DASHBOARD_LOOKBACK_DAYS ?? '90') || 90);
    const now = new Date();
    const fmtShanghai = (d: Date) =>
      d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
    const effStartDate = startDate ?? fmtShanghai(new Date(now.getTime() - lookbackDays * 86400000));
    const effEndDate = endDate ?? fmtShanghai(now);

    const start = this.toShanghaiDayStart(effStartDate);
    const end = this.toShanghaiDayEnd(effEndDate);

    const dateTrunc = granularity === 'hour' ? 'hour' : 'day';

    const format = granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
    const rows = await this.db.execute<{ period: string; sales: string; orders: string }>(sql`
      SELECT
        TO_CHAR(DATE_TRUNC(${dateTrunc}, ${posSaleOrder.createdAt}), ${format}) AS period,
        COALESCE(SUM(${posSaleOrder.payAmount}), 0) AS sales,
        COUNT(*) AS orders
      FROM ${posSaleOrder}
      WHERE ${posSaleOrder.storeId} = ${storeId}
        AND ${posSaleOrder.createdAt} >= ${start.toISOString()}
        AND ${posSaleOrder.createdAt} <= ${end.toISOString()}
        AND ${posSaleOrder.status} = 'completed'
      GROUP BY 1
      ORDER BY 1
    `);

    return rows.map((row) => ({
      period: row.period,
      sales: fromCents(Number(row.sales)),
      orders: Number(row.orders),
      refunds: 0,
    }));
  }

  async getTopStyles(query: TopStyleQuery): Promise<ListResponse<TopStyleItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(posSaleOrder.status, 'completed')];
    if (query.storeId) conditions.push(eq(posSaleOrder.storeId, query.storeId));
    if (query.startDate) conditions.push(gte(posSaleOrder.createdAt, this.toShanghaiDayStart(query.startDate)));
    if (query.endDate) conditions.push(lte(posSaleOrder.createdAt, this.toShanghaiDayEnd(query.endDate)));

    const whereClause = and(...conditions);

    const rows = await this.db
      .select({
        styleId: posSaleItem.styleId,
        styleName: posSaleItem.styleName,
        qty: sql<number>`SUM(${posSaleItem.qty})`,
        amount: sql<number>`SUM(${posSaleItem.lineAmount})`,
      })
      .from(posSaleItem)
      .innerJoin(posSaleOrder, eq(posSaleItem.orderId, posSaleOrder.id))
      .where(whereClause)
      .groupBy(posSaleItem.styleId, posSaleItem.styleName)
      .orderBy(desc(sql`SUM(${posSaleItem.qty})`))
      .limit(pageSize)
      .offset(offset);

    // 计算总数（简单估算）
    const totalRows = await this.db
      .select({
        count: sql<number>`COUNT(DISTINCT ${posSaleItem.styleId})`,
      })
      .from(posSaleItem)
      .innerJoin(posSaleOrder, eq(posSaleItem.orderId, posSaleOrder.id))
      .where(whereClause);

    const total = Number(totalRows[0]?.count ?? 0);

    return {
      items: rows.map((row, index) => ({
        styleId: row.styleId,
        styleName: row.styleName,
        category: '',
        qty: Number(row.qty),
        amount: fromCents(row.amount),
        rank: offset + index + 1,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getEmployeeRanking(
    query: EmployeeRankingQuery,
  ): Promise<ListResponse<EmployeeRankingItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(posSaleOrder.status, 'completed')];
    if (query.storeId) conditions.push(eq(posSaleOrder.storeId, query.storeId));
    if (query.startDate) conditions.push(gte(posSaleOrder.createdAt, this.toShanghaiDayStart(query.startDate)));
    if (query.endDate) conditions.push(lte(posSaleOrder.createdAt, this.toShanghaiDayEnd(query.endDate)));

    const whereClause = and(...conditions);

    const rows = await this.db
      .select({
        employeeId: posSaleOrder.employeeId,
        employeeName: posEmployee.name,
        role: posEmployee.role,
        salesAmount: sql<number>`COALESCE(SUM(${posSaleOrder.payAmount}), 0)`,
        orderCount: sql<number>`COUNT(${posSaleOrder.id})`,
      })
      .from(posSaleOrder)
      .leftJoin(posEmployee, eq(posSaleOrder.employeeId, posEmployee.id))
      .where(whereClause)
      .groupBy(posSaleOrder.employeeId, posEmployee.name, posEmployee.role)
      .orderBy(desc(sql`SUM(${posSaleOrder.payAmount})`))
      .limit(pageSize)
      .offset(offset);

    const totalRows = await this.db
      .select({
        count: sql<number>`COUNT(DISTINCT ${posSaleOrder.employeeId}) FILTER (WHERE ${posSaleOrder.employeeId} IS NOT NULL)`,
      })
      .from(posSaleOrder)
      .where(whereClause);

    const total = Number(totalRows[0]?.count ?? 0);

    const validRows = rows.filter((r) => r.employeeId != null);

    return {
      items: validRows.map((row, index) => {
        const orderCount = Number(row.orderCount ?? 0);
        const salesAmount = fromCents(Number(row.salesAmount ?? 0));
        return {
          employeeId: row.employeeId!,
          employeeName: row.employeeName ?? '未知',
          role: row.role ?? 'sales',
          salesAmount,
          orderCount,
          avgTicket: orderCount > 0 ? salesAmount / orderCount : 0,
          rank: offset + index + 1,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async getCategorySales(query: CategorySalesQuery): Promise<CategorySalesItem[]> {
    const conditions = [eq(posSaleOrder.status, 'completed')];
    if (query.storeId) conditions.push(eq(posSaleOrder.storeId, query.storeId));
    if (query.startDate) conditions.push(gte(posSaleOrder.createdAt, this.toShanghaiDayStart(query.startDate)));
    if (query.endDate) conditions.push(lte(posSaleOrder.createdAt, this.toShanghaiDayEnd(query.endDate)));

    const whereClause = and(...conditions);

    const rows = await this.db
      .select({
        category: posStyle.category,
        qty: sql<number>`SUM(${posSaleItem.qty})`,
        salesAmount: sql<number>`SUM(${posSaleItem.lineAmount})`,
      })
      .from(posSaleItem)
      .innerJoin(posSaleOrder, eq(posSaleItem.orderId, posSaleOrder.id))
      .leftJoin(posStyle, eq(posSaleItem.styleId, posStyle.id))
      .where(whereClause)
      .groupBy(posStyle.category)
      .orderBy(desc(sql`SUM(${posSaleItem.lineAmount})`))
      .limit(10);

    const totalSales = rows.reduce((sum: number, row) => sum + fromCents(row.salesAmount), 0);

    return rows.map((row, index) => ({
      category: row.category || '其他',
      salesAmount: fromCents(row.salesAmount),
      qty: Number(row.qty),
      percentage: totalSales > 0 ? fromCents(row.salesAmount) / totalSales : 0,
      rank: index + 1,
    }));
  }
}
