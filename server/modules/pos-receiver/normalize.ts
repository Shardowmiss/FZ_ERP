/**
 * POS → ERP 上行 payload 归一化层。
 *
 * 背景：POS 业务侧数据对象（见 pos-review schema.ts）使用的字段命名与 ERP 接收端
 * DTO（pos-receiver.dto.ts）并不一致：
 *   POS 用  skuId / styleId / colorId / sizeId / storeId / qty / unitPrice /
 *           refundPrice / reqQty / originalOrderNo / eodDate
 *   ERP 期望 skuCode / styleNo / color / size / storeCode / quantity / dealPrice /
 *           price / qty / posOrderNo / settleDate
 * 此外 POS 业务对象缺少显式日期字段（saleDate/stocktakeDate/returnDate/reqDate），
 * 且 EOD 的支付渠道金额在 POS 侧拆到 pos_eod_payment 子表、主表只有汇总。
 *
 * 本层在「控制器入口」把任意来源的 payload（ERP camelCase / 下划线 / POS Id 风格）
 * 归一成 ERP 内部标准 Pos*Payload，service 层只读标准字段，无需改动。
 * 这样 POS 侧即使直接序列化业务对象推送（零改动）也能被正确接收；EOD 各渠道金额
 * 由 POS 侧接线时汇总进扁平字段即可（见 e2e-pos-erp-fields.cjs 实证）。
 */

import { BadRequestException } from '@nestjs/common';

type AnyRec = Record<string, any>;

