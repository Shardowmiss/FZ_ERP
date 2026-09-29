/**
 * 小票打印（P1-7 修复：原先「打印小票」按钮仅为占位，无任何行为）
 *
 * 采用隐藏 iframe + 80mm 热敏样式的方式打印：
 * - 不依赖页面 Tailwind 样式，打印结果稳定；
 * - 打印完自动移除 iframe，不影响当前页面。
 */
import type { SaleOrder } from '@shared/api.interface';

const PAY_LABEL: Record<string, string> = {
  cash: '现金',
  wechat: '微信支付',
  alipay: '支付宝',
  bank_card: '银行卡',
  stored_value: '储值余额',
  points: '积分抵扣',
};

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export interface ReceiptPrintOptions {
  storeName: string;
  isOffline?: boolean;
  serverOrderNo?: string;
  tempOrderNo?: string;
}

/** 生成 80mm 热敏小票 HTML */
export function buildReceiptHtml(
  order: SaleOrder,
  opts: ReceiptPrintOptions,
): string {
  const { storeName, isOffline = false, serverOrderNo, tempOrderNo } = opts;
  const orderNo = isOffline ? tempOrderNo || order.orderNo : serverOrderNo || order.orderNo;

  const itemRows = (order.items ?? [])
    .map(
      (it) => `
        <tr>
          <td class="name">${esc(it.styleName)}</td>
          <td class="cs">${esc(it.colorId)}/${esc(it.sizeId)}</td>
          <td class="qty">${it.qty}</td>
          <td class="amt">${it.lineAmount.toFixed(2)}</td>
        </tr>`,
    )
    .join('');

  const discountRows = (order.discounts ?? [])
    .map(
      (d) => `<div class="row warn"><span>${esc(d.name)}</span><span>-${d.amount.toFixed(2)}</span></div>`,
    )
    .join('');

  const payRows = (order.payments ?? [])
    .map((p) => {
      const label = PAY_LABEL[p.payMethod] ?? p.payMethod;
      const change = p.changeAmount > 0 ? ` (找零${p.changeAmount.toFixed(2)})` : '';
      return `<div class="row"><span>${esc(label)}${esc(change)}</span><span>${p.amount.toFixed(2)}</span></div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>销售小票 ${esc(orderNo)}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Courier New", SimSun, monospace;
    font-size: 12px; color: #000; margin: 0; padding: 0;
    width: 76mm;
  }
  .center { text-align: center; }
  .store { font-size: 16px; font-weight: bold; }
  .sub { font-size: 11px; margin-top: 2px; }
  .dashed { border-top: 1px dashed #000; margin: 4px 0; padding-top: 4px; }
  .row { display: flex; justify-content: space-between; font-size: 11px; line-height: 1.5; }
  .warn { color: #000; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; font-weight: normal; font-size: 10px; padding-bottom: 2px; }
  td { padding: 1px 0; vertical-align: top; }
  td.name { width: 46%; }
  td.cs { width: 20%; text-align: center; }
  td.qty { width: 10%; text-align: center; }
  td.amt { width: 24%; text-align: right; }
  .total { font-size: 14px; font-weight: bold; }
  .footer { font-size: 10px; text-align: center; margin-top: 4px; }
  .offline-tag { font-size: 11px; }
</style>
</head>
<body>
  <div class="center">
    <div class="store">${esc(storeName)}</div>
    <div class="sub">销售小票${isOffline ? ' · <span class="offline-tag">离线交易·待上传</span>' : ''}</div>
  </div>

  <div class="dashed">
    <div class="row"><span>${isOffline ? '临时单号' : '单号'}</span><span>${esc(orderNo)}</span></div>
    ${isOffline && serverOrderNo ? `<div class="row"><span>正式单号</span><span>${esc(serverOrderNo)}</span></div>` : ''}
    <div class="row"><span>时间</span><span>${esc(fmtTime(order.createdAt))}</span></div>
    ${order.employeeName ? `<div class="row"><span>导购</span><span>${esc(order.employeeName)}</span></div>` : ''}
    ${order.memberName ? `<div class="row"><span>会员</span><span>${esc(order.memberName)}</span></div>` : ''}
  </div>

  <div class="dashed">
    <table>
      <thead>
        <tr><th>品名</th><th style="text-align:center">色/码</th><th style="text-align:center">数</th><th style="text-align:right">金额</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  ${discountRows ? `<div class="dashed">${discountRows}</div>` : ''}
  ${payRows ? `<div class="dashed">${payRows}</div>` : ''}

  <div class="dashed">
    <div class="row"><span>件数</span><span>${order.totalQty} 件</span></div>
    <div class="row"><span>吊牌金额</span><span>${order.totalAmount.toFixed(2)}</span></div>
    <div class="row"><span>优惠</span><span>-${order.discountAmount.toFixed(2)}</span></div>
    <div class="row total"><span>实收</span><span>${order.payAmount.toFixed(2)}</span></div>
    ${order.pointsEarned > 0 ? `<div class="row"><span>本次积分</span><span>+${order.pointsEarned}分</span></div>` : ''}
  </div>

  <div class="dashed footer">
    <div>如需退换，请凭此小票7日内办理</div>
    <div>商品需保持吊牌完整、未穿着洗涤</div>
    <div style="margin-top:6px">谢谢惠顾，欢迎再次光临</div>
  </div>
</body>
</html>`;
}

/**
 * 打印小票：写入隐藏 iframe 并调用打印
 */
export function printReceipt(order: SaleOrder, opts: ReceiptPrintOptions): void {
  const html = buildReceiptHtml(order, opts);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const doPrint = (): void => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // 打印对话框关闭后移除 iframe
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    }
  };

  // 等待 iframe 内容渲染完成
  if (doc.readyState === 'complete') {
    setTimeout(doPrint, 200);
  } else {
    iframe.onload = () => setTimeout(doPrint, 200);
  }
}
