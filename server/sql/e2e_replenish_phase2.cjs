// Phase 2 e2e: 模板 CRUD + 手动执行自动生成 + 定时触发验证
const BASE = 'http://127.0.0.1:3000';
const CSRF = 'reprotest';
const DIR = 'd1111111-1111-1111-1111-111111111111';
const FRAN = 'd2222222-2222-2222-2222-222222222222';
const MAIN = 'b1111111-1111-1111-1111-111111111111';

function jpost(path, body, token) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-suda-csrf-token': CSRF,
      Cookie: `suda-csrf-token=${CSRF}`,
      ...(token ? { 'x-auth-token': token } : {}),
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}
function jget(path, token) {
  return fetch(BASE + path, {
    headers: {
      'x-suda-csrf-token': CSRF,
      Cookie: `suda-csrf-token=${CSRF}`,
      ...(token ? { 'x-auth-token': token } : {}),
    },
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}
function jpatch(path, body, token) {
  return fetch(BASE + path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-suda-csrf-token': CSRF,
      Cookie: `suda-csrf-token=${CSRF}`,
      ...(token ? { 'x-auth-token': token } : {}),
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}
function jdelete(path, token) {
  return fetch(BASE + path, {
    method: 'DELETE',
    headers: {
      'x-suda-csrf-token': CSRF,
      Cookie: `suda-csrf-token=${CSRF}`,
      ...(token ? { 'x-auth-token': token } : {}),
    },
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}

(async () => {
  // 0. login
  const login = await jpost('/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.data?.token || login.data?.data?.token;
  if (!token) {
    console.log('LOGIN FAILED', login.status, JSON.stringify(login.data));
    process.exit(1);
  }
  console.log('login ok, token len=', token.length);

  // 1. create template (manual + scheduled)
  const tplBody = {
    name: 'REPL e2e 模板',
    code: 'REPL-E2E-' + Date.now(),
    scopeType: 'store',
    storeFilter: { ids: [DIR, FRAN] },
    paramN: 30,
    expectedDays: 14,
    leadTimeDays: 0,
    safetyDays: 0,
    caseQty: 1,
    sourceWarehouseRule: 'fixed',
    fixedWarehouseId: MAIN,
    enabled: false, // 先不启用，避免定时骚扰；手动执行测试用
    cron: '* * * * *',
  };
  const created = await jpost('/api/inventory/replenish-template', tplBody, token);
  console.log('\nCREATE template status=', created.status);
  if (created.status >= 300) {
    console.log('CREATE ERR', JSON.stringify(created.data));
    process.exit(1);
  }
  const tplId = created.data.id || created.data.data?.id;
  console.log('template id=', tplId, 'code=', created.data.code || created.data.data?.code);

  // 2. list templates
  const list = await jget('/api/inventory/replenish-template?page=1&pageSize=20', token);
  console.log('LIST status=', list.status, 'rows=', (list.data?.data || list.data || []).length);

  // 3. MANUAL execute -> auto-generate draft docs
  const exec = await jpost('/api/inventory/replenish-template/' + tplId + '/execute', {}, token);
  console.log('\nMANUAL EXECUTE status=', exec.status);
  console.log(JSON.stringify(exec.data, null, 1));

  // 4. scheduled fire test: enable template, wait ~70s, expect >=1 auto doc
  console.log('\n--- 定时触发验证：启用模板，等待 ~70s 跨分钟边界 ---');
  const en = await jpatch('/api/inventory/replenish-template/' + tplId, { enabled: true }, token);
  console.log('ENABLE status=', en.status);
  await new Promise((r) => setTimeout(r, 70000));
  const afterCount = await jget(
    '/api/inventory/replenish-plan?page=1&pageSize=50',
    token,
  );
  console.log('plan list after wait status=', afterCount.status);
  const planData = afterCount.data?.data || afterCount.data || [];
  const autoPlans = (Array.isArray(planData) ? planData : []).filter(
    (p) => p.remark && p.remark.includes(tplBody.code),
  );
  console.log('auto-generated plans for this template =', autoPlans.length);
  console.log(
    'sample auto plan:',
    JSON.stringify(autoPlans.slice(0, 2)),
  );

  // 5. cleanup: disable + delete template
  await jpatch('/api/inventory/replenish-template/' + tplId, { enabled: false }, token);
  const del = await jdelete('/api/inventory/replenish-template/' + tplId, token);
  console.log('\nDELETE template status=', del.status);

  console.log('\n=== E2E PHASE2 DONE ===');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
