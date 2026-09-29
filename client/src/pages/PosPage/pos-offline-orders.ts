import type {
  SaleItem,
  SaleOrder,
  PromotionDiscountDetail,
  Member,
  Employee,
  SalePayment,
  SaleDiscount,
} from '@shared/api.interface';

import { todayBusinessDate } from '@client/src/lib/business-date';

/**
 * POS 离线交易辅助函数（Mock 版本，保留以备调试）
 *
 * 注意：生产代码已切换到 OfflineContext.createOfflineOrder / createOfflineSuspended。
 * 本文件仅用于本地调试参考，不参与实际运行。
 */

type EnqueueFn = (item: {
  tempNo: string;
  type: 'sale' | 'suspend';
  typeName: string;
  amount: number;
  detail?: Record<string, unknown>;
}) => string;

import { STORE_ID } from '@client/src/lib/store';

function genTempNo(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}${date}${rand}`;
}

export interface OfflineOrderParams {
  cart: SaleItem[];
  payments: { payMethod: string; amount: number; changeAmount: number }[];
  discounts: PromotionDiscountDetail[];
  member: Member | null;
  employee: Employee | null;
  totalTagAmount: number;
  totalDiscount: number;
  payAmount: number;
  totalQty: number;
}

/**
 * 创建离线销售单：写入本地队列，返回构造的 SaleOrder
 */
export function createOfflineSaleOrder(
  params: OfflineOrderParams,
  enqueue: EnqueueFn,
): SaleOrder {
  const {
    cart, payments, discounts, member, employee,
    totalTagAmount, totalDiscount, payAmount, totalQty,
  } = params;
  const tempNo = genTempNo('LX');
  const salePayments: SalePayment[] = payments.map((p) => ({
    payMethod: p.payMethod,
    amount: p.amount,
    changeAmount: p.changeAmount,
  }));
  const saleDiscounts: SaleDiscount[] = discounts.map((d) => ({
    promotionId: d.promotionId,
    name: d.promotionName,
    type: d.promotionType,
    amount: d.discountAmount,
  }));

  const order: SaleOrder = {
    id: tempNo,
    orderNo: tempNo,
    storeId: STORE_ID,
    memberId: member?.id,
    employeeId: employee?.id,
    saleDate: todayBusinessDate(),
    totalQty,
    totalAmount: totalTagAmount,
    discountAmount: totalDiscount,
    payAmount,
    pointsUsed: 0,
    pointsEarned: 0,
    status: 'offline_pending',
    channel: 'offline_pos',
    syncedToErp: false,
    syncStatus: 'pending',
    items: cart,
    payments: salePayments,
    discounts: saleDiscounts,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  enqueue({
    tempNo,
    type: 'sale',
    typeName: '销售单',
    amount: payAmount,
    detail: { items: cart, payments: salePayments },
  });

  return order;
}

/**
 * 离线挂单：写入本地队列
 */
export function createOfflineSuspend(
  params: Omit<OfflineOrderParams, 'payments' | 'discounts' | 'totalDiscount'> & {
    member: Member | null;
    employee: Employee | null;
  },
  enqueue: EnqueueFn,
): string {
  const tempNo = genTempNo('GD');
  enqueue({
    tempNo,
    type: 'suspend',
    typeName: '挂单',
    amount: params.payAmount,
    detail: {
      items: params.cart,
      memberId: params.member?.id,
      employeeId: params.employee?.id,
    },
  });
  return tempNo;
}
