import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ErpCsrfGuard } from '@server/common/guards/erp-csrf.guard';
import { signErpCsrfToken } from '@server/common/security/erp-csrf.util';

beforeAll(() => {
  process.env.ERP_CSRF_SIGNING_SECRET = 'test-secret-at-least-16-bytes!!';
});

function makeCtx(opts: {
  method?: string;
  url?: string;
  isPublic?: boolean;
  cookie?: string;
  header?: string;
}) {
  const req: any = {
    method: opts.method ?? 'POST',
    originalUrl: opts.url ?? '/api/style',
    cookies: opts.cookie ? { 'erp-csrf': opts.cookie } : {},
    headers: opts.header ? { 'x-erp-csrf': opts.header } : {},
  };
  const reflector: any = {
    getAllAndOverride: () => opts.isPublic ?? false,
  };
  const ctx: any = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { guard: new ErpCsrfGuard(reflector), ctx };
}

describe('ErpCsrfGuard（D.1 自签 CSRF 守卫）', () => {
  it('只读 GET → 放行', () => {
    const { guard, ctx } = makeCtx({ method: 'GET', url: '/api/style' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Public() POST（如登录）→ 放行', () => {
    const { guard, ctx } = makeCtx({
      method: 'POST',
      url: '/api/auth/login',
      isPublic: true,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('/api/pos-receiver 机器端点 → 放行（由 UpstreamTokenGuard 负责）', () => {
    const { guard, ctx } = makeCtx({
      method: 'POST',
      url: '/api/pos-receiver/eods',
      cookie: 'x',
      header: 'x',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('有效令牌（cookie===header 且签名有效）→ 放行', () => {
    const token = signErpCsrfToken();
    const { guard, ctx } = makeCtx({
      method: 'POST',
      url: '/api/style',
      cookie: token,
      header: token,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('缺令牌 → 403', () => {
    const { guard, ctx } = makeCtx({ method: 'POST', url: '/api/style' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('cookie 与 header 不一致 → 403', () => {
    const token = signErpCsrfToken();
    const { guard, ctx } = makeCtx({
      method: 'POST',
      url: '/api/style',
      cookie: token,
      header: 'different',
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('签名无效令牌 → 403', () => {
    const token = signErpCsrfToken();
    const [p] = token.split('.');
    const forged = `${p}.${'a'.repeat(43)}`;
    const { guard, ctx } = makeCtx({
      method: 'POST',
      url: '/api/style',
      cookie: forged,
      header: forged,
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
