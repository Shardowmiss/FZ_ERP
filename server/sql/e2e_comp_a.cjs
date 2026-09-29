// P1-4 补偿机制验证 - Part A：推送含未知SKU的销售单（应失败并留痕）
const BASE = 'http://localhost:3000';
const UP = '8b6352809ba02f641d36a6c81094fdc54167642d92091570346cb3f7e391db4b';
const CSRF = 'reprotest';

function req(path, method, body, token, extra = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-suda-csrf-token': CSRF, 'Cookie': `suda-csrf-token=${CSRF}` };
  if (token) headers['x-auth-token'] = token;
  Object.assign(headers, extra);
  const init = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return fetch(BASE + path, init).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

(async () => {
  // 1) admin 登录
  const login = await req('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  const token = login.data?.token;
  console.log('admin token len:', token ? token.length : 0);

  // 2) 推送含未知SKU的销售单（上游令牌鉴权），应 400 + 留痕
  const payload = {
    storeCode: 'ST-REPL-DIR',
    orderNo: 'REPL-COMP-001',
    saleDate: '2026-09-20',
    totalAmount: 100,
    discountAmount: 0,
    receivableAmount: 100,
    receivedAmount: 100,
    changeAmount: 0,
    items: [
      { skuCode: 'ZZZ-UNKNOWN-001', styleNo: 'ZZZ-UNKNOWN', color: '红', size: 'M', quantity: 2, tagPrice: 50, dealPrice: 50, lineAmount: 100 },
    ],
  };
  const push = await req('/api/pos-receiver/sales', 'POST', payload, null, {
    'X-Erp-Upstream-Token': UP,
    'Idempotency-Key': 'sales:REPL-COMP-001:1',
  });
  console.log('PUSH sales (unknown SKU) status=', push.status, '| msg=', push.data?.error?.message || push.data?.message || '');

  // 3) 查 failures（admin token + 权限）
  const f = await req('/api/pos-receiver/failures?status=failed', 'GET', null, token);
  console.log('FAILURES status=', f.status);
  const list = f.data?.list || [];
  const row = list.find((r) => r.posDocNo === 'REPL-COMP-001');
  console.log('FAILURES rows found:', list.length, '| target row:', row ? JSON.stringify(row) : 'NOT FOUND');
  if (row) require('fs').writeFileSync('/tmp/fail_id.txt', row.id);
  console.log(row ? '\n✅ Part A 通过：推送失败 → 产生 failed 日志（含 payload 与 errorMessage）' : '\n❌ 未产生 failed 日志');
})();
