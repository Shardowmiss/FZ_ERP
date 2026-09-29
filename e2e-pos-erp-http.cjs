/**
 * POS→ERP 上行「真实 HTTP 端到端」联调脚本。
 *
 * 验证 POS 业务侧 pushUpstream（本任务已接线到五个 caller）经真实 HTTP 推送到 ERP 接收端时，
 * 完整链路「CSRF 豁免中间件 → UpstreamTokenGuard 共享密钥校验 → normalize 字段归一化 → 落库」可用，
 * 且字段级契约（POS 业务字段名 storeId/skuId/styleId/colorId/sizeId/qty/unitPrice/...）被正确解析落库。
 *
 * 运行：先启动 ERP（带 ERP_UPSTREAM_TOKEN），再 node e2e-pos-erp-http.cjs
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.ERP_UPSTREAM_TOKEN || 'test-secret-123';
const PATHS = {
  sales: 'sales',
  returns: 'returns',
  stocktakes: 'stocktakes',
  transfer_requests: 'transfer-requests',
  eods: 'eods',
};

let pass = 0, fail = 0;
const failList = [];
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failList.push(name); console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function post(bizPath, docNo, bizType, payload, token = TOKEN, attempt = 1) {
  const resp = await fetch(`${BASE}/api/pos-receiver/${bizPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Erp-Upstream-Token': token,
      'Idempotency-Key': `${bizType}:${docNo}:${attempt}`,
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await resp.json(); } catch { /* ignore */ }
  return { status: resp.status, body };
}

const SKU = 'ST-SPRING-红-S';
const STYLE = 'ST-SPRING';
const COLOR = '红';
const SIZE = 'S';

const payloads = {
  sales: {
    storeId: 'HZ-HB-YT-001', orderNo: 'SO-HTTP-0001', saleDate: new Date().toISOString(),
    totalAmount: 59800, discountAmount: 0, payAmount: 59800, customerId: null,
    items: [{ skuId: SKU, styleId: STYLE, colorId: COLOR, sizeId: SIZE, qty: 2, unitPrice: 29900, tagPrice: 39900, lineAmount: 59800 }],
  },
  returns: {
    storeId: 'HZ-HB-YT-001', returnNo: 'SR-HTTP-0001', originalOrderNo: 'SO-HTTP-0001', returnDate: new Date().toISOString(),
    refundAmount: 29900, reason: '质量问题',
    items: [{ skuId: SKU, styleId: STYLE, colorId: COLOR, sizeId: SIZE, qty: 1, refundPrice: 29900 }],
  },
  transfer_requests: {
    storeId: 'HZ-HB-YT-001', reqNo: 'TR-HTTP-0001', remark: '补货',
    items: [{ skuId: SKU, styleId: STYLE, colorId: COLOR, sizeId: SIZE, reqQty: 10 }],
  },
  stocktakes: {
    storeId: 'HZ-HB-YT-001', stocktakeNo: 'STK-HTTP-0001',
    items: [{ skuId: SKU, styleId: STYLE, colorId: COLOR, sizeId: SIZE, bookQty: 10, actualQty: 9 }],
  },
  eods: {
    storeId: 'HZ-HB-YT-001', eodNo: 'EOD-HTTP-0001', eodDate: new Date().toISOString(), cashierName: '店员A',
    saleCount: 1, refundCount: 0, saleAmount: 59800, refundAmount: 0,
    payments: [{ payMethod: 'WECHAT', payAmount: 59800 }],
  },
};

(async () => {
  console.log('【1】鉴权护栏');
  const noTok = await post('sales', 'A', 'sales', {}, '');
  assert('无 X-Erp-Upstream-Token → 401(UpstreamTokenGuard)', noTok.status === 401, noTok);
  const wrong = await post('sales', 'A', 'sales', {}, 'wrong-token');
  assert('错误令牌 → 401(UpstreamTokenGuard)', wrong.status === 401, wrong);

  console.log('\n【2】五类单据真实 HTTP 推送 + 落库');
  const ok = (s) => s === 200 || s === 201;
  for (const [bizType, bizPath] of Object.entries(PATHS)) {
    const docNo = payloads[bizType][bizType === 'transfer_requests' ? 'reqNo' : bizType === 'stocktakes' ? 'stocktakeNo' : bizType === 'eods' ? 'eodNo' : bizType === 'returns' ? 'returnNo' : 'orderNo'];
    const r = await post(bizPath, docNo, bizType, payloads[bizType]);
    assert(`[${bizType}] HTTP 2xx + success`, ok(r.status) && r.body && r.body.success === true, r);
    assert(`[${bizType}] 返回 erpNo 非空`, !!(r.body && r.body.erpNo), r.body);
    const r2 = await post(bizPath, docNo, bizType, payloads[bizType], TOKEN, 2);
    assert(`[${bizType}] 幂等重推同 erpNo`, ok(r2.status) && r2.body && r2.body.success === true && r2.body.erpNo === (r.body && r.body.erpNo) && r2.body.duplicated === true, r2.body);
  }

  console.log('\n【3】落库证据（pos_receive_log 落地区）');
  const { execSync } = require('child_process');
  const sql = `SELECT biz_type, count(*) FROM pos_receive_log WHERE pos_doc_no IN ('SO-HTTP-0001','SR-HTTP-0001','TR-HTTP-0001','STK-HTTP-0001','EOD-HTTP-0001') GROUP BY biz_type ORDER BY biz_type;`;
  const out = execSync(`PGPASSWORD=erp psql -h localhost -p 5434 -U erp -d erp_db -t -c "${sql}"`, { encoding: 'utf8' });
  const rows = out.split('\n').map((l) => l.trim()).filter(Boolean);
  console.log('    pos_receive_log 命中：', rows.join(' | '));
  const types = rows.map((r) => r.split('|')[0].trim());
  for (const t of ['sales', 'returns', 'stocktakes', 'transfer_requests', 'eod']) {
    assert(`pos_receive_log 含 ${t}`, types.includes(t), rows);
  }

  console.log('\n【4】字段级落库证据（抽查 sales 主表与明细）');
  const salesRows = execSync(`PGPASSWORD=erp psql -h localhost -p 5434 -U erp -d erp_db -t -c "SELECT ro.retail_no, s.code AS store_code, roi.sku_code, roi.quantity, roi.deal_price FROM pos_receive_log prl JOIN retail_order ro ON ro.retail_no=prl.erp_no JOIN store s ON s.id=ro.store_id JOIN retail_order_item roi ON roi.retail_id=ro.id WHERE prl.pos_doc_no='SO-HTTP-0001';"`, { encoding: 'utf8' }).trim();
  console.log('    retail_order 命中：', salesRows.replace(/\n/g, ' | '));
  assert('retail_order 落库 store_code=ST-D01(由 HZ-HB-YT-001 解析)', /ST-D01/.test(salesRows), salesRows);
  assert('retail_order_item 落库 sku_code=ST-SPRING-红-S', /ST-SPRING-红-S/.test(salesRows), salesRows);
  assert('retail_order_item 落库 qty=2', /\|[ ]*2[ ]*\|/.test(salesRows), salesRows);

  console.log(`\n========== 结果：通过 ${pass} / 失败 ${fail} ==========`);
  if (fail > 0) { console.log('失败项：', failList.join(', ')); process.exit(1); }
})().catch((e) => { console.error('脚本异常：', e); process.exit(2); });
