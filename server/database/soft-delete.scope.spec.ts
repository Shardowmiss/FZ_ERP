import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { scopeDatabase } from './soft-delete';

/**
 * 用最小 fake drizzle 验证全局软删除作用域（scopeDatabase）的注入契约：
 * - 带 deletedAt 的表：select/update/delete 自动补 `deletedAt IS NULL`（无论是否显式 where）；
 * - 不带 deletedAt 的表：不加过滤；
 * - insert：完全透传，不加过滤；
 * - 事务内 tx 同样被作用域包裹。
 */

const softTable = { deletedAt: 'deleted_at', id: 'id' } as unknown as { deletedAt: unknown };
const plainTable = { id: 'id' } as unknown as { deletedAt: unknown };

function makeFakeDb() {
  const calls = { where: [] as unknown[], txWhere: [] as unknown[] };

  const makeBuilder = (whereArr: unknown[]) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.where = (c: unknown) => {
      whereArr.push(c);
      return b;
    };
    b.select = chain;
    b.selectDistinct = chain;
    b.from = chain;
    b.update = chain;
    b.delete = chain;
    b.insert = chain;
    b.set = chain;
    b.values = chain;
    b.returning = chain;
    b.orderBy = chain;
    b.limit = chain;
    b.offset = chain;
    b.innerJoin = chain;
    b.execute = () => Promise.resolve([]);
    b.get = () => Promise.resolve([]);
    b.all = () => Promise.resolve([]);
    b.run = () => Promise.resolve();
    b.then = (onF?: unknown, onR?: unknown) =>
      Promise.resolve([]).then(onF as never, onR as never);
    return b;
  };

  const db = {
    select: () => makeBuilder(calls.where),
    selectDistinct: () => makeBuilder(calls.where),
    update: () => makeBuilder(calls.where),
    delete: () => makeBuilder(calls.where),
    insert: () => makeBuilder(calls.where),
    execute: () => Promise.resolve([]),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      // 真实 drizzle 会把「原始 tx」交给 cb；scopeDatabase 已在入口包裹它
      const tx = makeBuilder(calls.txWhere);
      return cb(tx as never);
    },
  };

  return { db: db as never, calls };
}

describe('scopeDatabase（全局软删除拦截器，P2-10 进阶）', () => {
  it('select 软删表且无显式 where：自动补 1 条 notDeleted', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).select().from(softTable);
    expect(calls.where).toHaveLength(1);
  });

  it('select 软删表且显式 where：包裹为 1 条（and(原条件, notDeleted)）', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).select().from(softTable).where(eq(softTable.id, 'x'));
    expect(calls.where).toHaveLength(1);
  });

  it('select 普通表（无 deletedAt）：不加过滤', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).select().from(plainTable);
    expect(calls.where).toHaveLength(0);
  });

  it('update 软删表：自动补 notDeleted', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).update(softTable).set({ id: 'x' });
    expect(calls.where).toHaveLength(1);
  });

  it('delete 软删表：自动补 notDeleted', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).delete(softTable);
    expect(calls.where).toHaveLength(1);
  });

  it('insert 软删表：完全透传，不加过滤', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).insert(softTable).values({ id: 'x' });
    expect(calls.where).toHaveLength(0);
  });

  it('select 软删表 + orderBy：仍只注入 1 条 notDeleted', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).select().from(softTable).where(eq(softTable.id, 'x')).orderBy(softTable.id);
    expect(calls.where).toHaveLength(1);
  });

  it('transaction 内的 tx 同样被作用域包裹', async () => {
    const { db, calls } = makeFakeDb();
    await scopeDatabase(db).transaction(async (tx) => {
      await (tx as never as ReturnType<typeof scopeDatabase>).select().from(softTable);
    });
    expect(calls.txWhere).toHaveLength(1);
  });
});
