import { vi, describe, it, expect } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MasterDataService } from './master-data.service';
import { posStyle } from '@server/database/schema';

// 桩掉平台解耦门面：drizzle-tokens 会 import @lark-apaas/nestjs-common，
// 测试环境下该平台模块导出不可用，会触发模块加载期 SyntaxError。
// 本测试直接 new MasterDataService(fakeDb)，不需要真实的注入 token。
vi.mock('@server/database/drizzle-tokens', () => ({
  DRIZZLE_DATABASE: 'DRIZZLE_DATABASE',
}));

/** 构造一个仅记录调用、可控「是否存在」的 fake drizzle db（替代注入的 rawDb）。 */
function makeFakeDb(opts: { exists?: boolean } = {}) {
  const calls: Array<[string, unknown]> = [];
  const db = {
    update: (table: unknown) => {
      calls.push(['update', table]);
      return {
        set: (v: unknown) => {
          calls.push(['set', v]);
          return {
            where: (c: unknown) => {
              calls.push(['where', c]);
              return Promise.resolve();
            },
          };
        },
      };
    },
    execute: (sqlChunk: unknown) => {
      calls.push(['execute', sqlChunk]);
      // 存在性查询：exists=false 时返回空数组 → 触发 NotFound
      return Promise.resolve(opts.exists === false ? [] : [{ ok: 1 }]);
    },
    insert: (table: unknown) => {
      calls.push(['insert', table]);
      return {
        values: (v: unknown) => {
          calls.push(['values', v]);
          return Promise.resolve();
        },
      };
    },
  };
  return { db: db as never, calls };
}

describe('MasterDataService 软删除删除端点', () => {
  it('softDeleteMaster：存在时置位 deletedAt 并写审计', async () => {
    const { db, calls } = makeFakeDb({ exists: true });
    const svc = new MasterDataService(db);

    const res = await svc.softDeleteMaster('style', 'style-1', 'op-1');

    expect(res.success).toBe(true);
    expect(res.type).toBe('style');
    expect(res.id).toBe('style-1');
    expect(typeof res.deletedAt).toBe('string');
    // softDelete 内部走了 update().set({deletedAt}).where(eq)
    expect(calls.some(([op]) => op === 'update')).toBe(true);
    expect(calls.some(([op]) => op === 'insert')).toBe(true); // 审计日志
  });

  it('softDeleteMaster：不存在时抛 NotFoundException(404)', async () => {
    const { db } = makeFakeDb({ exists: false });
    const svc = new MasterDataService(db);

    await expect(svc.softDeleteMaster('style', 'nope', 'op-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('softDeleteMaster：非法主数据类型抛 BadRequestException(400)', async () => {
    const { db } = makeFakeDb({ exists: true });
    const svc = new MasterDataService(db);

    await expect(svc.softDeleteMaster('not-a-type', 'x', 'op-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('restoreMaster：存在时穿透拦截器清空 deletedAt（执行原始 UPDATE）', async () => {
    const { db, calls } = makeFakeDb({ exists: true });
    const svc = new MasterDataService(db);

    const res = await svc.restoreMaster('style', 'style-1', 'op-1');

    expect(res.success).toBe(true);
    expect(res.id).toBe('style-1');
    // 恢复走 raw execute（UPDATE ... SET deleted_at = NULL），而非软删除 update().set()
    const executed = calls.filter(([op]) => op === 'execute');
    expect(executed.length).toBeGreaterThanOrEqual(1);
    expect(calls.some(([op]) => op === 'insert')).toBe(true); // 审计日志
  });

  it('restoreMaster：不存在时抛 NotFoundException(404)', async () => {
    const { db } = makeFakeDb({ exists: false });
    const svc = new MasterDataService(db);

    await expect(svc.restoreMaster('style', 'nope', 'op-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('类型映射覆盖 8 类主数据（store/coupon/member/employee/sku/style/size/color）', async () => {
    const expected = [
      'store',
      'coupon',
      'member',
      'employee',
      'sku',
      'style',
      'size',
      'color',
    ];
    expect(posStyle).toBeDefined(); // 确保依赖可用
    // 合法类型在 fake db(exists=true) 下应 resolve（即未抛 BadRequest）
    for (const t of expected) {
      const { db } = makeFakeDb({ exists: true });
      const svc = new MasterDataService(db);
      await expect(svc.softDeleteMaster(t, 'x', 'op-1')).resolves.toBeDefined();
    }
  });
});
