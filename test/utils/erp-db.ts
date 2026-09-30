/**
 * E.1 直连开发库 erp_db 的测试夹具（PostgreSQL）。
 *
 * 与 test/utils/db.ts（指向独立克隆库 erp_test）的区别：
 *   · 用户（项目 owner）在路线图评审中明确要求 E.1「直连 erp_db 跑真实数据」。
 *   · erp_db 主数据最完整（store/sku/customer/dealer 充足），单据稀疏，
 *     用它跑出来的断言才有真实业务意义。
 *   · 风险：erp_db 是开发库，一旦 ROLLBACK 失效就会污染真实数据。
 *     因此本夹具强制「每个用例包在事务里 + 无条件 ROLLBACK」，并配套
 *     e1-db-isolation.guard.spec.ts 先证明对 erp_db 的回滚真的生效，
 *     该护栏不过则其余 E.1 用例不可信。
 *
 * 隔离策略与 db.ts 完全一致：事务内可见、事务外必须消失。
 * 裸 SQL 一律走 `tx.execute(sqlTemplate)`，绝不用外层 client（postgres.js 的
 * BEGIN 会占用专用连接，外层client的写入不在事务内，ROLLBACK 拦不住）。
 */
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import * as schema from '@server/database/schema';

export type ErpDb = PostgresJsDatabase<typeof schema>;

/** E.1 目标库名；可用环境变量覆盖（默认就是开发库 erp_db，符合用户要求）。 */
export const ERP_DB_NAME: string = process.env.ERP_E1_DATABASE ?? 'erp_db';

/** 连接串：沿用应用自己的 SUDA_DATABASE_URL 配置（host/port/user 完全一致）。 */
export function erpDatabaseUrl(): string {
  const raw =
    process.env.SUDA_DATABASE_URL ??
    `${process.env.PG_URL ?? 'postgres://erp:erp@localhost:5434'}/erp_db`;
  const base = raw.replace(/\/[^/?]*(\?.*)?$/, '');
  const query = raw.match(/\?(.+)$/)?.[1];
  return `${base}/${ERP_DB_NAME}${query ? `?${query}` : ''}`;
}

/** 建一个客户端。用完必须调 end()，否则 vitest 收不了进程、会假超时。 */
export function createErpClient(): postgres.Sql {
  return postgres(erpDatabaseUrl(), { onnotice: () => {}, max: 4 });
}

export function createErpDb(client: postgres.Sql = createErpClient()): ErpDb {
  return drizzle(client, { schema });
}

/** 参数化原始 SQL 模板（配合 `tx.execute`）。 */
export const raw = drizzleSql;

/** 主动回滚标记：在事务回调里抛出即可让 drizzle 发出 ROLLBACK。 */
class RollbackMarker extends Error {
  constructor() {
    super('__rollback__');
    this.name = 'RollbackMarker';
  }
}

export interface ErpIsolatedContext {
  /** drizzle 事务对象，直接传给业务 service（类型与全局 db 一致）。 */
  db: ErpDb;
}

/**
 * 在一个可回滚的事务里执行用例，无论成功失败都 ROLLBACK —— 用例之间互不污染，
 * 且绝不向开发库 erp_db 留下任何痕迹。
 */
export async function withErpIsolatedTransaction<T>(
  fn: (ctx: ErpIsolatedContext) => Promise<T>,
): Promise<T> {
  const client = createErpClient();
  const root = drizzle(client, { schema });
  let done: T | undefined;

  try {
    await root.transaction(async (tx) => {
      done = await fn({ db: tx as ErpDb });
      throw new RollbackMarker();
    });
  } catch (e) {
    if (!(e instanceof RollbackMarker)) throw e;
  } finally {
    await client.end().catch(() => undefined);
  }

  return done as T;
}
