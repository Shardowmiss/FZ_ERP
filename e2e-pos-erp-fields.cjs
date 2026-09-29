/**
 * 端到端字段级联调（服务级真落库版）。
 *
 * 背景：ERP 应用带全局 CSRF + 鉴权（@NeedLogin/@CheckPermission），纯脚本无法获得
 * csrf cookie，故真·HTTP 端到端在本机被 CSRF 死锁（属平台安全设计，非 bug；HTTP 路由层
 * 已由 verify-pos-erp-contract.cjs 静态覆盖）。本脚本改用「驱动真实 PosReceiverService
 * + 真实 normalize 归一化层 + 真实 DB 落库」的方式，覆盖 字段归一化→落库 全链，
 * 实证「代码级复核发现的 POS/ERP 字段命名体系错配」已被 normalize.ts 收敛。
 *
 * 用 POS 业务侧真实字段名构造 payload：
 *   skuId/styleId/colorId/sizeId/storeId/qty/unitPrice/refundPrice/reqQty/originalOrderNo/eodDate
 * 验证 ERP 接收端能正确归一化并落库。
 *
 * 运行：先 `node dist/server/main.js` 起 ERP（DB=5434），再 `node e2e-pos-erp-fields.cjs`
 */
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const BASE = '/Users/woxxnixx/WorkBuddy/2026-09-17-14-43-21/erp_source';
const { PosReceiverService } = require(BASE + '/dist/server/modules/pos-receiver/pos-receiver.service.js');
const norm = require(BASE + '/dist/server/modules/pos-receiver/normalize.js');

const client = postgres('postgres://erp:erp@localhost:5434/erp_db');
const db = drizzle(client);
const svc = new PosReceiverService(db);

