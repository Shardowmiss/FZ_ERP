import { describe, it, expect, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from '@server/common/filters/exception.filter';

/**
 * 验证 GlobalExceptionFilter 真正把数据库约束冲突翻译成具体中文 + 4xx，
 * 而不是像旧实现那样一律落到 500「服务器内部错误」。
 * 这是对「减少简单粗暴报错」根因修复的回归护栏。
 */
function makeHost(exception: unknown) {
  const response: any = {
    headersSent: false,
    statusCode: 200,
    locals: {},
    body: undefined,
    getHeader: () => undefined,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const req: any = { method: 'POST', originalUrl: '/test', headers: {} };
  const host: any = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => response,
    }),
  };
  const filter = new GlobalExceptionFilter();
  filter.catch(exception, host);
  return response as { statusCode: number; body: { error?: { code?: string; message?: string } } };
}

describe('GlobalExceptionFilter 数据库约束翻译', () => {
  it('23503 外键冲突 → 409 + 具体中文（不再 500）', () => {
    const res = makeHost({
      code: '23503',
      constraint: 'style_brand_code_fkey',
      detail: 'Key (brand_code)=(NIKE) is still referenced from table "style".',
      message: 'update or delete violates foreign key constraint',
    });
    expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    expect(res.body.error?.code).toBe('CONFLICT');
    expect(res.body.error?.message).toContain('款号');
    expect(res.body.error?.message).toContain('不允许');
  });

  it('23505 唯一冲突 → 409 + 「已存在」', () => {
    const res = makeHost({
      code: '23505',
      constraint: 'uk_style_attr_type_code',
      detail: 'Key (attr_type, attr_code)=(brand, NIKE) already exists.',
    });
    expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    expect(res.body.error?.code).toBe('CONFLICT');
    expect(res.body.error?.message).toContain('已存在');
  });

  it('23502 非空约束 → 422 + 指明列', () => {
    const res = makeHost({ code: '23502', column: 'supplier_id' });
    expect(res.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(res.body.error?.message).toContain('supplier_id');
  });

  it('22P02 仍走 not-found，不被约束分支拦截', () => {
    const res = makeHost({ code: '22P02', message: 'invalid input syntax for type uuid' });
    expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });

  it('未知非约束错误 → 仍 500（保持安全兜底）', () => {
    const res = makeHost(new Error('boom'));
    expect(res.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.body.error?.code).toBe('INTERNAL_ERROR');
  });
});
