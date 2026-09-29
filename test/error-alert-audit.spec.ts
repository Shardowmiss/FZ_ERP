import { describe, it, expect, beforeAll } from 'vitest';
import { createTestClient, createTestDb, withIsolatedTransaction, raw, type TestDb } from './utils/db';
import { eq } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { supplier, purchaseOrder, rbacUser } from '@server/database/schema';
import { GlobalExceptionFilter } from '@server/common/filters/exception.filter';
import { RbacService } from '@server/modules/rbac/rbac.service';

/**
 * 登录与各模块「新增/保存/修改」异常告警审计
 * ───────────────────────────────────────────────────────────────────
 * 目标：用真实业务数据验证——当新增/保存/修改操作抛异常时，前端业务人员
 * 看到的告警文案是否「具体、可读、可定位」，而不是笼统的「服务器内部错误」。
 *
 * 发现的根因（见 docs/登录与各模块保存修改操作异常告警审计报告.md）：
 *   · 后端大量 `throw new Error('业务中文')` —— 不是 Nest HttpException，
 *     GlobalExceptionFilter 会把它判到 else 分支，返回 500「服务器内部错误」，
 *     原始「订单不存在/会员不存在/SKU不存在」等文案被丢弃，业务人员以为系统故障、运维无法定位。
 *   · 数据库约束冲突（外键23503/唯一23505/非空23502/检查23514）已由 db-constraint
 *     翻译器在上一轮治理中修复为具体 4xx，本测试正向确认它仍生效。
 */

/** 构造一个最小可用的 HTTP host 桩，驱动 GlobalExceptionFilter.catch 并捕获响应。 */
function makeHost() {
  let statusCode = 0;
  let body: unknown = undefined;
  const headers: Record<string, string> = {};
  const response: any = {
    headersSent: false,
    locals: {},
    getHeader: (k: string) => headers[k],
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (c: number) => {
      statusCode = c;
      return response;
    },
    json: (b: unknown) => {
      body = b;
      return response;
    },
  };
  const request: any = { method: 'POST', originalUrl: '/api/audit', headers: {} };
  const host: any = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  };
  return {
    host,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body as { error?: { code?: string; message?: string } };
    },
  };
}

/** 把任意异常喂给过滤器，返回 { status, message, code }。 */
function surface(exception: unknown) {
  const h = makeHost();
  new GlobalExceptionFilter().catch(exception, h.host);
  return { status: h.statusCode, message: h.body?.error?.message, code: h.body?.error?.code };
}

/** 造一个带 Postgres SQLSTATE 字段的原始错误（drizzle/postgres-js 抛出的形状）。 */
function pgError(code: string, detail?: string, constraint?: string, column?: string) {
  const e: any = new Error(`pg error ${code}`);
  e.code = code;
  if (detail) e.detail = detail;
  if (constraint) e.constraint = constraint;
  if (column) e.column = column;
  return e;
}