/** 按优先级取第一个非空（非 undefined 且非空串）的值 */
function first(p: AnyRec, keys: string[]): any {
  for (const k of keys) {
    const v = p?.[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

const TODAY = (): string => new Date().toISOString().slice(0, 10);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 取交易业务日期，缺失即抛 400。
 *
 * 与历史实现 `?? TODAY()` 的区别不是"更严格"，而是**不再静默编造**：
 * 顶替值看起来像正常数据，实际会把真实成交日抹掉，且这类脏数据无法事后区分。
 * 调用方（POS）必须显式带上成交日；离线场景下由客户端在成交那一刻打戳。
 */
function requireTradeDate(p: AnyRec, field: string): string {
  const v = first(p, [field, field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]);
  if (v == null || v === '') {
    throw new BadRequestException(`${field} 缺失：零售单必须有真实成交日期，ERP 不会以同步当天顶替`);
  }
  const s = String(v);
  // 接受 'YYYY-MM-DD'；POS 也可能传带时间的 ISO 串，截断到日即可
  const day = DATE_RE.test(s) ? s : s.slice(0, 10);
  if (!DATE_RE.test(day)) {
    throw new BadRequestException(`${field} 日期格式应为 YYYY-MM-DD，收到：${s}`);
  }
  // 形状合法不代表日历上存在：2026-13-40 会被 Date 静默溢出成 2027-02-09，
  // 一个"看起来合法"的日期就这么写进了业务表。做一次 UTC 回环校验挡掉。
  if (!isValidCalendarDay(day)) {
    throw new BadRequestException(`${field} 不是有效的日历日期，收到：${s}`);
  }
  return day;
}

/** 校验 YYYY-MM-DD 是否是真实存在的日历日（回环比对，可挡住 2026-02-30 这类溢出值）。 */
function isValidCalendarDay(value: string): boolean {
  const [y, m, d] = value.split('-').map((n) => Number.parseInt(n, 10));
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  return (
    roundTrip.getUTCFullYear() === y &&
    roundTrip.getUTCMonth() === m - 1 &&
    roundTrip.getUTCDate() === d
  );
}

export function normalizeSales(p: AnyRec): AnyRec {
  const items = Array.isArray(p?.items)
    ? p.items.map((it: AnyRec) => ({
        skuCode: first(it, ['skuCode', 'sku_code', 'skuId', 'sku_id']),
        styleNo: first(it, ['styleNo', 'style_no', 'styleId', 'style_id']),
        color: first(it, ['color', 'colorId', 'color_id']),
        size: first(it, ['size', 'sizeId', 'size_id']),
        quantity: first(it, ['quantity', 'qty']),
        tagPrice: first(it, ['tagPrice', 'tag_price']),
        dealPrice: first(it, ['dealPrice', 'deal_price', 'unitPrice', 'unit_price']),
        discountRate: first(it, ['discountRate', 'discount_rate']),
        lineAmount: first(it, ['lineAmount', 'line_amount']),
      }))
    : [];
  return {
    storeCode: first(p, ['storeCode', 'store_code', 'storeId', 'store_id']),
    storeName: first(p, ['storeName', 'store_name']),
    orderNo: first(p, ['orderNo', 'order_no']),
    // saleDate（业务日期）**不允许缺省**。
    // 原实现是 `?? TODAY()`，即"POS 没传就用同步当天顶替"。
    // 这是个会污染数据的坑：POS 是离线优先的，隔几天再同步时，
    // 这批零售单在 ERP 里会全部被写成"同步当天"，直接毒化报表的时间窗口径
    // （见 Wave 3 的 P1-c④ 强制时间窗）。宁可拒绝落库，也不静默编造日期——
    // 拒绝会让 POS 侧 syncStatus 置 failed 并进入重试，属可见、可恢复的失败。
    saleDate: requireTradeDate(p, 'saleDate'),
    cashierName: first(p, ['cashierName', 'cashier_name']),
    memberId: first(p, ['memberId', 'member_id']),
    totalAmount: first(p, ['totalAmount', 'total_amount']),
    discountAmount: first(p, ['discountAmount', 'discount_amount']),
    receivableAmount: first(p, ['receivableAmount', 'receivable_amount']),
    receivedAmount: first(p, ['receivedAmount', 'received_amount', 'payAmount', 'pay_amount']),
    changeAmount: first(p, ['changeAmount', 'change_amount']),
    payMethods: first(p, ['payMethods', 'pay_methods']) ?? [],
    remark: first(p, ['remark']),
    items,
  };
}

export function normalizeReturns(p: AnyRec): AnyRec {
  const items = Array.isArray(p?.items)
    ? p.items.map((it: AnyRec) => ({
        skuCode: first(it, ['skuCode', 'sku_code', 'skuId', 'sku_id']),
        styleNo: first(it, ['styleNo', 'style_no', 'styleId', 'style_id']),
        color: first(it, ['color', 'colorId', 'color_id']),
        size: first(it, ['size', 'sizeId', 'size_id']),
        quantity: first(it, ['quantity', 'qty']),
        price: first(it, ['price', 'refundPrice', 'refund_price']),
        amount: first(it, ['amount', 'lineAmount', 'line_amount']),
        batchNo: first(it, ['batchNo', 'batch_no']),
      }))
    : [];
  return {
    storeCode: first(p, ['storeCode', 'store_code', 'storeId', 'store_id']),
    storeName: first(p, ['storeName', 'store_name']),
    returnNo: first(p, ['returnNo', 'return_no']),
    posOrderNo: first(p, ['posOrderNo', 'pos_order_no', 'originalOrderNo', 'original_order_no']),
    returnDate: first(p, ['returnDate', 'return_date']) ?? TODAY(),
    totalAmount: first(p, ['totalAmount', 'total_amount', 'refundAmount', 'refund_amount']),
    reason: first(p, ['reason']),
    remark: first(p, ['remark']),
    items,
  };
}

export function normalizeStocktake(p: AnyRec): AnyRec {
  const items = Array.isArray(p?.items)
    ? p.items.map((it: AnyRec) => ({
        skuCode: first(it, ['skuCode', 'sku_code', 'skuId', 'sku_id', 'itemCode', 'item_code']),
        styleNo: first(it, ['styleNo', 'style_no', 'styleId', 'style_id']),
        color: first(it, ['color', 'colorId', 'color_id']),
        size: first(it, ['size', 'sizeId', 'size_id']),
        bookQty: first(it, ['bookQty', 'book_qty']),
        actualQty: first(it, ['actualQty', 'actual_qty']),
      }))
    : [];
  return {
    storeCode: first(p, ['storeCode', 'store_code', 'storeId', 'store_id']),
    stocktakeNo: first(p, ['stocktakeNo', 'stocktake_no']),
    stocktakeDate: first(p, ['stocktakeDate', 'stocktake_date']) ?? TODAY(),
    remark: first(p, ['remark']),
    items,
  };
}

export function normalizeRequisition(p: AnyRec): AnyRec {
  const items = Array.isArray(p?.items)
    ? p.items.map((it: AnyRec) => ({
        skuCode: first(it, ['skuCode', 'sku_code', 'skuId', 'sku_id']),
        styleNo: first(it, ['styleNo', 'style_no', 'styleId', 'style_id']),
        color: first(it, ['color', 'colorId', 'color_id']),
        size: first(it, ['size', 'sizeId', 'size_id']),
        qty: first(it, ['qty', 'reqQty', 'req_qty']),
        remark: first(it, ['remark']),
      }))
    : [];
  return {
    storeCode: first(p, ['storeCode', 'store_code', 'storeId', 'store_id']),
    reqNo: first(p, ['reqNo', 'req_no']),
    reqDate: first(p, ['reqDate', 'req_date']) ?? TODAY(),
    remark: first(p, ['remark']),
    items,
  };
}

export function normalizeEod(p: AnyRec): AnyRec {
  return {
    storeCode: first(p, ['storeCode', 'store_code', 'storeId', 'store_id']),
    eodNo: first(p, ['eodNo', 'eod_no']),
    settleDate: first(p, ['settleDate', 'settle_date', 'eodDate', 'eod_date']) ?? TODAY(),
    sessionId: first(p, ['sessionId', 'session_id']),
    cashierName: first(p, ['cashierName', 'cashier_name']),
    cashAmount: first(p, ['cashAmount', 'cash_amount']),
    cardAmount: first(p, ['cardAmount', 'card_amount']),
    wechatAmount: first(p, ['wechatAmount', 'wechat_amount']),
    alipayAmount: first(p, ['alipayAmount', 'alipay_amount']),
    otherAmount: first(p, ['otherAmount', 'other_amount']),
    totalAmount: first(p, ['totalAmount', 'total_amount', 'netSales', 'net_sales']),
    depositAmount: first(p, ['depositAmount', 'deposit_amount']),
    diffAmount: first(p, ['diffAmount', 'diff_amount']),
    remark: first(p, ['remark']),
  };
}
