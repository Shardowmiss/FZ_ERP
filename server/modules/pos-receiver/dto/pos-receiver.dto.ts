/**
 * POS 上行接收 DTO（机器对机器接口，不做运行时校验，由接收端做字段级兜底）。
 * 字段同时兼容驼峰（ERP 风格）与下划线（POS 风格），接收端统一归一。
 */

export interface PosSalesItemPayload {
  skuId?: string;
  skuCode?: string;
  sku_code?: string;
  styleNo?: string;
  style_no?: string;
  color?: string;
  size?: string;
  quantity?: number | string;
  tagPrice?: number | string;
  tag_price?: number | string;
  dealPrice?: number | string;
  deal_price?: number | string;
  discountRate?: number | string;
  discount_rate?: number | string;
  lineAmount?: number | string;
  line_amount?: number | string;
}

export interface PosSalesPayload {
  storeCode?: string;
  store_code?: string;
  storeName?: string;
  store_name?: string;
  orderNo?: string;
  order_no?: string;
  saleDate?: string;
  sale_date?: string;
  cashierName?: string;
  cashier_name?: string;
  memberId?: string;
  member_id?: string;
  totalAmount?: number | string;
  total_amount?: number | string;
  discountAmount?: number | string;
  discount_amount?: number | string;
  receivableAmount?: number | string;
  receivable_amount?: number | string;
  receivedAmount?: number | string;
  received_amount?: number | string;
  changeAmount?: number | string;
  change_amount?: number | string;
  payMethods?: unknown;
  pay_methods?: unknown;
  remark?: string;
  items?: PosSalesItemPayload[];
}

export interface PosStocktakeItemPayload {
  skuCode?: string;
  sku_code?: string;
  itemCode?: string;
  item_code?: string;
  skuName?: string;
  sku_name?: string;
  itemName?: string;
  item_name?: string;
  color?: string;
  size?: string;
  bookQty?: number | string;
  book_qty?: number | string;
  actualQty?: number | string;
  actual_qty?: number | string;
}

export interface PosStocktakePayload {
  storeCode?: string;
  store_code?: string;
  stocktakeNo?: string;
  stocktake_no?: string;
  stocktakeDate?: string;
  stocktake_date?: string;
  remark?: string;
  items?: PosStocktakeItemPayload[];
}

export interface PosReturnItemPayload {
  skuCode?: string;
  sku_code?: string;
  styleNo?: string;
  style_no?: string;
  color?: string;
  size?: string;
  quantity?: number | string;
  price?: number | string;
  amount?: number | string;
  batchNo?: string;
  batch_no?: string;
}

export interface PosReturnPayload {
  storeCode?: string;
  store_code?: string;
  returnNo?: string;
  return_no?: string;
  posOrderNo?: string;
  pos_order_no?: string;
  returnDate?: string;
  return_date?: string;
  totalAmount?: number | string;
  total_amount?: number | string;
  reason?: string;
  remark?: string;
  items?: PosReturnItemPayload[];
}

export interface PosRequisitionItemPayload {
  skuCode?: string;
  sku_code?: string;
  styleNo?: string;
  style_no?: string;
  color?: string;
  size?: string;
  qty?: number | string;
  remark?: string;
}

export interface PosRequisitionPayload {
  storeCode?: string;
  store_code?: string;
  reqNo?: string;
  req_no?: string;
  reqDate?: string;
  req_date?: string;
  remark?: string;
  items?: PosRequisitionItemPayload[];
}

export interface PosEodPayload {
  storeCode?: string;
  store_code?: string;
  eodNo?: string;
  eod_no?: string;
  settleDate?: string;
  settle_date?: string;
  sessionId?: string;
  session_id?: string;
  cashierName?: string;
  cashier_name?: string;
  cashAmount?: number | string;
  cash_amount?: number | string;
  cardAmount?: number | string;
  card_amount?: number | string;
  wechatAmount?: number | string;
  wechat_amount?: number | string;
  alipayAmount?: number | string;
  alipay_amount?: number | string;
  otherAmount?: number | string;
  other_amount?: number | string;
  totalAmount?: number | string;
  total_amount?: number | string;
  depositAmount?: number | string;
  deposit_amount?: number | string;
  diffAmount?: number | string;
  diff_amount?: number | string;
  remark?: string;
}

export interface PosReceiveResult {
  success: boolean;
  erpNo?: string;
  duplicated?: boolean;
  message?: string;
}
