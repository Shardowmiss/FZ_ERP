import { and, isNull, eq, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@server/database/drizzle-tokens';

/**
 * P2-10：核心主数据软删除脚手架（进阶：全局查询拦截器）。
 *
 * 各核心主数据表新增 nullable 的 `deletedAt` 列（见 schema.ts）。
 * - 读取时用 `notDeleted(table)` 过滤，排除已软删除行；
 * - 删除时用 `softDelete(db, table, id)` 置位，避免硬删除导致误删不可恢复。
 *
 * 进阶（全局拦截器）：`scopeDatabase(db)` 以 Proxy 包裹注入的 drizzle 实例，
 * 对所有「带 `deletedAt` 列」的表（select / update / delete）自动注入
 * `deletedAt IS NULL`，事务内 `tx` 同样递归包裹。insert 与原始 `execute(sql)`
 * 透传（不加过滤，由调用方负责）。业务 service 在构造函数中
 * `this.db = scopeDatabase(this.db)` 即可全局生效，零查询调用点改动。
 *
 * 说明：当前应用层没有主数据的硬删除端点（仅有日结明细清理），
 * 新增删除操作应调用 `softDelete` 而非 `db.delete`。
 */

/** 生成 `deletedAt IS NULL` 过滤条件，可直接传入 drizzle 的 `.where()`。 */
export function notDeleted(table: { deletedAt: unknown }): SQL {
  return isNull(table.deletedAt as never);
}

/** 软删除写入的值：置位 deletedAt，并**同时推进 updatedAt**。
 *
 * 为什么必须推进 `updatedAt`：`updatedAt` 是离线增量同步（offline-sync 的
 * `since` 水位）与下游同步的唯一变更判据。若软删除只写 `deletedAt`，
 * 该行的 `updatedAt` 保持旧值 → 增量查询 `updatedAt > since` 永不命中 →
 * 客户端与下游永远不知道这行被删了（本地残留已下架主数据，收银台仍能扫到）。
 * 把「删除」表达为一个普通变更，即可复用既有增量链路，无需引入墓碑表。
 */
function softDeleteValues(): Record<string, unknown> {
  const now = new Date();
  return { deletedAt: now, updatedAt: now };
}

type SoftDeleteDb = {
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (cond: unknown) => Promise<unknown>;
    };
  };
};

/** 将某行标记为已删除（软删除），不真正从库表移除。 */
export async function softDelete(
  db: SoftDeleteDb,
  table: { id: unknown; deletedAt: unknown },
  id: string,
): Promise<void> {
  await db
    .update(table as never)
    .set(softDeleteValues())
    .where(eq(table.id as never, id));
}

/** 恢复软删除行（清空 deletedAt），同样推进 updatedAt 使变更可被增量感知。 */
export async function restoreSoftDeleted(
  db: SoftDeleteDb,
  table: { id: unknown; deletedAt: unknown },
  id: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(table as never)
    .set({ deletedAt: null, updatedAt: now })
    .where(eq(table.id as never, id));
}

// ---------------------------------------------------------------------------
// 全局软删除作用域（查询拦截器）
// ---------------------------------------------------------------------------

/** 带 `deletedAt` 列的表（或其别名）才参与软删除过滤。 */
interface SoftDeletable {
  deletedAt: unknown;
}

function hasDeletedAt(t: unknown): t is SoftDeletable {
  return (
    !!t &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    'deletedAt' in (t as object)
  );
}

type ScopeOp = 'select' | 'update' | 'delete' | 'insert';

/** 判断一个对象是否为 drizzle 查询构造器（而非已执行的 Promise）。 */
function isDrizzleBuilder(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.where === 'function' ||
    typeof o.from === 'function' ||
    typeof o.execute === 'function' ||
    typeof o.returning === 'function' ||
    typeof o.values === 'function'
  );
}

/**
 * 包裹单个查询构造器：捕获主表，按需注入 `deletedAt IS NULL`。
 * - select / update / delete：自动加过滤（显式 where 时包裹 and，否则在终结点补 where）。
 * - insert：不加过滤（insert 不查，且 onConflictDoUpdate 的 where 属配置项不拦截）。
 */
