import { and, sql, type SQL } from 'drizzle-orm';

/**
 * 通用 keyset（游标/seek）分页工具。
 *
 * 为什么需要：OFFSET 分页在深翻页时（如第 1000 页）需要扫描并丢弃前 N 条，
 * 复杂度 O(N+M)，大表深翻页严重退化。keyset 基于“上一页最后一行的时间戳+主键”
 * 构造 WHERE 条件，直接定位起点，复杂度 O(M)，且结果稳定（不受新增行位移影响）。
 *
 * 约定：排序必须为 (timeCol DESC, idCol DESC)；游标编码为 base64url(`${tsMs}_${id}`)。
 */

/** 编码游标：timeCol(ms) + id。 */
export function encodeCursor(tsMs: number, id: string): string {
  return Buffer.from(`${tsMs}_${id}`, 'utf8').toString('base64url');
}

/** 解码游标；非法值返回 null（调用方应回退到 offset 首屏）。 */
export function decodeCursor(cursor: string): { tsMs: number; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('_');
    if (idx <= 0) return null;
    const tsMs = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(tsMs) || !id) return null;
    return { tsMs, id };
  } catch {
    return null;
  }
}

/**
 * 构造 keyset 的 WHERE（timeCol DESC, idCol DESC 排序下，取“小于游标”的行）：
 *   (timeCol, idCol) < (cursorTs, cursorId)
 *
 * 必须用"行比较"而不是等价的 OR 展开 `(t < a) OR (t = a AND id < b)`：
 * 实测（20 万行 inventory_flow，深翻页 20 行）：
 *   OR 展开   → Index Cond 只到等值过滤列，游标条件退化成 Filter，Index Scan 返回 20 行但耗时 ~9.9ms
 *   行比较    → Index Cond 完整下推 ROW(_created_at, id) < ROW(...)，Index Scan 只返回 20 行，耗时 ~0.006ms
 * 两者结果完全等价（行比较就是字典序定义），差异全在 planner 能否下推索引条件。
 *
 * 返回 undefined 表示游标非法，调用方应忽略 keyset 回退 offset。
 */
export function keysetWhereLt(timeCol: any, idCol: any, cursor: string): SQL | undefined {
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;
  // 注意：这里必须传 ISO 字符串而非 JS Date —— drizzle 的 sql 模板内传 Date 时
  // postgres.js 在 Bind 阶段会抛 ERR_INVALID_ARG_TYPE（实测踩到），传字符串才稳定。
  const ts = new Date(decoded.tsMs).toISOString();
  return sql`(${timeCol}, ${idCol}) < (${ts}, ${decoded.id})`;
}

/** 从结果集最后一行生成下一页游标；无数据返回 null。 */
export function nextCursorFrom<T extends Record<string, any>>(
  rows: T[],
  timeField: keyof T,
  idField: keyof T,
): string | null {
  if (!rows || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  const ts = last[timeField];
  const id = last[idField];
  if (ts == null || id == null) return null;
  return encodeCursor(new Date(ts).getTime(), String(id));
}

export interface KeysetPagedResult<T> {
  rows: T[];
  total: number;
  nextCursor?: string;
}

/**
 * keyset/offset 双模分页执行器：把“游标分页”与“页码分页”收敛到一个入口，
 * 避免每个 service 各自手写 if/else 分支而产生分叉。
 *
 * 契约：
 * - 无 cursor（首屏 / 浅翻页）：走 OFFSET，total 为精确 COUNT，行为与改造前完全一致。
 * - 有 cursor（深翻页 / 无限滚动）：走 keyset，忽略 page；total 取当页行数
 *   （keyset 无法低成本 COUNT，除非调用方显式传入 countWhere）。
 * - cursor 非法：keysetWhereLt 返回 undefined，自动回退到 OFFSET 首屏，不报错。
 *
 * @param select (where, limit, offset) => Promise<T[]> 由调用方构造，保证 ORDER BY 与
 *               keysetWhereLt 的 (timeCol DESC, idCol DESC) 严格一致（不得使用 COLLATE 覆盖）。
 */
export async function paginateWithKeyset<T>(cfg: {
  cursor?: string | null;
  page: number;
  pageSize: number;
  timeCol: any;
  idCol: any;
  timeField: string;
  idField: string;
  where: SQL | undefined;
  select: (where: SQL | undefined, limit: number, offset: number) => Promise<T[]>;
  count?: (where: SQL | undefined) => Promise<number>;
}): Promise<KeysetPagedResult<T>> {
  const { cursor, page, pageSize, timeCol, idCol, timeField, idField, where, select, count } =
    cfg;

  const keysetCond = cursor ? keysetWhereLt(timeCol, idCol, cursor) : undefined;
  const effectiveWhere = keysetCond ? (where ? and(where, keysetCond) : keysetCond) : where;

  if (keysetCond) {
    // keyset 模式下 total 无意义（深翻页场景下 COUNT 本身就是性能杀手），返回当页行数
    const rows = await select(effectiveWhere, pageSize, 0);
    return {
      rows,
      total: rows.length,
      nextCursor: nextCursorFrom(rows, timeField as keyof T, idField as keyof T) ?? undefined,
    };
  }

  const offset = page > 1 ? (page - 1) * pageSize : 0;
  const [rows, total] = await Promise.all([
    select(where, pageSize, offset),
    count ? count(where) : Promise.resolve(0),
  ]);
  return {
    rows,
    total: Number(total ?? 0),
    nextCursor: nextCursorFrom(rows, timeField as keyof T, idField as keyof T) ?? undefined,
  };
}
