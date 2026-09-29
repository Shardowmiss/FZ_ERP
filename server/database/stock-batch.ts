import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { posStock } from '@server/database/schema';

/**
 * P1-5：库存批量扣减
 * ---------------------------------------------------------------------------
 * 背景：开单 `createOrder` 原按明细逐件 `SELECT` + `UPDATE`，N 件即 2N 次数据库往返，
 *      且全部发生在同一事务内——高峰期表现为长事务、行锁堆积。
 * 改造：折叠同 SKU → 一次 `inArray` 预取并 `FOR UPDATE` 加行锁 → 单条
 *      `UPDATE ... FROM (VALUES ...)` 批量扣减。往返次数由 2N 降为恒定 2 次。
 *
 * 正确性三保证：
 *   1. 不超卖：`FOR UPDATE` 先行锁，锁内校验，锁内扣减；扣减侧另有 `qty >= delta` 兜底；
 *   2. 不加锁顺序错乱：调用方须传入「按 skuId 排序」的行（见 buildDeductLines），
 *      使并发事务按一致顺序取锁，规避死锁；
 *   3. 不漏扣：返回实际影响行数，与预期不符即抛错。
 */

type TxnCallback = Parameters<PostgresJsDatabase['transaction']>[0];
/** 事务句柄类型（`PostgresJsTransaction`，无 `transaction()` 方法） */
export type Tx = Parameters<TxnCallback>[0];

export interface StockDeductLine {
  skuId: string;
  styleName: string;
  colorId: string;
  sizeId: string;
  qty: number;
}

/**
 * 把订单明细折叠为扣减行：同 SKU 合并数量、按 skuId 升序排序（并发加锁顺序一致）。
 * 会完整克隆 styleName/colorId/sizeId 供错误文案使用。
 */
export function buildDeductLines<T extends StockDeductLine>(items: T[]): StockDeductLine[] {
  const map = new Map<string, StockDeductLine>();
  for (const item of items) {
    const line = map.get(item.skuId);
    if (line) {
      line.qty += item.qty; // 同 SKU 合并：与逐件扣减等价，但少一次 UPDATE
    } else {
      map.set(item.skuId, {
        skuId: item.skuId,
        styleName: item.styleName,
        colorId: item.colorId,
        sizeId: item.sizeId,
        qty: item.qty,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0,
  );
}

/**
 * 批量扣减库存。库存不足 / 无记录时抛 `ConflictException`，错误文案与原逐件实现一致，
 * 以保证既有前端与测试用例不回归。
 */
export async function deductStockBatch(
  tx: Tx,
  storeId: string,
  lines: StockDeductLine[],
): Promise<void> {
  if (lines.length === 0) return;

  // 前置护栏：本函数依赖「同 skuId 只有一行」这一前提。若传入重复 skuId，
  // `UPDATE ... FROM (VALUES ...)` 会把同一目标行匹配两次，PostgreSQL 只施加其一次
  // （结果不确定），表现为漏扣却默默错账。这里直接失败，避免静默错账。
  // 折叠请统一交给 buildDeductLines。
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.skuId)) {
      throw new Error(
        `deductStockBatch: skuId ${l.skuId} 出现重复行，请先经 buildDeductLines 折叠合并`,
      );
    }
    seen.add(l.skuId);
  }

  // ① 批量预取 + 行锁：后续校验与扣减均在同一事务内基于权威快照
  const stockRows = await tx
    .select()
    .from(posStock)
    .where(and(eq(posStock.storeId, storeId), inArray(posStock.skuId, lines.map((l) => l.skuId))))
    .for('update');
  const stockBySku = new Map(stockRows.map((r) => [r.skuId, r]));

  // ② 批量校验
  for (const line of lines) {
    const row = stockBySku.get(line.skuId);
    if (!row) {
      throw new ConflictException(
        `商品 ${line.styleName} (${line.colorId}/${line.sizeId}) 无库存记录`,
      );
    }
    if (row.qty < line.qty) {
      throw new ConflictException(
        `商品 ${line.styleName} (${line.colorId}/${line.sizeId}) 库存不足，当前库存 ${row.qty}，需要 ${line.qty}`,
      );
    }
  }

  // ③ 单条语句批量扣减
  const valuesTuple = sql.join(lines.map((l) => sql`(${l.skuId}::text, ${l.qty}::int)`), sql`, `);
  const updated = await tx
    .update(posStock)
    .set({ qty: sql<number>`${posStock.qty} - v.delta` })
    .from(sql`(VALUES ${valuesTuple}) AS v(sku_id, delta)`)
    .where(
      and(
        eq(posStock.storeId, storeId),
        eq(posStock.skuId, sql`v.sku_id`),
        sql`${posStock.qty} >= ${sql`v.delta`}`,
      ),
    )
    .returning({ id: posStock.id });

  // 已加锁且已校验，理论上不可能漏扣；真出现说明有并发写入绕过锁，显式失败优于静默错账
  if (updated.length !== lines.length) {
    throw new ConflictException('库存扣减失败，请重试');
  }
}
