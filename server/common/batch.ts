/**
 * 通用批量数据库写入助手 —— 用于消除循环内逐行 insert/upsert 导致的 N+1 往返。
 *
 * 设计要点：
 * - `chunk`：分块，避免单条 SQL 过大（PostgreSQL 对单语句参数数量有限制）。
 * - `bulkInsert` / `bulkUpsert`：内部按块逐块 await，块间串行以兼容事务上下文（tx）。
 * - 不引入任何领域依赖，纯 drizzle 透传，可被任意 service / tx 复用。
 *
 * 注意：本文件为无副作用的纯工具，不参与 Nest DI，仅被 service 以普通 import 引入。
 */

export const BATCH_SIZE = 500;

/** 把数组按 size 切片为块数组。 */
export function chunk<T>(arr: readonly T[], size: number = BATCH_SIZE): T[][] {
  if (size <= 0) size = BATCH_SIZE;
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type DbClient = any;

/** 分块批量 insert（多值 values）。rows 为空直接返回。 */
export async function bulkInsert(
  db: DbClient,
  table: any,
  rows: any[],
  chunkSize: number = BATCH_SIZE,
): Promise<void> {
  if (!rows.length) return;
  for (const c of chunk(rows, chunkSize)) {
    await db.insert(table).values(c);
  }
}

/**
 * 分块批量 upsert（多值 values + onConflictDoUpdate）。
 * @param target 冲突目标列（单列或列数组）
 * @param set    冲突时的更新表达式（对象，值可为 sql 表达式，如 sql`EXCLUDED.x` 或累加）
 */
export async function bulkUpsert(
  db: DbClient,
  table: any,
  rows: any[],
  target: any,
  set: any,
  chunkSize: number = BATCH_SIZE,
): Promise<void> {
  if (!rows.length) return;
  for (const c of chunk(rows, chunkSize)) {
    await db.insert(table).values(c).onConflictDoUpdate({ target, set });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
