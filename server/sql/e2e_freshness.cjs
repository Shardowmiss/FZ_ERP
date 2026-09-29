// P1-2 验证：登录 -> calc 返回 { items, dataAsOf, daysStale, freshnessAlert, salesStoreCount }
const BASE = 'http://localhost:3000';
const CSRF = 'reprotest';
function req(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json', 'x-suda-csrf-token': CSRF, 'Cookie': 'suda-csrf-token=' + CSRF };
  if (token) headers['x-auth-token'] = token;
  const init = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return fetch(BASE + path, init).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}
(async () => {
  const login = await req('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  const token = login.data?.token || (login.data?.data && login.data.data.token);
  if (!token) { console.log('LOGIN FAIL', login.status, JSON.stringify(login.data).slice(0,200)); return; }
  console.log('login ok, token len', token.length);
  // 取一个 REPL 直营店
  const stores = await req('/api/base/store/options', 'GET', null, token);
  const dir = (stores.data || []).find((s) => s.code === 'ST-REPL-DIR');
  if (!dir) { console.log('no REPL-DIRECT store found'); return; }
  const calc = await req('/api/inventory/replenish-plan/calc', 'POST', {
    storeId: dir.id, n: 30, expectedDays: 14, leadTimeDays: 3, safetyDays: 2, caseQty: 12,
  }, token);
  console.log('calc status', calc.status);
  const d = calc.data || {};
  console.log('keys:', Object.keys(d).join(','));
  console.log('dataAsOf:', d.dataAsOf, '| daysStale:', d.daysStale, '| freshnessAlert:', d.freshnessAlert, '| salesStoreCount:', d.salesStoreCount);
  console.log('items length:', (d.items || []).length);
  console.log(d.items && d.items[0] ? 'first item sample: ' + JSON.stringify(d.items[0]) : 'no items');
  const ok = d.items && typeof d.dataAsOf !== 'undefined' && typeof d.freshnessAlert === 'boolean';
  console.log(ok ? '\n✅ P1-2 calc 富返回结构正确（含时效字段）' : '\n❌ P1-2 结构异常');
})().catch((e) => console.log('ERR', e.message));