describe('A. 异常过滤器运行时行为（告警文案是否透出）', () => {
  it('A1) 业务层 throw new Error("订单不存在") → 500 且原始文案丢失（异常告警根因）', () => {
    const r = surface(new Error('订单不存在'));
    expect(r.status).toBe(500);
    expect(r.message).toBe('服务器内部错误');
    expect(r.message).not.toContain('订单不存在'); // 业务中文被吞掉，运维无法定位
  });

  it('A2) 控制器 throw new Error("memberId 必填") → 500 且文案丢失（入参校验也被当故障）', () => {
    const r = surface(new Error('memberId 必填'));
    expect(r.status).toBe(500);
    expect(r.message).toBe('服务器内部错误');
    expect(r.message).not.toContain('memberId');
  });

  it('A3) 外键冲突 23503 → 409 且具体中文「已被…引用」', () => {
    const r = surface(
      pgError(
        '23503',
        'Key (id)=(xxx) is still referenced from table "purchase_order".',
        'purchase_order_supplier_id_fkey',
      ),
    );
    expect(r.status).toBe(409);
    expect(r.message).toContain('引用');
    expect(r.message).toContain('采购订单'); // 表名已翻译为业务名
  });

  it('A4) 唯一冲突 23505 → 409 且「已存在」', () => {
    const r = surface(pgError('23505', 'Key (code)=(SUP-001) already exists.', 'supplier_code_key'));
    expect(r.status).toBe(409);
    expect(r.message).toContain('已存在');
  });

  it('A5) 非空冲突 23502 → 422 且「必填字段…不能为空」', () => {
    const r = surface(pgError('23502', undefined, undefined, 'name'));
    expect(r.status).toBe(422);
    expect(r.message).toBe('必填字段「name」不能为空');
  });

  it('A6) 非法 UUID 22P02 → 404 资源不存在（非 500）', () => {
    const r = surface(pgError('22P02'));
    expect(r.status).toBe(404);
    expect(r.message).toBe('资源不存在');
  });

  it('A7) 登录失败 UnauthorizedException → 401 且文案具体', () => {
    const r = surface(new UnauthorizedException('用户名或密码错误'));
    expect(r.status).toBe(401);
    expect(r.message).toBe('用户名或密码错误');
  });

  it('A8) 入参校验 BadRequestException → 400 且文案具体', () => {
    const r = surface(new BadRequestException('用户名不能为空'));
    expect(r.status).toBe(400);
    expect(r.message).toBe('用户名不能为空');
  });
});

describe('B. 真实业务数据：删除被引用主数据（供应商→采购订单）', () => {
  it('B1) 新增采购订单后删除供应商 → 23503 → 409 具体「已被采购订单引用」', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      const sid = crypto.randomUUID();
      await tx.insert(supplier).values({ id: sid, code: 'SUP-AUDIT', name: '审计供应商' });
      await tx.insert(purchaseOrder).values({
        orderNo: 'PO-AUDIT-001',
        supplierId: sid,
        supplierName: '审计供应商',
        orderDate: '2026-09-25',
      });

      let captured: unknown;
      try {
        await tx.delete(supplier).where(eq(supplier.id, sid));
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeTruthy(); // 真实 FK 拦截了删除

      const r = surface(captured!);
      expect(r.status).toBe(409);
      expect(r.message).toContain('采购订单');
      expect(r.message).toContain('引用');
      expect(r.message).not.toBe('服务器内部错误');
    });
  });
});

describe('C. 真实业务数据：登录异常告警', () => {
  let client: ReturnType<typeof createTestClient>;
  let db: TestDb;

  beforeAll(() => {
    client = createTestClient();
    db = createTestDb(client);
  });

  const seedUser = (tx: TestDb, username: string, password: string) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return tx.insert(rbacUser).values({
      username,
      name: '审计用户',
      passwordHash: `${salt}:${hash}`,
    });
  };

  const loginSurface = async (tx: TestDb, username: string, password: string) => {
    const svc = new RbacService(tx as any);
    let captured: unknown;
    try {
      await svc.login(username, password);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeTruthy();
    return surface(captured!);
  };

  it('C1) 错误密码 → 401 且文案「用户名或密码错误」', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seedUser(tx, 'audit_user', 'RightPwd123');
      const r = await loginSurface(tx, 'audit_user', 'WrongPwd');
      expect(r.status).toBe(401);
      expect(r.message).toBe('用户名或密码错误');
    });
  });

  it('C2) 未知用户 → 401 且文案「用户名或密码错误」', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      const r = await loginSurface(tx, 'nobody_audit', 'any');
      expect(r.status).toBe(401);
      expect(r.message).toBe('用户名或密码错误');
    });
  });

  it('C3) 密码为空 → 400 且文案「密码不能为空」', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seedUser(tx, 'audit_user2', 'RightPwd123');
      const r = await loginSurface(tx, 'audit_user2', '');
      expect(r.status).toBe(400);
      expect(r.message).toBe('密码不能为空');
    });
  });
});
