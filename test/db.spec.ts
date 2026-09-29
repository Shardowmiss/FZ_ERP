/**
 * 测试底座自检。
 *
 * 所有真库 spec 都建立在「用例之间互不污染」这条承诺上 —— 如果 withIsolatedTransaction
 * 的 ROLLBACK 失效，测试会"看起来全绿"但互相串数据，那比没有测试更危险。
 * 所以底座自己必须先被测。
 */
import { describe, it, expect } from 'vitest';
import {
  createTestClient,
  testDatabaseUrl,
  withIsolatedTransaction,
  raw,
  TEST_DB_NAME,
} from './utils/db';

/** 借 pos_receive_log 这张与业务场景无关的小表做回滚探针。 */
const PROBE = 'pos_receive_log';

/**
 * drizzle + postgres-js 的 execute() 直接返回数组（不是 {rows:[...]}），
 * 这里两种形状都接，免得每个 spec 都踩一次。
 */
function firstCell(res: unknown): number | undefined {
  const arr = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return Number((arr[0] as { c?: number } | undefined)?.c);
}

describe('真库夹具', () => {
  it('连接串指向独立测试库，绝不指向开发库', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
    expect(testDatabaseUrl()).toContain(TEST_DB_NAME);
  });

  it('测试库结构与开发库同构（不是空库）', async () => {
    const sql = createTestClient();
    try {
      const r = await sql`select count(*)::int as c from information_schema.tables where table_schema = 'public'`;
      expect(Number(r[0].c)).toBeGreaterThan(50);
    } finally {
      await sql.end();
    }
  });

  it('withIsolatedTransaction：事务内可见，事务外必须消失（回滚真的生效）', async () => {
    const marker = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 表名是模块级常量（非外部输入），直接内嵌；只有 marker 需要参数化
    const seen = await withIsolatedTransaction(({ db }) =>
      db
        .execute(
          raw`insert into ${raw.identifier(PROBE)} (biz_type, pos_doc_no, status) values ('SalesOrder', ${marker}, 'pending')` as never,
        )
        .then(() =>
          db.execute(
            raw`select count(*)::int as c from ${raw.identifier(PROBE)} where pos_doc_no = ${marker}` as never,
          ),
        )
        .then(firstCell),
    );
    expect(seen).toBe(1);

    // 关键：回滚之后同一行必须查不到，否则用例之间会互相污染
    const after = createTestClient();
    try {
      const r = await after`select count(*)::int as c from ${after(PROBE)} where pos_doc_no = ${marker}`;
      expect(Number(r[0].c)).toBe(0);
    } finally {
      await after.end();
    }
  });
});
