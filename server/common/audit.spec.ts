import { describe, it, expect, vi } from 'vitest';
import { auditAction, operatorIdFromReq, storeIdFromReq } from './audit';

function makeFakeDb() {
  const inserted: unknown[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db: db as never, inserted };
}

describe('auditAction', () => {
  it('写入 pos_operation_log 且字段正确（含 content 序列化）', async () => {
    const { db, inserted } = makeFakeDb();
    await auditAction(db, {
      storeId: 'store-1',
      employeeId: 'emp-9',
      module: 'sales',
      action: 'create',
      targetNo: 'SO123',
      content: { orderNo: 'SO123', totalAmount: 100 },
    });
    expect(inserted).toHaveLength(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.storeId).toBe('store-1');
    expect(row.employeeId).toBe('emp-9');
    expect(row.module).toBe('sales');
    expect(row.action).toBe('create');
    expect(row.targetNo).toBe('SO123');
    expect(row.content).toBe(JSON.stringify({ orderNo: 'SO123', totalAmount: 100 }));
  });

  it('缺失 storeId/employeeId 归并为 null，无 content 时不写', async () => {
    const { db, inserted } = makeFakeDb();
    await auditAction(db, { module: 'shift', action: 'open' });
    const row = inserted[0] as Record<string, unknown>;
    expect(row.storeId).toBeNull();
    expect(row.employeeId).toBeNull();
    expect(row.content).toBeNull();
    expect(row.targetNo).toBeNull();
  });

  it('审计写入失败时仅告警、不抛出（不阻断主流程）', async () => {
    const throwingDb = {
      insert: () => ({
        values: () => {
          throw new Error('db down');
        },
      }),
    } as never;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      auditAction(throwingDb, { module: 'erp', action: 'toggle' }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('operatorIdFromReq / storeIdFromReq', () => {
  it('优先取 POS 本地登录主体 posUser', () => {
    const req = { posUser: { employeeId: 'e1', storeId: 's1' } } as never;
    expect(operatorIdFromReq(req)).toBe('e1');
    expect(storeIdFromReq(req)).toBe('s1');
  });

  it('posUser 缺失时回退平台 SSO userContext', () => {
    const req = { userContext: { employeeId: 'e2', storeId: 's2', userId: 'u2' } } as never;
    expect(operatorIdFromReq(req)).toBe('e2');
    expect(storeIdFromReq(req)).toBe('s2');
  });

  it('均无主体时返回 null', () => {
    expect(operatorIdFromReq({} as never)).toBeNull();
    expect(storeIdFromReq({} as never)).toBeNull();
  });
});
