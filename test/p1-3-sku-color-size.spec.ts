/**
 * P1-3 / M4 回归测试（B.1 颜色尺码双轨统一）—— sku 写入引用主数据
 *
 * 验证 sku.service.bulkImport 在写入时：
 *   · 把 color/size 自由串解析为主数据 id，写入 color_id / size_id（命中主数据时）；
 *   · 主数据里没有的串（脏串/新色）宽容处理：仍插入，color_id/size_id 留 NULL，
 *     由 varchar 镜像(color/size)兜底（过渡期行为，P1-4 才收紧 NOT NULL）。
 * 直连 erp_db（M5 已回填主数据：红/黑/黑色/蓝/X、S/M/L/XL/X/Z/均码），
 * 事务内新建一个全新 style（避开既有 sku 组合碰撞），全程 ROLLBACK，零残留。
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  withErpIsolatedTransaction,
  type ErpDb,
} from './utils/erp-db';
import { SkuService } from '@server/modules/base/sku/sku.service';

const COLOR_GROUP = '477db48e-9a3c-4d63-b9d2-7246762bc44a';
const SIZE_GROUP = 'f0745a6f-f5b6-47fb-aa8e-a7829fddf20c';

async function firstRow(db: ErpDb, query: ReturnType<typeof sql>) {
  const r: any = await db.execute(query);
  const rows = Array.isArray(r) ? r : r?.rows ?? [];
  return rows[0] ?? undefined;
}

describe('P1-3 M4 sku.bulkImport 写入 color_id/size_id', () => {
  it('命中主数据 → color_id/size_id 被写入；未命中 → 留 NULL（不报错、仍插入）', async () => {
    const out = await withErpIsolatedTransaction(async (ctx) => {
      const db = ctx.db;
      const svc: any = new SkuService();
      svc.db = db;

      // 事务内新建一个全新 style（NOT NULL 列：id/style_no/name/color_group_id/size_group_id；
      // attributes/status/lifecycle_status/_created_at/_updated_at 均有默认值）
      const styleNo = `P13STYLE-${Date.now()}`;
      await db.execute(sql`
        INSERT INTO style (id, style_no, name, color_group_id, size_group_id)
        VALUES (gen_random_uuid(), ${styleNo}, ${styleNo}, ${COLOR_GROUP}, ${SIZE_GROUP})
      `);
      const styleRow = await firstRow(db, sql`select id from style where style_no=${styleNo}`);
      const styleId = styleRow?.id;
      expect(styleId).toBeTruthy();

      // 主数据 id（M5 已回填：红/M 存在于 color/size 主表）
      const redRow = await firstRow(db, sql`select id from color where name='红' limit 1`);
      const mRow = await firstRow(db, sql`select id from size where name='M' limit 1`);
      const redId = redRow?.id;
      const mId = mRow?.id;
      expect(redId).toBeTruthy();
      expect(mId).toBeTruthy();

      const codeHit = `P13HIT-${Date.now()}`;
      const codeMiss = `P13MISS-${Date.now()}`;

      // 1) 命中主数据（红/M 都在主数据）
      const r1 = await svc.bulkImport([
        { skuCode: codeHit, styleNo, color: '红', size: 'M' },
      ]);
      // 2) 未命中（荧光绿 不在主数据；M 仍在）
      const r2 = await svc.bulkImport([
        { skuCode: codeMiss, styleNo, color: '荧光绿', size: 'M' },
      ]);

      const hitRow = await firstRow(db, sql`select color_id, size_id from sku where sku_code=${codeHit}`);
      const missRow = await firstRow(db, sql`select color_id, size_id from sku where sku_code=${codeMiss}`);

      return {
        r1Inserted: r1.inserted,
        r1Errors: r1.errors,
        r2Inserted: r2.inserted,
        r2Errors: r2.errors,
        hitColorId: hitRow?.color_id,
        hitSizeId: hitRow?.size_id,
        missColorId: missRow?.color_id,
        missSizeId: missRow?.size_id,
        redId,
        mId,
      };
    });

    expect(out.r1Inserted).toBe(1);
    expect(out.r1Errors).toEqual([]);
    expect(out.r2Inserted).toBe(1);
    expect(out.r2Errors).toEqual([]);

    // 命中：color_id/size_id 等于主数据 id
    expect(out.hitColorId).toBe(out.redId);
    expect(out.hitSizeId).toBe(out.mId);

    // 未命中：宽容——仍插入，color_id 留 NULL（由 varchar 镜像兜底）；size 'M' 命中故 size_id 有值
    expect(out.missColorId).toBeNull();
    expect(out.missSizeId).toBe(out.mId);
  });

  it('sku 复合唯一键已切到 (style_id, color_id, size_id)', async () => {
    const res = await withErpIsolatedTransaction(async (ctx) => {
      const r: any = await ctx.db.execute(sql`
        select
          max(case when indexname='idx_sku_style_color_id_size_id' then 'Y' end) as new_idx,
          max(case when indexname='idx_sku_style_color_size' then 'Y' end) as old_idx
        from pg_indexes where tablename='sku'
      `);
      const rows = Array.isArray(r) ? r : r?.rows ?? [];
      return rows[0];
    });
    expect(res.new_idx).toBe('Y');
    expect(res.old_idx).toBeNull(); // 旧索引已删除
  });
});
