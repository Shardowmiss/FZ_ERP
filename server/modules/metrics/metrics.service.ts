import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import { hostname } from 'node:os';

/**
 * Wave 2-2 指标物化视图层服务（纯 PG，零新基础设施）。
 *
 * 三张分析型物化视图（mv_store_sales_daily / mv_inventory_by_store / mv_member_summary）
 * 由迁移 0038 建出，并由 SECURITY DEFINER 函数 refresh_metrics_materialized_views()
 * 统一刷新（规避平台 anon_ 无 REFRESH 权限坑）。本服务负责：
 *   ① 周期调度刷新（零依赖 setInterval，避开装不上的 @nestjs/schedule）；
 *   ② 用 pg_try_advisory_lock 做单实例刷新（多实例只有 Leader 真正 REFRESH，省 PG 压力）；
 *   ③ 暴露查询方法给控制器；④ 暴露refresh()给运维端点。
 *
 * 与事件总线同范式：测试可直接 new MetricsService(db) 调 refresh()/查询，不依赖定时调度
 * （onModuleInit 由 Nest 触发，单测不触发即无后台计时器干扰）。
 */
const REFRESH_INTERVAL_MS = Number(process.env.METRICS_REFRESH_MS ?? 5 * 60_000);
// 与事件总线(915037127)/补货调度器错开的顾问锁 key，避免两把锁互相干扰。
const ADVISORY_LOCK_KEY = 915_037_228n;
// 测试/本地不启动后台刷新，避免污染用例与重复刷新。
const ENABLED =
  process.env.NODE_ENV !== 'test' && process.env.METRICS_REFRESH !== 'off';

export interface StoreSalesDailyFilter {
  storeId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

export interface InventoryByStoreFilter {
  storeId?: string;
  skuId?: string;
}

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly nodeId = `${hostname()}-${process.pid}`;
  private timer?: NodeJS.Timeout;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async onModuleInit(): Promise<void> {
    if (!ENABLED || REFRESH_INTERVAL_MS <= 0) return;
    this.timer = setInterval(() => {
      void this.scheduledRefresh().catch((e: unknown) =>
        this.logger.error('指标刷新调度异常', (e as Error)?.stack),
      );
    }, REFRESH_INTERVAL_MS);
    this.logger.log(`指标物化视图刷新调度已启动（周期 ${REFRESH_INTERVAL_MS}ms, node=${this.nodeId}）`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** 调度入口：拿到顾问锁才真正 REFRESH，其余实例跳过（避免多实例并发刷新互相阻塞）。 */
  async scheduledRefresh(): Promise<number> {
    const client = (this.db as unknown as { $client?: any }).$client;
    if (!client?.reserve) {
      // 不支持 reserve（如 pglite/测试桩）直接刷新。
      await this.refresh();
      return 1;
    }
    const conn = await client.reserve();
    try {
      const res = await conn`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
      if (res?.[0]?.locked !== true) return 0; // 其它实例正在刷新
      try {
        await this.refresh();
        return 1;
      } finally {
        await conn`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.catch(() => undefined);
      }
    } finally {
      await conn.release().catch(() => undefined);
    }
  }

  /** 立即刷新全部指标物化视图（调用 SECURITY DEFINER 函数）。 */
  async refresh(): Promise<void> {
    await this.db.execute(sql`SELECT refresh_metrics_materialized_views()`);
    this.logger.log('指标物化视图已刷新');
  }

  /** 门店日销量（可按门店 / 日期区间过滤）。 */
  async storeSalesDaily(filter: StoreSalesDailyFilter = {}): Promise<any[]> {
    const conditions: SQL[] = [];
    if (filter.storeId) conditions.push(sql`store_id = ${filter.storeId}`);
    if (filter.from) conditions.push(sql`sale_date >= ${filter.from}`);
    if (filter.to) conditions.push(sql`sale_date <= ${filter.to}`);
    const whereSql = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const rows = (await this.db.execute(sql`
      SELECT sale_date, store_id, store_code, store_name, store_type, dealer_id,
             order_count, member_order_count, item_qty, tag_amount, discount_amount, net_amount
      FROM mv_store_sales_daily
      ${whereSql}
      ORDER BY sale_date DESC, store_code
    `)) as unknown as any[];
    return rows;
  }

  /** 门店库存（可按门店 / SKU 过滤）。 */
  async inventoryByStore(filter: InventoryByStoreFilter = {}): Promise<any[]> {
    const conditions: SQL[] = [];
    if (filter.storeId) conditions.push(sql`store_id = ${filter.storeId}`);
    if (filter.skuId) conditions.push(sql`sku_id = ${filter.skuId}`);
    const whereSql = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const rows = (await this.db.execute(sql`
      SELECT store_id, store_code, store_name, store_type, sku_id, sku_code, style_no,
             color, size, color_id, size_id, quantity, in_transit_qty, amount
      FROM mv_inventory_by_store
      ${whereSql}
      ORDER BY store_code, sku_code, style_no, color, size
    `)) as unknown as any[];
    return rows;
  }

  /** 会员汇总（按等级）。 */
  async memberSummary(): Promise<any[]> {
    const rows = (await this.db.execute(sql`
      SELECT level, member_count, total_spent, points, order_count, stored_value
      FROM mv_member_summary
      ORDER BY level
    `)) as unknown as any[];
    return rows;
  }
}
