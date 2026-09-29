/**
 * 真库测试夹具（PostgreSQL）。
 *
 * 为什么用真库而不是 pglite / mock：
 *   · ERP 侧的业务逻辑大量依赖 PG 语义（CHECK 约束、事务、EXPLAIN、RETURNING、
 *     date 类型比较）。用 mock 只能验证"我们拼的 SQL 长什么样"，验证不了"PG 怎么执行"，
 *     而 Wave 3 的性能结论恰恰来自后者。
 *   · 与既有 sim-*.cjs 验证脚本同一套底座，结论可以直接互认。
 *
 * 为什么用独立库 erp_test 而不是 erp_db：
 *   测试要 INSERT/UPDATE/DELETE，绝不能碰开发库。建库脚本见 scripts/setup-test-db.sh，
 *   它直接复刻 erp_db 的结构（116 张表），因此"测的结构 == 跑的结构"。
 *
 * 用例隔离策略：每个用例包在一个事务里，结束时无条件 ROLLBACK。
 *   代价是 service 内部若自己开事务（BEGIN 嵌套）会失败 —— 这类用例请改用
 *   `truncateBetween` 模式（每个用例前 TRUNCATE 业务表）。
 */
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import * as schema from '@server/database/schema';

export type TestDb = PostgresJsDatabase<typeof schema>;

/** 测试库名；可用环境变量覆盖（CI 上可指向一次性实例）。 */
export const TEST_DB_NAME: string = process.env.ERP_TEST_DATABASE ?? 'erp_test';

/** 连接串：把源库的库名换成测试库，host/port/user 全部沿用应用自己的配置。 */
export function testDatabaseUrl(): string {
  const raw =
    process.env.SUDA_DATABASE_URL ??
    `${process.env.PG_URL ?? 'postgres://erp:erp@localhost:5434'}/erp_db`;
  const base = raw.replace(/\/[^/?]*(\?.*)?$/, '');
  const query = raw.match(/\?(.+)$/)?.[1];
  return `${base}/${TEST_DB_NAME}${query ? `?${query}` : ''}`;
}

/** 建一个测试用客户端。用完必须调 end()，否则 vitest 收不了进程。 */
export function createTestClient(): postgres.Sql {
  return postgres(testDatabaseUrl(), { onnotice: () => {}, max: 4 });
}

export function createTestDb(client: postgres.Sql = createTestClient()): TestDb {
  return drizzle(client, { schema });
}

/** 主动回滚标记：在事务回调里抛出即可让 drizzle 发出 ROLLBACK。 */
class RollbackMarker extends Error {
  constructor() {
    super('__rollback__');
    this.name = 'RollbackMarker';
  }
}

/**
 * 在一个可回滚的事务里执行用例，无论成功失败都 ROLLBACK —— 用例之间互不污染。
 * 回调拿到的 tx 就是 drizzle 事务对象，可直接传给业务 service（其类型与全局 db 一致）。
 */
export interface IsolatedContext {
  /** drizzle 事务对象，直接传给业务 service。 */
  db: TestDb;
}

/**
 * 参数化原始 SQL 用这个模板（配合 `tx.execute`）。
 *
 * ⚠️ 不要用外层 `createTestClient()` 返回的客户端：postgres.js 的 BEGIN 会把一个
 * **专用连接**交给事务，而外层客户端仍在连接池里取自己的连接 —— 那样写进去的行
 * 根本不在事务内，ROLLBACK 之后照样看得见，用例隔离会被绕过且毫无察觉。
 * 需要裸 SQL 时一律走 `tx.execute(sqlTemplate)`。
 */
export const raw = drizzleSql;

export async function withIsolatedTransaction<T>(
  fn: (ctx: IsolatedContext) => Promise<T>,
): Promise<T> {
  const client = createTestClient();
  const root = drizzle(client, { schema });
  let done: T | undefined;

  try {
    await root.transaction(async (tx) => {
      done = await fn({ db: tx as TestDb });
      throw new RollbackMarker();
    });
  } catch (e) {
    // ROLLBACK 是预期内的，其余异常照常向外抛
    if (!(e instanceof RollbackMarker)) throw e;
  } finally {
    await client.end().catch(() => undefined);
  }

  return done as T;
}

/**
 * 「干净库」模式：用例开始前清空指定表。
 * 适用于被测代码内部会自己开事务（BEGIN 嵌套）的场景。
 */
export async function withTruncatedTables<T>(
  tables: readonly unknown[],
  fn: () => Promise<T>,
): Promise<T> {
  const client = createTestClient();
  const db = drizzle(client, { schema });
  const names = tables
    .map((t) => (t as { [k: string]: unknown }).sqlTableName)
    .filter(Boolean) as string[];

  try {
    if (names.length) {
      await db.execute(
        `truncate table ${names.map((n) => `"${n}"`).join(', ')} restart identity cascade` as never,
      );
    }
    return await fn();
  } finally {
    await client.end().catch(() => undefined);
  }
}
