import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { OmnichannelService } from './omnichannel.service';
import type { MemberWalletUpstreamService } from './member-wallet-upstream.service';
import {
  posStore,
  posMember,
  posStyle,
  posColor,
  posSize,
  posSku,
  posStock,
  posOmnichannelOrder,
  posOmnichannelItem,
  posSaleOrder,
  posSaleItem,
  posSalePayment,
  posPointsLog,
} from '@server/database/schema';
import { eq } from 'drizzle-orm';

/**
 * P1-2 全渠道财务闭环：门店履约（发货 / 自提核销）必须记账为一笔 POS 销售单，
 * 并计入会员积分、扣减库存、自动纳入班次 EOD。本测试覆盖报告 B-② 财务孤岛修复。
 */
const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

describe('OmnichannelService 财务闭环 — P1-2', () => {
  let t: TestDb;
  let svc: OmnichannelService;

  beforeAll(async () => {
    t = await setupTestDb();
    // 本测试聚焦「全渠道履约的财务闭环 + 积分」，钱包上行（S3）由专属 spec 覆盖，
    // 这里注入 hermetic stub：shadow 语义写本地积分、enabled=false 使其不触发 enqueue，
    // 保持与原测试一致的行为，同时避免未注入依赖导致 this.walletUpstream 为 undefined。
    const walletUpstreamStub = {
      get erpAuthoritative() {
        return false;
      },
      get enabled() {
        return false;
      },
      enqueue: vi.fn(async () => 0),
      kick: vi.fn(),
    } as unknown as MemberWalletUpstreamService;
    svc = new OmnichannelService(t.db as never, walletUpstreamStub);
    await t.db.insert(posStore).values({ id: 'ST1', name: '旗舰店', code: 'ST1' });
    await t.db.insert(posMember).values({
      // posMember.id 为 uuid 列（见 schema.ts），测试数据须为合法 UUID；
      // 此前写作 'M1' 会在 pglite 底座修好后暴露为 22P02 报错。
      id: MEMBER_ID, memberNo: 'M001', phone: '13800000000', level: 'normal',
      points: 10, totalSpent: 0, totalCount: 0, storedValue: 0,
    });
    await t.db.insert(posStyle).values({ id: 'S1', name: 'T恤', category: '上衣', colorIds: ['C1'], sizeIds: ['SZ1'], tagPrice: 5000, costPrice: 2000 });
    await t.db.insert(posColor).values({ id: 'C1', name: '红', hex: '#f00' });
    await t.db.insert(posSize).values({ id: 'SZ1', sortOrder: 1 });
    await t.db.insert(posSku).values({ id: 'SKU1', styleId: 'S1', colorId: 'C1', sizeId: 'SZ1', barcode: 'B1' });
    await t.db.insert(posStock).values({
      storeId: 'ST1', skuId: 'SKU1', styleId: 'S1', colorId: 'C1', sizeId: 'SZ1', qty: 50, inTransitQty: 0,
    });
  });

  afterAll(async () => {
    await t.pg.close();
  });

  it('shipOrder：发货扣库存 + 生成销售单/支付/积分（P1-2 修复点）', async () => {
    await t.db.insert(posOmnichannelOrder).values({
      id: '22222222-2222-4222-8222-222222222222', orderNo: 'ON1', channel: 'meituan', type: 'ship_to_store',
      storeId: 'ST1', memberPhone: '13800000000', totalAmount: 10000, status: 'paid', sourceNo: 'SRC1',
    });
    await t.db.insert(posOmnichannelItem).values({
      orderId: '22222222-2222-4222-8222-222222222222', skuId: 'SKU1', styleId: 'S1', styleName: 'T恤',
      colorId: 'C1', sizeId: 'SZ1', qty: 2, price: 5000,
    });

    const before = await t.db.select().from(posStock).where(eq(posStock.skuId, 'SKU1'));
    const stockBefore = before[0].qty;

    await svc.shipOrder('22222222-2222-4222-8222-222222222222');

    // 库存扣减（ship 与 pickup 统一口径）
    const stock = await t.db.select().from(posStock).where(eq(posStock.skuId, 'SKU1'));
    expect(stock[0].qty).toBe(stockBefore - 2);

    // 生成销售单（channel=online）
    const orders = await t.db.select().from(posSaleOrder).where(eq(posSaleOrder.orderNo, 'OC-ON1'));
    expect(orders.length).toBe(1);
    expect(orders[0].channel).toBe('online');
    expect(orders[0].totalAmount).toBe(10000);
    expect(orders[0].pointsEarned).toBe(100); // floor(10000/100)

    // 销售明细 + 支付（payMethod=online，EOD 据此聚合）
    const items = await t.db.select().from(posSaleItem).where(eq(posSaleItem.orderId, orders[0].id));
    expect(items.length).toBe(1);
    expect(items[0].qty).toBe(2);
    const pays = await t.db.select().from(posSalePayment).where(eq(posSalePayment.orderId, orders[0].id));
    expect(pays.length).toBe(1);
    expect(pays[0].payMethod).toBe('online');
    expect(pays[0].amount).toBe(10000);

    // 会员积分（消费 1 元积 1 分）
    const m = await t.db.select().from(posMember).where(eq(posMember.id, MEMBER_ID));
    expect(m[0].points).toBe(110);
    expect(m[0].totalSpent).toBe(10000);
    expect(m[0].totalCount).toBe(1);
    const pl = await t.db.select().from(posPointsLog).where(eq(posPointsLog.memberId, MEMBER_ID));
    expect(pl.length).toBe(1);
    expect(pl[0].change).toBe(100);
    expect(pl[0].balance).toBe(110);

    // 全渠道订单状态 + 幂等标记
    const om = await t.db.select().from(posOmnichannelOrder).where(eq(posOmnichannelOrder.id, '22222222-2222-4222-8222-222222222222'));
    expect(om[0].status).toBe('shipped');
    expect(om[0].saleOrderNo).toBe('OC-ON1');
    expect(om[0].fulfilledAt).not.toBeNull();
  });

  it('单笔履约仅生成一张销售单（fulfillAsSaleOrder 行锁幂等）', async () => {
    await t.db.insert(posOmnichannelOrder).values({
      id: '44444444-4444-4444-8444-444444444444', orderNo: 'ON3', channel: 'meituan', type: 'ship_to_store',
      storeId: 'ST1', memberPhone: '13800000000', totalAmount: 3000, status: 'paid',
    });
    await t.db.insert(posOmnichannelItem).values({
      orderId: '44444444-4444-4444-8444-444444444444', skuId: 'SKU1', styleId: 'S1', styleName: 'T恤', colorId: 'C1', sizeId: 'SZ1', qty: 1, price: 3000,
    });
    await svc.shipOrder('44444444-4444-4444-8444-444444444444');
    // 重复履约会因 status 已 shipped 被拒；此处断言单笔履约只产生 1 张销售单
    const cnt = await t.db.select().from(posSaleOrder).where(eq(posSaleOrder.remark, '全渠道订单 ON3 (ship_to_store)'));
    expect(cnt.length).toBe(1);
  });

  it('pickupOrder：自提核销扣库存 + 记账（无会员则不积分）', async () => {
    await t.db.insert(posOmnichannelOrder).values({
      id: '33333333-3333-4333-8333-333333333333', orderNo: 'ON2', channel: 'douyin', type: 'store_pickup',
      storeId: 'ST1', memberPhone: null, totalAmount: 8000, status: 'ready', pickupCode: 'PK1',
    });
    await t.db.insert(posOmnichannelItem).values({
      orderId: '33333333-3333-4333-8333-333333333333', skuId: 'SKU1', styleId: 'S1', styleName: 'T恤', colorId: 'C1', sizeId: 'SZ1', qty: 1, price: 8000,
    });
    const before = await t.db.select().from(posStock).where(eq(posStock.skuId, 'SKU1'));
    const stockBefore = before[0].qty;
    // 本用例与前面的用例共享同一个库、同一位会员：前一个用例已给该会员累加过积分，
    // 故这里取基线，断言「本次核销的积分变化量为 0」，而不是硬编码一个绝对数值。
    const memberBefore = (
      await t.db.select().from(posMember).where(eq(posMember.id, MEMBER_ID))
    )[0].points;

    await svc.pickupOrder('33333333-3333-4333-8333-333333333333', 'PK1');

    const stock = await t.db.select().from(posStock).where(eq(posStock.skuId, 'SKU1'));
    expect(stock[0].qty).toBe(stockBefore - 1);

    const orders = await t.db.select().from(posSaleOrder).where(eq(posSaleOrder.orderNo, 'OC-ON2'));
    expect(orders.length).toBe(1);
    expect(orders[0].channel).toBe('online');

    // 无会员：本次核销不产生任何积分流水，会员积分零变化
    const m = await t.db.select().from(posMember).where(eq(posMember.id, MEMBER_ID));
    expect(m[0].points).toBe(memberBefore);
    const plAfter = await t.db.select().from(posPointsLog).where(eq(posPointsLog.memberId, MEMBER_ID));
    expect(plAfter.length).toBe(2); // 仅前面用例留下的两条，本次核销未新增

    const om = await t.db.select().from(posOmnichannelOrder).where(eq(posOmnichannelOrder.id, '33333333-3333-4333-8333-333333333333'));
    expect(om[0].status).toBe('completed');
  });

  it('pickupOrder 核销码错误拒绝', async () => {
    await t.db.insert(posOmnichannelOrder).values({
      id: '55555555-5555-4555-8555-555555555555', orderNo: 'ON4', channel: 'douyin', type: 'store_pickup',
      storeId: 'ST1', memberPhone: null, totalAmount: 8000, status: 'ready', pickupCode: 'PK9',
    });
    await expect(svc.pickupOrder('55555555-5555-4555-8555-555555555555', 'WRONG')).rejects.toThrow();
  });
});