function scopeBuilder<T extends object>(
  builder: T,
  table: SoftDeletable | null,
  op: ScopeOp,
  whereApplied: { v: boolean },
): T {
  const filter = (): SQL | null =>
    table && op !== 'insert' && !whereApplied.v
      ? (isNull(table.deletedAt as never) as SQL)
      : null;

  const wrapWhere = (cond: unknown): unknown =>
    and(cond as SQL, isNull(table!.deletedAt as never) as SQL);

  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string') return value;

      // 终结点：await / execute / get / all / values / run。若未显式 where，补 notDeleted。
      if (
        ['then', 'execute', 'get', 'all', 'values', 'run'].includes(prop) &&
        typeof value === 'function'
      ) {
        return (...args: unknown[]) => {
          const f = filter();
          const exec: unknown = f ? (target as never as { where: (c: SQL) => unknown }).where(f) : target;
          const method = (exec as Record<string, unknown>)[prop] as (
            ...a: unknown[]
          ) => unknown;
          return method.apply(exec, args);
        };
      }

      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        // 入口捕获主表
        if (
          (prop === 'from' ||
            prop === 'update' ||
            prop === 'delete' ||
            prop === 'insert') &&
          hasDeletedAt(args[0])
        ) {
          const b = (value as (...a: unknown[]) => unknown).apply(target, args);
          const nextOp: ScopeOp =
            prop === 'insert'
              ? 'insert'
              : prop === 'from'
                ? 'select'
                : (prop as ScopeOp);
          return scopeBuilder(b as object, args[0] as SoftDeletable, nextOp, whereApplied);
        }

        // 显式 where：包裹 notDeleted（insert 不拦截）
        if (prop === 'where' && table && op !== 'insert') {
          whereApplied.v = true;
          const wrapped = (value as (...a: unknown[]) => unknown).apply(
            target,
            [wrapWhere(args[0])],
          );
          return scopeBuilder(wrapped as object, table, op, whereApplied);
        }

        const r = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (isDrizzleBuilder(r)) return scopeBuilder(r as object, table, op, whereApplied);
        return r;
      };
    },
  }) as T;
}

/**
 * 包裹注入的 drizzle `db`，使其成为「全局软删除作用域」：
 * - `db.select()/update()/delete()` 命中带 `deletedAt` 的表时自动注入 `deletedAt IS NULL`；
 * - `db.insert()` 透传（不影响写入）；
 * - `db.execute(sql)` 透传（原始 SQL 由调用方负责）；
 * - `db.transaction(cb)` / `db.$transaction(cb)` 内的 `tx` 同样被包裹。
 *
 * 用法（service 构造函数）：`this.db = scopeDatabase(this.db);`
 */
export function scopeDatabase(db: PostgresJsDatabase): PostgresJsDatabase {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string') return value;

      if ((prop === 'transaction' || prop === '$transaction') && typeof value === 'function') {
        return (cb: (tx: unknown) => Promise<unknown>) =>
          (value as (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>).call(
            target,
            (tx: unknown) => cb(scopeDatabase(tx as PostgresJsDatabase)),
          );
      }

      if (typeof value !== 'function') return value;

      if (prop === 'select' || prop === 'selectDistinct' || prop === 'selectDistinctOn') {
        const wa = { v: false };
        return (...args: unknown[]) =>
          scopeBuilder(
            (value as (...a: unknown[]) => unknown).apply(target, args),
            null,
            'select',
            wa,
          );
      }

      if (prop === 'update' || prop === 'delete' || prop === 'insert') {
        const wa = { v: false };
        return (...args: unknown[]) =>
          scopeBuilder(
            (value as (...a: unknown[]) => unknown).apply(target, args),
            hasDeletedAt(args[0]) ? (args[0] as SoftDeletable) : null,
            prop as ScopeOp,
            wa,
          );
      }

      return value;
    },
  }) as PostgresJsDatabase;
}
