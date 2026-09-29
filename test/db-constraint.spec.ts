import { describe, it, expect } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { translateDbConstraintError } from '@server/common/errors/db-constraint';

/**
 * 验证数据库约束冲突 → 具体中文报错的翻译逻辑。
 * 这是「减少简单粗暴报错」的根因修复：原先 23503/23505/23514/23502 会被当成 500「服务器内部错误」。
 */
describe('translateDbConstraintError', () => {
  it('23503 外键冲突（被款号引用）→ 具体中文 + CONFLICT', () => {
    const r = translateDbConstraintError({
      code: '23503',
      constraint: 'style_brand_code_fkey',
      detail: 'Key (brand_code)=(NIKE) is still referenced from table "style".',
    });
    expect(r).not.toBeNull();
    expect(r!.code).toBe('CONFLICT');
    expect(r!.httpStatus).toBe(HttpStatus.CONFLICT);
    expect(r!.message).toContain('款号');
    expect(r!.message).toContain('不允许');
  });

  it('23503 未在映射表里的外键 → 用引用表中文名兜底', () => {
    const r = translateDbConstraintError({
      code: '23503',
      constraint: 'garment_purchase_inbound_sku_inbound_id_fkey',
      detail: 'Key (inbound_id)=(x) is still referenced from table "garment_purchase_inbound".',
    });
    expect(r!.message).toContain('成衣入库单');
    expect(r!.message).toContain('不允许');
  });

  it('23505 唯一约束 → 具体中文', () => {
    const r = translateDbConstraintError({
      code: '23505',
      constraint: 'uk_style_attr_type_code',
      detail: 'Key (attr_type, attr_code)=(brand, NIKE) already exists.',
    });
    expect(r!.code).toBe('CONFLICT');
    expect(r!.message).toContain('已存在');
  });

  it('23514 检查约束 → 具体中文 + VALIDATION_ERROR', () => {
    const r = translateDbConstraintError({ code: '23514', constraint: 'chk_amount_positive' });
    expect(r!.code).toBe('VALIDATION_ERROR');
    expect(r!.httpStatus).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(r!.message).toContain('业务规则');
  });

  it('23502 非空约束 → 指明列', () => {
    const r = translateDbConstraintError({ code: '23502', column: 'supplier_id' });
    expect(r!.code).toBe('VALIDATION_ERROR');
    expect(r!.message).toContain('supplier_id');
    expect(r!.message).toContain('不能为空');
  });

  it('非约束类错误 → 返回 null（交由过滤器其它分支处理）', () => {
    expect(translateDbConstraintError({ code: '42P01' })).toBeNull();
    expect(translateDbConstraintError(null)).toBeNull();
    expect(translateDbConstraintError('not an object')).toBeNull();
  });
});
