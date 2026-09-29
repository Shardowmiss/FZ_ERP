import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

/**
 * ERP 侧软删除辅助（P1-c②）。
 *
 * 与 BaseCrudService 的约定一致：表中存在 `deletedAt` 列即启用软删除，
 * 因此这里同样做鸭子类型判定，未扩列的表不受影响（向后兼容）。
 *
 * 与 BaseCrudService.remove() 的差异：置位 `_deleted_at` 的同时推进 `_updated_at`。
 * 理由：`_updated_at` 是增量同步 / 变更追踪的唯一判据，只置位 `_deleted_at`
 * 会让下游（POS 离线同步、对账任务）感知不到这行被删过。
 */

/** 「未删除」条件片段；表无 deletedAt 列时返回空数组。 */
export function notDeleted(table: any): SQL[] {
  const t = table as any;
  return t?.deletedAt ? [isNull(t.deletedAt)] : [];
}

/**
 * 把「未删除」并入一组条件，返回可直接交给 `.where()` 的对象。
 * 无 id 条件、无 scope、且表未启用软删除时返回 undefined（等价于不加过滤）。
 */
export function notDeletedWhere(
  table: any,
  ...conditions: (SQL | boolean | undefined)[]
): SQL | undefined {
  const parts = conditions.filter((c): c is SQL => !!c && typeof c !== 'boolean');
  const all = [...parts, ...notDeleted(table)];
  return all.length > 0 ? (and(...all) as SQL) : undefined;
}

/** 软删除：置位 `_deleted_at` 并推进 `_updated_at`；返回受影响行数（0 表示记录不存在）。 */
export async function softDeleteRow(
  db: PostgresJsDatabase | any,
  table: any,
  id: string,
): Promise<number> {
  const t = table as any;
  const values: Record<string, unknown> = { deletedAt: new Date() };
  if (t.updatedAt) values.updatedAt = new Date();
  const rows = await db.update(t).set(values).where(eq(t.id, id)).returning({ id: t.id });
  return rows.length;
}

/** 还原：清空 `deletedAt` 并推进 `_updated_at`；返回受影响行数（0 表示记录不存在）。 */
export async function restoreRow(
  db: PostgresJsDatabase | any,
  table: any,
  id: string,
): Promise<number> {
  const t = table as any;
  const values: Record<string, unknown> = { deletedAt: null };
  if (t.updatedAt) values.updatedAt = new Date();
  const rows = await db.update(t).set(values).where(eq(t.id, id)).returning({ id: t.id });
  return rows.length;
}
