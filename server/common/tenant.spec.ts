import { describe, it, expect } from 'vitest';
import {
  principalFromReq,
  resolveStoreId,
  enforceStoreScope,
  isCrossStore,
  throwIfStoreMismatch,
  roleSatisfied,
} from './tenant';
import type { AuthPrincipal } from '../modules/auth/auth.service';

function principal(over: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    employeeId: 'e1',
    name: '张三',
    role: 'sales',
    storeId: 'store-A',
    code: 'A001',
    ...over,
  };
}

describe('principalFromReq', () => {
  it('优先取 POS 本地登录主体 posUser', () => {
    const req = { posUser: principal({ storeId: 'store-A' }) } as never;
    expect(principalFromReq(req)?.storeId).toBe('store-A');
  });

  it('posUser 缺失时回退平台 SSO userContext 并映射字段', () => {
    const req = {
      userContext: { employeeId: 'e2', userId: 'u2', storeId: 'store-B', role: 'manager' },
    } as never;
    const p = principalFromReq(req);
    expect(p?.storeId).toBe('store-B');
    expect(p?.employeeId).toBe('e2');
    expect(p?.role).toBe('manager');
  });

  it('均无主体时返回 null', () => {
    expect(principalFromReq({} as never)).toBeNull();
    expect(principalFromReq(null)).toBeNull();
  });
});

describe('resolveStoreId（写接口门店归属）', () => {
  it('优先使用主体门店，忽略客户端 storeId', () => {
    expect(resolveStoreId(principal({ storeId: 'store-A' }), 'store-EVIL')).toBe('store-A');
  });

  it('主体无门店绑定但提供回退值时允许回退', () => {
    expect(resolveStoreId(principal({ storeId: null }), 'store-FB')).toBe('store-FB');
  });

  it('主体与回退值均无门店时抛错', () => {
    expect(() => resolveStoreId(principal({ storeId: null }), '')).toThrow();
    expect(() => resolveStoreId(null)).toThrow();
  });
});

describe('enforceStoreScope（列表查询门店强制作用域）', () => {
  it('主体已绑定门店时强制使用主体门店，忽略客户端越权 storeId', () => {
    const r = enforceStoreScope(principal({ storeId: 'store-A' }), 'store-B');
    expect(r).toBe('store-A');
  });

  it('跨店主体（storeId 为空）允许按客户端 storeId 查询', () => {
    const r = enforceStoreScope(principal({ storeId: null }), 'store-B');
    expect(r).toBe('store-B');
  });

  it('跨店主体未提供 storeId 时抛错', () => {
    expect(() => enforceStoreScope(principal({ storeId: null }), '')).toThrow();
  });
});

describe('isCrossStore / throwIfStoreMismatch', () => {
  it('store-scoped 主体判定为非跨店', () => {
    expect(isCrossStore(principal({ storeId: 'store-A' }))).toBe(false);
  });

  it('storeId 为空判定为跨店', () => {
    expect(isCrossStore(principal({ storeId: null }))).toBe(true);
  });

  it('store-scoped 主体访问他店数据时抛 Forbidden', () => {
    expect(() => throwIfStoreMismatch(principal({ storeId: 'store-A' }), 'store-B')).toThrow();
  });

  it('store-scoped 主体访问本店数据放行', () => {
    expect(() => throwIfStoreMismatch(principal({ storeId: 'store-A' }), 'store-A')).not.toThrow();
  });

  it('跨店主体放行', () => {
    expect(() => throwIfStoreMismatch(principal({ storeId: null }), 'store-B')).not.toThrow();
  });
});

describe('roleSatisfied（P1-3 RBAC 角色判定）', () => {
  it('admin 超管对任意声明角色放行', () => {
    expect(roleSatisfied(principal({ role: 'admin' }), ['manager'])).toBe(true);
    expect(roleSatisfied(principal({ role: 'admin' }), ['admin', 'manager'])).toBe(true);
  });

  it('命中声明角色放行', () => {
    expect(roleSatisfied(principal({ role: 'manager' }), ['admin', 'manager'])).toBe(true);
  });

  it('非命中角色拒绝', () => {
    expect(roleSatisfied(principal({ role: 'sales' }), ['admin', 'manager'])).toBe(false);
  });

  it('supervisor 督导非店长角色被拒（仅 admin/manager 可操作敏感写）', () => {
    expect(roleSatisfied(principal({ role: 'supervisor' }), ['admin', 'manager'])).toBe(false);
  });

  it('纯函数：空角色数组时按超管语义判定（admin 放行、非 admin 拒绝；AuthGuard 实际以 requiredRoles?.length 短路，不会借此拒绝未声明端点）', () => {
    expect(roleSatisfied(principal({ role: 'sales' }), [])).toBe(false);
    expect(roleSatisfied(principal({ role: 'admin' }), [])).toBe(true);
  });

  it('主体为空时拒绝', () => {
    expect(roleSatisfied(null, ['admin', 'manager'])).toBe(false);
  });
});
