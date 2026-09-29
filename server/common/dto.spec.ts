import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import {
  CreateSaleOrderDto,
  SaleItemDto,
  SalePaymentDto,
  CreateReturnOrderDto,
  ReturnItemDto,
  StockAdjustDto,
  RechargeDto,
  AdjustStoredValueDto,
  IssueCouponDto,
  OfflineSyncBatchDto,
  OfflineSyncItemDto,
} from './dto';

const validSaleItem = (): SaleItemDto => {
  const i = new SaleItemDto();
  i.skuId = 'S1';
  i.styleId = 'ST1';
  i.styleName = 'T恤';
  i.colorId = 'C1';
  i.sizeId = 'S';
  i.qty = 2;
  i.tagPrice = 100;
  i.unitPrice = 100;
  i.discountAmount = 0;
  i.lineAmount = 200;
  return i;
};

const validPayment = (): SalePaymentDto => {
  const p = new SalePaymentDto();
  p.payMethod = 'cash';
  p.amount = 200;
  p.changeAmount = 0;
  return p;
};

describe('CreateSaleOrderDto', () => {
  it('合法单据通过', async () => {
    const dto = new CreateSaleOrderDto();
    dto.storeId = 'HZ-001';
    dto.items = [validSaleItem()];
    dto.payments = [validPayment()];
    const errs = await validate(dto);
    expect(errs).toHaveLength(0);
  });

  it('金额为负被拒', async () => {
    const dto = new CreateSaleOrderDto();
    dto.storeId = 'HZ-001';
    const item = validSaleItem();
    item.lineAmount = -5;
    dto.items = [item];
    dto.payments = [validPayment()];
    const errs = await validate(dto);
    expect(errs.length).toBeGreaterThan(0);
  });

  it('明细缺失 skuId 被拒', async () => {
    const dto = new CreateSaleOrderDto();
    dto.storeId = 'HZ-001';
    const item = validSaleItem();
    item.skuId = '';
    dto.items = [item];
    dto.payments = [validPayment()];
    const errs = await validate(dto);
    expect(errs.length).toBeGreaterThan(0);
  });

  it('空明细数组被拒（至少一笔）', async () => {
    const dto = new CreateSaleOrderDto();
    dto.storeId = 'HZ-001';
    dto.items = [];
    dto.payments = [validPayment()];
    const errs = await validate(dto);
    expect(errs.length).toBeGreaterThan(0);
  });

  it('嵌套明细数量非正整数被拒', async () => {
    const dto = new CreateSaleOrderDto();
    dto.storeId = 'HZ-001';
    const item = validSaleItem();
    item.qty = 0;
    dto.items = [item];
    dto.payments = [validPayment()];
    const errs = await validate(dto);
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('CreateReturnOrderDto', () => {
  it('合法退货单通过', async () => {
    const dto = new CreateReturnOrderDto();
    dto.storeId = 'HZ-001';
    dto.originalOrderNo = 'XS123';
    dto.refundMethod = 'original';
    const it = new ReturnItemDto();
    it.originalItemId = 'OI1';
    it.skuId = 'S1';
    it.styleId = 'ST1';
    it.styleName = 'T恤';
    it.colorId = 'C1';
    it.sizeId = 'S';
    it.qty = 1;
    it.refundPrice = 100;
    it.lineAmount = 100;
    dto.items = [it];
    expect(await validate(dto)).toHaveLength(0);
  });

  it('缺少原单号被拒', async () => {
    const dto = new CreateReturnOrderDto();
    dto.storeId = 'HZ-001';
    dto.refundMethod = 'original';
    const it = new ReturnItemDto();
    it.originalItemId = 'OI1';
    it.skuId = 'S1';
    it.styleId = 'ST1';
    it.styleName = 'T恤';
    it.colorId = 'C1';
    it.sizeId = 'S';
    it.qty = 1;
    it.refundPrice = 100;
    it.lineAmount = 100;
    dto.items = [it];
    const errs = await validate(dto);
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('StockAdjustDto', () => {
  it('非法 type 被拒', async () => {
    const dto = new StockAdjustDto();
    dto.storeId = 'HZ-001';
    // @ts-expect-error 测试非法枚举
    dto.type = 'bogus';
    dto.items = [{ skuId: 'S1', styleId: 'ST1', colorId: 'C1', sizeId: 'S', qty: 1 }];
    const errs = await validate(dto);
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('会员金融 DTO', () => {
  it('RechargeDto 负金额被拒', async () => {
    const dto = new RechargeDto();
    dto.amount = -10;
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('AdjustStoredValueDto 缺原因被拒', async () => {
    const dto = new AdjustStoredValueDto();
    dto.amount = 100;
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('IssueCouponDto 非法 type 被拒', async () => {
    const dto = new IssueCouponDto();
    // @ts-expect-error 测试非法枚举
    dto.type = 'nope';
    dto.discountValue = 10;
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('OfflineSyncBatchDto', () => {
  it('非法 entityType 被拒', async () => {
    const dto = new OfflineSyncBatchDto();
    dto.storeId = 'HZ-001';
    const it = new OfflineSyncItemDto();
    it.clientId = 'c1';
    // @ts-expect-error 测试非法枚举
    it.entityType = 'evil';
    it.entityData = { foo: 1 };
    dto.items = [it];
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
