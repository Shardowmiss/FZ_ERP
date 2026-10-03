/**
 * 集中管理全系统高频枚举值，消除散落在各 service / controller 中的“魔法字符串”。
 *
 * 约定：枚举值为**与数据库存储字符串严格一致**的字面量（as const），
 * 既可直接用于 Drizzle 条件拼接，也可用于 class-validator 的 @IsIn 校验。
 */

export const CommonStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  DISABLED: 'disabled',
} as const;

export const SessionStatus = {
  OPEN: 'open',
  CLOSED: 'closed',
} as const;

export const PayMethod = {
  CASH: 'cash',
  WECHAT: 'wechat',
  ALIPAY: 'alipay',
  BANK_CARD: 'bank_card',
  OTHER: 'other',
} as const;

export const PriceListType = {
  STORE: 'store',
  CHANNEL: 'channel',
  MEMBER: 'member',
} as const;

export const PromotionType = {
  FULL_REDUCTION: 'full_reduction',
  PERCENTAGE: 'percentage',
  FIXED_PRICE: 'fixed_price',
} as const;

export const CouponType = {
  FULL_REDUCTION: 'full_reduction',
  DISCOUNT: 'discount',
} as const;

/** 供 class-validator @IsIn 使用的取值数组 */
export const COMMON_STATUS_VALUES = Object.values(CommonStatus);
export const SESSION_STATUS_VALUES = Object.values(SessionStatus);
export const PAY_METHOD_VALUES = Object.values(PayMethod);
export const PRICE_LIST_TYPE_VALUES = Object.values(PriceListType);
export const PROMOTION_TYPE_VALUES = Object.values(PromotionType);
export const COUPON_TYPE_VALUES = Object.values(CouponType);

// 采购订单状态（定义在 shared/api.interface，前后端共用，这里 re-export 便于服务端集中引用）
export {
  PurchaseOrderStatus,
  PURCHASE_ORDER_STATUS_VALUES,
} from '@shared/api.interface';

// 销售类单据状态（销售订单 / 销售单(出库) / 销售退单 共用同一状态机）
export {
  SalesOrderStatus,
  SALES_ORDER_STATUS_VALUES,
  SalesOutboundStatus,
  SALES_OUTBOUND_STATUS_VALUES,
  SalesReturnStatus,
  SALES_RETURN_STATUS_VALUES,
} from '@shared/api.interface';
