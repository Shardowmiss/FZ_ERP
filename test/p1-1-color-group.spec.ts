/**
 * P1-1 / M1：颜色组关系化（color_group_color 关联表为组关系单一真相）。
 *
 * 复用 E.1 harness（test/utils/erp-db.ts）直连 erp_db，事务 ROLLBACK 隔离。
 * 每个用例在事务内播种 color 主数据，验证 create/update 写入关联表、由关联表重建
 * jsonb 镜像、以及一致性断言（assertColorsConsistent）既能在正常路径通过，
 * 也能探测「jsonb 与关联表不一致」的脏数据。
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ColorGroupService } from '@server/modules/base/color-group/color-group.service';
import { color, colorGroup, colorGroupColor } from '@server/database/schema';
import { withErpIsolatedTransaction, raw } from './utils/erp-db';

function makeSvc(db: any): ColorGroupService {
  return Object.assign(new ColorGroupService(), { db });
}

async function seedColors(db: any) {
  await db.insert(color).values([
    { code: 'P1RED', name: '红', hex: '#FF0000' },
    { code: 'P1BLUE', name: '蓝', hex: '#0000FF' },
  ]);
}

describe('P1-1 M1 颜色组关系化（color_group_color 为单一真相）', () => {
  it('create 写入关联表 + 重建 jsonb 镜像 + 一致性通过', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedColors(db);
      const svc = makeSvc(db);

      const created = await svc.create({
        code: 'CG-P1-1',
        name: '测试颜色组',
        colors: [
          { name: '红', value: 'P1RED' },
          { name: '蓝', value: 'P1BLUE' },
        ],
      });

      // 1) 关联表应写入 2 行
      const junction = await svc.listColorMembers(created.id);
      expect(junction).toHaveLength(2);
      expect(junction.map((r) => r.colorCode).sort()).toEqual(['P1BLUE', 'P1RED']);

      // 2) jsonb 镜像由关联表重建，与入参逐序一致
      expect(created.colors).toEqual([
        { name: '红', value: 'P1RED' },
        { name: '蓝', value: 'P1BLUE' },
      ]);

      // 3) 一致性断言通过（不抛）
      const ok = await svc.assertColorsConsistent(created.id, false);
      expect(ok).toBe(true);

      // 4) 物理表确有 2 行（证明关联表真的落地）
      const cnt = await db.execute(
        raw`select count(*)::int as c from color_group_color where color_group_id = ${created.id}`,
      );
      expect(Number((cnt as any)[0].c)).toBe(2);
    });
  });

  it('update 全量替换成员：关联表与 jsonb 同步收敛', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedColors(db);
      const svc = makeSvc(db);

      const g = await svc.create({
        code: 'CG-P1-2',
        name: '组2',
        colors: [
          { name: '红', value: 'P1RED' },
          { name: '蓝', value: 'P1BLUE' },
        ],
      });

      const updated = await svc.update(g.id, {
        colors: [{ name: '红', value: 'P1RED' }],
      });

      const junction = await svc.listColorMembers(updated.id);
      expect(junction).toHaveLength(1);
      expect(updated.colors).toEqual([{ name: '红', value: 'P1RED' }]);
      expect(await svc.assertColorsConsistent(updated.id, false)).toBe(true);
    });
  });

  it('update 清空成员：关联表置空、jsonb 置 []', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedColors(db);
      const svc = makeSvc(db);
      const g = await svc.create({
        code: 'CG-P1-3',
        name: '组3',
        colors: [{ name: '红', value: 'P1RED' }],
      });

      const updated = await svc.update(g.id, { colors: [] });
      expect(updated.colors).toEqual([]);
      expect(await svc.listColorMembers(updated.id)).toHaveLength(0);
    });
  });

  it('一致性探测：手动让 jsonb 偏离关联表 → assertColorsConsistent 报不一致', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedColors(db);
      const svc = makeSvc(db);
      const g = await svc.create({
        code: 'CG-P1-4',
        name: '组4',
        colors: [{ name: '红', value: 'P1RED' }],
      });

      // 仅篡改 jsonb（不动关联表），模拟历史脏数据
      await db.execute(
        raw`update color_group set colors = '[{"name":"脏","value":"OTHER"}]'::jsonb where id = ${g.id}`,
      );

      expect(await svc.assertColorsConsistent(g.id, false)).toBe(false);
      await expect(svc.assertColorsConsistent(g.id, true)).rejects.toThrow(BadRequestException);
    });
  });

  it('收口强约束：colors 中出现主数据不存在的编码 → 直接 BadRequest 拦截', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedColors(db);
      const svc = makeSvc(db);
      await expect(
        svc.create({
          code: 'CG-P1-5',
          name: '组5',
          colors: [{ name: '幽灵色', value: 'P1GHOST' }],
        }),
      ).rejects.toThrow(/在主数据中不存在/);
    });
  });
});
