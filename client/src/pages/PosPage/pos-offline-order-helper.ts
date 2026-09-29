import type {
  SaleItem,
  SaleOrder,
  PromotionDiscountDetail,
  Member,
  Employee,
  SalePayment,
  SaleDiscount,
} from '@shared/api.interface';

import { STORE_ID } from '@client/src/lib/store';
import { todayBusinessDate } from '@client/src/lib/business-date';

export interface BuildOfflineOrderParams {
  cart: SaleItem[];
  payments: { payMethod: string; amount: number; changeAmount: number }[];
  discounts: PromotionDiscountDetail[];
  member: Member | null;
  employee: Employee | null;
  totalTagAmount: number;
  totalDiscount: number;
  payAmount: number;
  totalQty: number;
  /** 积分抵扣数（单位：分）。离线单同步时需透传给服务端核销 */
  pointsUsed?: number;
  /** 抹零金额（单位：元）。离线单同步时需透传给服务端计算应付 */
  roundingAmount?: number;
}

/**
 * 构造离线 SaleOrder 对象（用于本地暂存展示）
 */
export function buildOfflineSaleOrder(
  params: BuildOfflineOrderParams,
  clientId: string,
): SaleOrder {
  const {
    cart,
    payments,
    discounts,
    member,
    employee,
    totalTagAmount,
    totalDiscount,
    payAmount,
    totalQty,
  } = params;

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

  return {
    id: clientId,
    orderNo: clientId,
    storeId: STORE_ID,
    memberId: member?.id,
    employeeId: employee?.id,
    // 成交那一刻打的戳：离线单可能在断网数天后才上行，这是唯一可信的成交日
    saleDate: todayBusinessDate(),
    totalQty,
    totalAmount: totalTagAmount,
    discountAmount: totalDiscount,
    payAmount,
    pointsUsed: params.pointsUsed ?? 0,
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
}