let pass = 0;
let fail = 0;
const lines = [];
function assert(name, cond, detail) {
  if (cond) {
    pass++;
    lines.push('  ✅ ' + name);
  } else {
    fail++;
    lines.push('  ❌ ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
  }
}

// POS 业务侧真实字段名（代表 POS 业务对象序列化后推送的形状）
const ts = Date.now();
const P = {
  sales: {
    storeId: 'ST-D01',
    orderNo: `POS-SO-E2E-${ts}`,
    memberId: 'M001',
    totalAmount: 598,
    discountAmount: 0,
    payAmount: 598, // POS 只有实付
    items: [
      { skuId: 'ST-SPRING-红-S', styleId: 'ST-SPRING', colorId: '红', sizeId: 'S', qty: 2, unitPrice: 299, tagPrice: 299, lineAmount: 598 },
    ],
  },
  returns: {
    storeId: 'ST-D01',
    returnNo: `POS-RT-E2E-${ts}`,
    originalOrderNo: `POS-SO-E2E-${ts}`,
    refundAmount: 299,
    items: [
      { skuId: 'ST-SPRING-红-S', styleId: 'ST-SPRING', colorId: '红', sizeId: 'S', qty: 1, refundPrice: 299, lineAmount: 299 },
    ],
  },
  stocktakes: {
    storeId: 'ST-D01',
    stocktakeNo: `POS-STK-E2E-${ts}`,
    items: [
      { skuId: 'ST-SPRING-红-S', styleId: 'ST-SPRING', colorId: '红', sizeId: 'S', bookQty: 10, actualQty: 9 },
    ],
  },
  transfer_requests: {
    storeId: 'ST-D01',
    reqNo: `POS-REQ-E2E-${ts}`,
    items: [
      { skuId: 'ST-SPRING-黑-M', styleId: 'ST-SPRING', colorId: '黑', sizeId: 'M', reqQty: 5 },
    ],
  },
  eods: {
    storeId: 'ST-D01',
    eodNo: `POS-EOD-E2E-${ts}`,
    eodDate: '2026-09-23',
    cashAmount: 598, cardAmount: 0, wechatAmount: 0, alipayAmount: 0, otherAmount: 0, totalAmount: 598,
  },
};

async function main() {
  // ===== 1. sales =====
  lines.push('\n【sales】POS 字段 storeId/skuId/styleId/colorId/sizeId/qty/unitPrice → ERP');
  {
    const n = norm.normalizeSales(P.sales);
    assert('归一化 skuCode←skuId', n.items[0].skuCode === 'ST-SPRING-红-S', n.items[0]);
    assert('归一化 styleNo←styleId', n.items[0].styleNo === 'ST-SPRING', n.items[0]);
    assert('归一化 color←colorId', n.items[0].color === '红', n.items[0]);
    assert('归一化 size←sizeId', n.items[0].size === 'S', n.items[0]);
    assert('归一化 quantity←qty', n.items[0].quantity === 2, n.items[0]);
    assert('归一化 dealPrice←unitPrice', n.items[0].dealPrice === 299, n.items[0]);
    assert('归一化 storeCode←storeId', n.storeCode === 'ST-D01', n);
    assert('归一化 receivedAmount←payAmount', n.receivedAmount === 598, n);
    const r = await svc.receiveSales(n);
    assert('销售单落库 success', r.success === true, r);
    const erpNo = r.erpNo;
    const ro = await client`SELECT store_id, total_amount, item_count FROM retail_order WHERE retail_no = ${erpNo}`;
    assert('retail_order 落库且门店解析正确', ro.length === 1 && !!ro[0].store_id, ro[0]);
    assert('retail_order total_amount=598', ro[0].total_amount === '598', ro[0]);
    const roi = await client`SELECT sku_code, style_no, color, size, quantity, deal_price FROM retail_order_item WHERE retail_id = (SELECT id FROM retail_order WHERE retail_no = ${erpNo})`;
    assert('明细落库 sku_code=ST-SPRING-红-S', roi[0].sku_code === 'ST-SPRING-红-S', roi[0]);
    assert('明细落库 style_no=ST-SPRING', roi[0].style_no === 'ST-SPRING', roi[0]);
    assert('明细落库 color=红', roi[0].color === '红', roi[0]);
    assert('明细落库 size=S', roi[0].size === 'S', roi[0]);
    assert('明细落库 quantity=2', roi[0].quantity === '2', roi[0]);
    assert('明细落库 deal_price=299', roi[0].deal_price === '299', roi[0]);
    const r2 = await svc.receiveSales(n);
    assert('销售单重复推送幂等 duplicated', r2.duplicated === true, r2);
  }

  // ===== 2. returns =====
  lines.push('\n【returns】POS 字段 originalOrderNo/refundPrice → ERP');
  {
    const n = norm.normalizeReturns(P.returns);
    assert('归一化 posOrderNo←originalOrderNo', n.posOrderNo === P.returns.originalOrderNo, n);
    assert('归一化 price←refundPrice', n.items[0].price === 299, n.items[0]);
    const r = await svc.receiveReturns(n);
    assert('退货单落库 success', r.success === true, r);
    const erpNo = r.erpNo;
    const row = await client`SELECT pos_order_no, total_amount, status FROM pos_return WHERE return_no = ${erpNo}`;
    assert('pos_return posOrderNo=原单号', row[0].pos_order_no === P.returns.originalOrderNo, row[0]);
    assert('pos_return total_amount=299', row[0].total_amount === '299', row[0]);
    const it = await client`SELECT sku_code, quantity, price FROM pos_return_item WHERE return_id = (SELECT id FROM pos_return WHERE return_no = ${erpNo})`;
    assert('退货明细 sku_code=ST-SPRING-红-S', it[0].sku_code === 'ST-SPRING-红-S', it[0]);
    assert('退货明细 quantity=1', it[0].quantity === '1', it[0]);
    assert('退货明细 price=299', it[0].price === '299', it[0]);
  }

  // ===== 3. stocktakes =====
  lines.push('\n【stocktakes】POS 字段 bookQty/actualQty → ERP');
  {
    const n = norm.normalizeStocktake(P.stocktakes);
    const r = await svc.receiveStocktake(n);
    assert('盘点单落库 success', r.success === true, r);
    const erpNo = r.erpNo;
    // inventory_stocktake_item 的 sku 列是 sku_id(uuid)，由 resolveSkuMap 把 POS skuId 解析为 ERP sku.id
    const it = await client`SELECT i.sku_id, i.book_qty, i.actual_qty, i.diff_qty, s.sku_code
      FROM inventory_stocktake_item i LEFT JOIN sku s ON s.id = i.sku_id
      WHERE i.stocktake_id = (SELECT id FROM inventory_stocktake WHERE stocktake_no = ${erpNo})`;
    assert('盘点明细 sku 解析为 ERP sku_id 且 code=ST-SPRING-红-S', !!it[0].sku_id && it[0].sku_code === 'ST-SPRING-红-S', it[0]);
    assert('盘点 book_qty=10', it[0].book_qty === '10', it[0]);
    assert('盘点 actual_qty=9', it[0].actual_qty === '9', it[0]);
    assert('盘点 diff_qty 自动=-1', it[0].diff_qty === '-1', it[0]);
  }

  // ===== 4. transfer_requests =====
  lines.push('\n【transfer_requests】POS 字段 reqQty → ERP');
  {
    const n = norm.normalizeRequisition(P.transfer_requests);
    assert('归一化 qty←reqQty', n.items[0].qty === 5, n.items[0]);
    const r = await svc.receiveTransferRequest(n);
    assert('要货单落库 success', r.success === true, r);
    const erpNo = r.erpNo;
    const it = await client`SELECT sku_code, qty FROM pos_requisition_item WHERE requisition_id = (SELECT id FROM pos_requisition WHERE req_no = ${erpNo})`;
    assert('要货明细 sku_code=ST-SPRING-黑-M', it[0].sku_code === 'ST-SPRING-黑-M', it[0]);
    assert('要货 qty=5', it[0].qty === '5', it[0]);
  }

  // ===== 5. eods =====
  lines.push('\n【eods】POS 字段 eodDate + 扁平支付金额 → ERP');
  {
    const n = norm.normalizeEod(P.eods);
    assert('归一化 settleDate←eodDate', n.settleDate === '2026-09-23', n);
    const r = await svc.receiveEod(n);
    assert('日结单落库 success', r.success === true, r);
    const erpNo = r.erpNo;
    const row = await client`SELECT settle_date, cash_amount, total_amount, status FROM pos_daily_settle WHERE settle_no = ${erpNo}`;
    assert('日结 settle_date=2026-09-23', String(row[0].settle_date) === '2026-09-23', row[0]);
    assert('日结 cash_amount=598', row[0].cash_amount === '598', row[0]);
    assert('日结 total_amount=598', row[0].total_amount === '598', row[0]);
    assert('日结 status=settled', row[0].status === 'settled', row[0]);
  }

  console.log(lines.join('\n'));
  console.log(`\n端到端字段级联调（服务级真落库）结果: 通过 ${pass} / 失败 ${fail}`);
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E 运行异常:', e);
  process.exit(2);
});
