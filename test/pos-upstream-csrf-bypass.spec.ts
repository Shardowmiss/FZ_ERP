import 'reflect-metadata';
import { describe, it, expect, afterEach } from 'vitest';
import { PosUpstreamCsrfBypassMiddleware } from '@server/middleware/pos-upstream-csrf-bypass';

function makeReq(path: string, headers: Record<string, string> = {}) {
  return {
    originalUrl: path,
    headers: { ...headers },
    cookies: {} as Record<string, string>,
  } as any;
}

const ORIGINAL = process.env.ERP_UPSTREAM_TOKEN;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ERP_UPSTREAM_TOKEN;
  else process.env.ERP_UPSTREAM_TOKEN = ORIGINAL;
});

describe('PosUpstreamCsrfBypassMiddleware（D.1 加固：先校验机器令牌再豁免 CSRF）', () => {
  const DUMMY = '__pos_upstream_machine_call__';

  it('非 /api/pos-receiver 路径：不注入、直接放行', () => {
    const mw = new PosUpstreamCsrfBypassMiddleware();
    const req = makeReq('/api/style/list', { 'x-erp-upstream-token': 'secret' });
    let nextCalled = false;
    mw.use(req, {} as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.headers['x-suda-csrf-token']).toBeUndefined();
    expect(req.cookies['suda-csrf-token']).toBeUndefined();
  });

  it('pos-receiver + 正确令牌：注入一致的 dummy CSRF 凭据', () => {
    process.env.ERP_UPSTREAM_TOKEN = 'secret-token';
    const mw = new PosUpstreamCsrfBypassMiddleware();
    const req = makeReq('/api/pos-receiver/transfer-requests', {
      'x-erp-upstream-token': 'secret-token',
    });
    let nextCalled = false;
    mw.use(req, {} as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.headers['x-suda-csrf-token']).toBe(DUMMY);
    expect(req.cookies['suda-csrf-token']).toBe(DUMMY);
    expect(String(req.headers['cookie'])).toContain(`suda-csrf-token=${DUMMY}`);
  });

  it('pos-receiver + 缺失令牌：不放行 CSRF 豁免（交由平台 403 / guard 401）', () => {
    process.env.ERP_UPSTREAM_TOKEN = 'secret-token';
    const mw = new PosUpstreamCsrfBypassMiddleware();
    const req = makeReq('/api/pos-receiver/eods', {});
    let nextCalled = false;
    mw.use(req, {} as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.headers['x-suda-csrf-token']).toBeUndefined();
  });

  it('pos-receiver + 错误令牌：不放行 CSRF 豁免', () => {
    process.env.ERP_UPSTREAM_TOKEN = 'secret-token';
    const mw = new PosUpstreamCsrfBypassMiddleware();
    const req = makeReq('/api/pos-receiver/eods', {
      'x-erp-upstream-token': 'wrong-token',
    });
    let nextCalled = false;
    mw.use(req, {} as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.headers['x-suda-csrf-token']).toBeUndefined();
  });

  it('未配置 ERP_UPSTREAM_TOKEN：不放行 CSRF 豁免（fail closed）', () => {
    delete process.env.ERP_UPSTREAM_TOKEN;
    const mw = new PosUpstreamCsrfBypassMiddleware();
    const req = makeReq('/api/pos-receiver/eods', {
      'x-erp-upstream-token': 'anything',
    });
    let nextCalled = false;
    mw.use(req, {} as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.headers['x-suda-csrf-token']).toBeUndefined();
  });
});
