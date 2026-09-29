import { describe, it, expect } from 'vitest';
import { notDeleted, softDelete } from './soft-delete';

describe('notDeleted（软删除过滤，P2-10）', () => {
  it('返回 IS NULL 过滤条件对象', () => {
    const fakeTable = { deletedAt: 'deleted_at_col' };
    const cond = notDeleted(fakeTable);
    expect(cond).toBeTruthy();
    expect(typeof cond).toBe('object');
  });
});

describe('softDelete', () => {
  it('对目标行置 deletedAt 为当前时间并带 where id', async () => {
    const calls: { set?: Record<string, unknown>; where?: unknown } = {};
    const fakeDb = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          calls.set = values;
          return {
            where: (cond: unknown) => {
              calls.where = cond;
              return Promise.resolve();
            },
          };
        },
      }),
    };
    const fakeTable = { id: 'id_col', deletedAt: 'deleted_at_col' };
    await softDelete(fakeDb as never, fakeTable as never, 'abc');
    expect(calls.set).toHaveProperty('deletedAt');
    expect(calls.set!.deletedAt).toBeInstanceOf(Date);
    expect(calls.where).toBeTruthy();
  });
});
