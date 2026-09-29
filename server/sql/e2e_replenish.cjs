// 端到端验证补货管理 calc + generate（真后端 + 真种子数据）
const BASE = 'http://127.0.0.1:3000';
const CSRF = 'reprotest';
const DIR = 'd1111111-1111-1111-1111-111111111111';   // ST-REPL-DIR 直营店
const FRAN = 'd2222222-2222-2222-2222-222222222222';  // ST-REPL-FRAN 加盟店
const MAIN_WH = 'b1111111-1111-1111-1111-111111111111'; // WH-REPL-MAIN

function hd(token) {
  return {
    'Content-Type': 'application/json',
    'suda-csrf-token': CSRF,
    'x-suda-csrf-token': CSRF,
    Cookie: `suda-csrf-token=${CSRF}`,
    ...(token ? { 'x-auth-token': token } : {}),
  };
}

async function jpost(path, body, token) {
  const r = await fetch(BASE + path, { method: 'POST', headers: hd(token), body: JSON.stringify(body) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
async function jget(path, token) {
  const r = await fetch(BASE + path, { method: 'GET', headers: hd(token) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}

(async () => {
  // 1. login
  const login = await jpost('/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.data && (login.data.token || (login.data.data && login.data.data.token));
  console.log('LOGIN status=', login.status, 'token?', !!token);
  if (!token) { console.log('LOGIN BODY', JSON.stringify(login.data).slice(0, 400)); return; }

  // 2. calc 直营店 (direct)
  const calcDir = await jpost('/api/inventory/replenish-plan/calc', {
    storeId: DIR, n: 30, expectedDays: 10, leadTimeDays: 3, safetyDays: 2, caseQty: 12,
  }, token);
  console.log('\nCALC direct status=', calcDir.status);
  console.log(JSON.stringify(calcDir.data, null, 1));

  // 3. calc 加盟店 (franchise)
  const calcFran = await jpost('/api/inventory/replenish-plan/calc', {
    storeId: FRAN, n: 30, expectedDays: 10, leadTimeDays: 3, safetyDays: 2, caseQty: 12,
  }, token);
  console.log('\nCALC franchise status=', calcFran.status);
  console.log(JSON.stringify(calcFran.data, null, 1));

  // 4. generate 直营店 -> 调拨单
  if (calcDir.status < 300 && Array.isArray(calcDir.data)) {
    const items = calcDir.data.filter(i => i.suggestedQty > 0).map(i => ({ skuId: i.skuId, suggestedQty: i.suggestedQty }));
    const genDir = await jpost('/api/inventory/replenish-plan/generate', {
      storeId: DIR, sourceWarehouseId: MAIN_WH, items, remark: 'REPL-TEST-direct',
    }, token);
    console.log('\nGENERATE direct (调拨单) status=', genDir.status);
    console.log(JSON.stringify(genDir.data, null, 1));
  }

  // 5. generate 加盟店 -> 销售订单
  if (calcFran.status < 300 && Array.isArray(calcFran.data)) {
    const items = calcFran.data.filter(i => i.suggestedQty > 0).map(i => ({ skuId: i.skuId, suggestedQty: i.suggestedQty }));
    const genFran = await jpost('/api/inventory/replenish-plan/generate', {
      storeId: FRAN, sourceWarehouseId: MAIN_WH, items, remark: 'REPL-TEST-franchise',
    }, token);
    console.log('\nGENERATE franchise (销售订单) status=', genFran.status);
    console.log(JSON.stringify(genFran.data, null, 1));
  }

  // 6. list plans
  const list = await jget('/api/inventory/replenish-plan', token);
  console.log('\nLIST plans status=', list.status, 'total=', list.data && list.data.total);
})().catch(e => { console.error('ERR', e); process.exit(1); });
