/**
 * P1-1 / M2：尺码组双写校验（size_group_size 关联表为组关系单一真相，jsonb.sizes 为派生镜像）。
 *
 * 复用 E.1 harness 直连 erp_db，事务 ROLLBACK 隔离。
 * 关键验证：
 *   · 修复旧 bug —— create 带 sizes 时「新建即写入关联表」（此前只写 jsonb、关联表为空）；
 *   · create/update 由关联表重建 jsonb，assertSizesConsistent 通过；
 *   · addMember/removeMember 维护关联表并重建 jsonb；
 *   · 一致性探测：jsonb 偏离关联表 → assertSizesConsistent 报不一致（脏数据守卫）。
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SizeGroupService } from '@server/modules/base/size-group/size-group.service';
import { size, sizeGroup, sizeGroupSize } from '@server/database/schema';
import { withErpIsolatedTransaction, raw } from './utils/erp-db';

function makeSvc(db: any): SizeGroupService {
  return Object.assign(new SizeGroupService(), { db });
}

async function seedSizes(db: any) {
  await db.insert(size).values([
    { code: 'P1S', name: 'S' },
    { code: 'P1M', name: 'M' },
    { code: 'P1L', name: 'L' },
  ]);
}

describe('P1-1 M2 尺码组双写校验（size_group_size 为单一真相）', () => {
  it('create 修复旧 bug：带 sizes 时关联表被写入（不再只有 jsonb）', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedSizes(db);
      const svc = makeSvc(db);

      const created = await svc.create({
        code: 'SG-P1-1',
        name: '测试尺码组',
        sizes: ['P1S', 'P1M', 'P1L'],
      });

      // 关联表应有 3 行（旧实现此处为 0 —— 这就是被修的 bug）
      const members = await svc.listMembers(created.id);
      expect(members).toHaveLength(3);
      expect(members.map((m) => m.sizeCode)).toEqual(['P1S', 'P1M', 'P1L']);

      // jsonb 镜像由关联表重建
      expect(created.sizes).toEqual(['P1S', 'P1M', 'P1L']);
      expect(await svc.assertSizesConsistent(created.id, false)).toBe(true);

      const cnt = await db.execute(
        raw`select count(*)::int as c from size_group_size where size_group_id = ${created.id}`,
      );
      expect(Number((cnt as any)[0].c)).toBe(3);
    });
  });

  it('update 全量替换成员：关联表与 jsonb 同步收敛', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedSizes(db);
      const svc = makeSvc(db);

      const g = await svc.create({ code: 'SG-P1-2', name: '组2', sizes: ['P1S', 'P1M', 'P1L'] });
      const updated = await svc.update(g.id, { sizes: ['P1M', 'P1L'] });

      const members = await svc.listMembers(updated.id);
      expect(members.map((m) => m.sizeCode)).toEqual(['P1M', 'P1L']);
      expect(updated.sizes).toEqual(['P1M', 'P1L']);
      expect(await svc.assertSizesConsistent(updated.id, false)).toBe(true);
    });
  });

  it('addMember / removeMember：维护关联表并重建 jsonb 镜像', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedSizes(db);
      const svc = makeSvc(db);

      const g = await svc.create({ code: 'SG-P1-3', name: '组3', sizes: ['P1S'] });

      // 取 P1M 的 id
      const mRows = await db.select().from(size).where(raw`${size.code} = 'P1M'`);
      const mId = mRows[0].id;

      const afterAdd = await svc.addMember(g.id, mId);
      expect(afterAdd.map((m) => m.sizeCode)).toEqual(['P1S', 'P1M']);
      expect((await svc.detail(g.id)).sizes).toEqual(['P1S', 'P1M']);
      expect(await svc.assertSizesConsistent(g.id, false)).toBe(true);

      const afterRemove = await svc.removeMember(g.id, mId);
      expect(afterRemove.map((m) => m.sizeCode)).toEqual(['P1S']);
      expect((await svc.detail(g.id)).sizes).toEqual(['P1S']);
    });
  });

  it('一致性探测：手动让 jsonb 偏离关联表 → assertSizesConsistent 报不一致', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedSizes(db);
      const svc = makeSvc(db);
      const g = await svc.create({ code: 'SG-P1-4', name: '组4', sizes: ['P1S', 'P1M'] });

      // 仅篡改 jsonb（不动关联表）
      await db.execute(
        raw`update size_group set sizes = '["P1S","P1GHOST"]'::jsonb where id = ${g.id}`,
      );

      expect(await svc.assertSizesConsistent(g.id, false)).toBe(false);
      await expect(svc.assertSizesConsistent(g.id, true)).rejects.toThrow(BadRequestException);
    });
  });

  it('收口强约束：sizes 中出现主数据不存在的尺码 → 直接 BadRequest 拦截', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      await seedSizes(db);
      const svc = makeSvc(db);
      await expect(
        svc.create({ code: 'SG-P1-5', name: '组5', sizes: ['P1GHOST'] }),
      ).rejects.toThrow(/在主数据中不存在/);
    });
  });
});
