/**
 * P1-2 / M5 回归测试（B.1 颜色尺码双轨统一）
 *
 * 验证两件事：
 *   1) M3 迁移已在 erp_db 落地 —— 业务表（以 sku 为代表）存在可空外键列
 *      color_id / size_id（information_schema 断言，纯读）。
 *   2) M5 回填脚本的核心逻辑正确 —— 在隔离事务内播种主数据 + 改动一行，
 *      跑与 scripts/backfill-color-size.sql 完全一致的 UPDATE，断言：
 *        · 命中主数据的行 color_id/size_id 被填上；
 *        · 无主数据的串（脏串）保持 NULL（不强行写入、不报错）。
 *   全部包在 withErpIsolatedTransaction，事务外零残留。
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  withErpIsolatedTransaction,
  raw,
  type ErpDb,
} from './utils/erp-db';

/** 取 execute 结果的首行（兼容 postgres-js 的 RowList / .rows 两种形态）。 */
async function firstRow(db: ErpDb, query: ReturnType<typeof raw>) {
  const r: any = await db.execute(query);
  const rows = Array.isArray(r) ? r : r?.rows ?? [];
  return rows[0] ?? undefined;
}

/** 与 scripts/backfill-color-size.sql 完全一致的回填 UPDATE（单表）。
 *  表名 t 是受控常量（非用户输入），直接拼进 SQL 字符串再包 raw，避免 drizzle 把标识符当参数转义。 */
const BACKFILL_COLOR = (t: string) => {
  const stmt = `UPDATE ${t} SET color_id = (SELECT c.id FROM color c WHERE c.name = ${t}.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL`;
  return sql.raw(stmt);
};
const BACKFILL_SIZE = (t: string) => {
  const stmt = `UPDATE ${t} SET size_id = (SELECT z.id FROM size z WHERE z.name = ${t}.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL`;
  return sql.raw(stmt);
};

describe('P1-2 M3 迁移落地：业务表存在可空 color_id/size_id', () => {
  it('sku 表有 color_id / size_id 两列且允许 NULL', async () => {
    const res = await withErpIsolatedTransaction(async (ctx) => {
      const r: any = await ctx.db.execute(raw`
        select
          max(case when column_name='color_id' then is_nullable end) as color_nullable,
          max(case when column_name='size_id'  then is_nullable end) as size_nullable,
          count(*) as cnt
        from information_schema.columns
        where table_name='sku' and column_name in ('color_id','size_id')
      `);
      const rows = Array.isArray(r) ? r : r?.rows ?? [];
      return rows[0];
    });
    expect(res.cnt).toBe('2');
    expect(res.color_nullable).toBe('YES');
    expect(res.size_nullable).toBe('YES');
  });
});

describe('P1-2 M5 回填逻辑：命中主数据则填 id，脏串保持 NULL', () => {
  it('已播种主数据的颜色/尺码串 → color_id/size_id 被回填', async () => {
    const out = await withErpIsolatedTransaction(async (ctx) => {
      const db = ctx.db;
      // 0) 播种主数据（事务内，回滚消失；tx 隔离故无需 ON CONFLICT）
      await db.execute(raw`
        INSERT INTO color (id, code, name, hex)
        VALUES (gen_random_uuid(), 'P1C-TEST', 'P1C-TEST', '#000000')
      `);
      await db.execute(raw`
        INSERT INTO size (id, code, name)
        VALUES (gen_random_uuid(), 'P1S-TEST', 'P1S-TEST')
      `);
      const colorRow = await firstRow(db, raw`select id from color where name='P1C-TEST' limit 1`);
      const sizeRow = await firstRow(db, raw`select id from size where name='P1S-TEST' limit 1`);
      const colorId = colorRow?.id;
      const sizeId = sizeRow?.id;
      expect(colorId).toBeTruthy();
      expect(sizeId).toBeTruthy();

      // 1) 取一行真实 sku，改成测试串并清空 id
      const skuRow = await firstRow(db, raw`select id from sku limit 1`);
      const skuId = skuRow?.id;
      await db.execute(
        raw`UPDATE sku SET color='P1C-TEST', size='P1S-TEST', color_id=NULL, size_id=NULL WHERE id=${skuId}`,
      );

      // 2) 执行回填（与脚本一致）
      await db.execute(BACKFILL_COLOR('sku'));
      await db.execute(BACKFILL_SIZE('sku'));

      // 3) 读取回填结果
      const after = await firstRow(db, raw`select color_id, size_id from sku where id=${skuId}`);
      return { colorId, sizeId, gotColor: after?.color_id, gotSize: after?.size_id };
    });

    expect(out.gotColor).toBe(out.colorId);
    expect(out.gotSize).toBe(out.sizeId);
  });

  it('无主数据的串（脏串）回填后保持 NULL，不报错', async () => {
    const out = await withErpIsolatedTransaction(async (ctx) => {
      const db = ctx.db;
      const skuRow = await firstRow(db, raw`select id from sku limit 1`);
      const skuId = skuRow?.id;
      // 故意写一个主数据里没有的串
      await db.execute(
        raw`UPDATE sku SET color='P1C-NOPE', size='P1S-NOPE', color_id=NULL, size_id=NULL WHERE id=${skuId}`,
      );
      await db.execute(BACKFILL_COLOR('sku'));
      await db.execute(BACKFILL_SIZE('sku'));
      const after = await firstRow(db, raw`select color_id, size_id from sku where id=${skuId}`);
      return { gotColor: after?.color_id, gotSize: after?.size_id };
    });

    expect(out.gotColor).toBeNull();
    expect(out.gotSize).toBeNull();
  });
});
