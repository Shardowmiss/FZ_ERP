import { describe, it, expect, vi } from 'vitest';
import type { SaleOrder } from '@shared/api.interface';
import { SalesService } from './sales.service';

/**
 * P2-b′：POS → ERP 上行车销售的**数据保真**契约。
 *
 * 背景（这是个会污染数据的真 bug，不是风格问题）：
 * 旧实现的上行 payload 里**没有业务日期字段**，ERP 接收端
 * `pos-receiver/normalize.ts` 又是 `saleDate ?? TODAY()` 顶替。
 * POS 是离线优先的——订单可能在断网几天后才同步，于是这批零售单在 ERP 里
 * 会被全部写成"同步当天"，直接毒化按时间窗聚合的报表（见 Wave 3 的 P1-c④）。
 *
 * 本 spec 锁定三件事：
 *   1. payload 必须携带 saleDate（成交日，不是同步日）；
 *   2. changeAmount 必须回传（旧实现恒为 0，收银找零无法对账）；
 *   3. itemCount 用 totalQty（数量）而非明细行数。
 *
 * pushSalesUpstream 是纯组装（不触库），故直接白盒调用即可，无需 pglite。
 */
describe('SalesService.pushSalesUpstream 上行保真', () => {
  function build(orderPatch: Partial<SaleOrder> = {}) {
    const pushed: Array<Record<string, unknown>> = [];
    const erpStub = {
      pushUpstream: vi.fn(async (_type: string, _docNo: string, payload: Record<string, unknown>) => {
        pushed.push(payload);
        return { success: true };
      }),
    };
    const svc = new SalesService({} as never, erpStub as never) as unknown as {
      pushSalesUpstream(order: SaleOrder): Promise<void>;
    };
    const order = {
      id: 'o1',
      orderNo: 'LX20260815001',
      storeId: 'ST-001',
      totalQty: 3,
      totalAmount: 29000,
      discountAmount: 1000,
      payAmount: 28000,
      // 成交日在过去：模拟"离线几天后才同步"
      saleDate: '2026-08-15',
      payments: [
        { payMethod: 'cash', amount: 28000, changeAmount: 5 },
        { payMethod: 'wechat', amount: 0, changeAmount: 0 },
      ],
      items: [],
      ...orderPatch,
    } as unknown as SaleOrder;
    return { svc, order, pushed };
  }

  it('payload 携带真实成交日（2026-08-15），不得退化成同步当天', async () => {
    const { svc, order, pushed } = build();
    await svc.pushSalesUpstream(order);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].saleDate).toBe('2026-08-15');
  });

  it('changeAmount 从 cash 支付行汇总回传，不再是恒 0', async () => {
    const { svc, order, pushed } = build();
    await svc.pushSalesUpstream(order);
    expect(Number(pushed[0].changeAmount)).toBe(5);
  });

  it('itemCount 用 totalQty（数量）而非明细行数', async () => {
    const { svc, order, pushed } = build();
    await svc.pushSalesUpstream(order);
    expect(pushed[0].itemCount).toBe(3);
  });

  it('同 SKU 多行时 itemCount 仍是数量而非行数', async () => {
    const { svc, order, pushed } = build({
      totalQty: 5,
      items: new Array(3).fill({ skuId: 'SKU-1', qty: 1 }),
    } as Partial<SaleOrder>);
    await svc.pushSalesUpstream(order);
    expect(pushed[0].itemCount).toBe(5);
  });

  it('无现金支付行时 changeAmount 为 0 而非 NaN', async () => {
    const { svc, order, pushed } = build({
      payments: [{ payMethod: 'wechat', amount: 28000, changeAmount: 0 }],
    } as Partial<SaleOrder>);
    await svc.pushSalesUpstream(order);
    expect(pushed[0].changeAmount).toBe(0);
  });
});
