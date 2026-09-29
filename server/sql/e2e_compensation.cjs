// P1-4 上行失败补偿机制端到端验证
const BASE = 'http://localhost:3000';
const UP = '8b6352809ba02f641d36a6c81094fdc54167642d92091570346cb3f7e391db4b';
const CSRF = 'reprotest';

function req(path, method, body, token, upstream) {
  const headers = { 'Content-Type': 'application/json', 'x-suda-csrf-token': CSRF, Cookie: `suda-csrf-token=${CSRF}` };
  if (token) headers['x-auth-token'] = token;
  if (upstream) headers['X-Erp-Upstream-Token'] = upstream;
  const init = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return fetch(BASE + path, init).then(async (r) => {
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

async function login() {
  const r = await req('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  if (r.status !== 201 && r.status !== 200) throw new Error('login failed ' + r.status + ' ' + JSON.stringify(r.data));
  return r.data.token || r.data.data?.token;
}

const DOCNO = 'REPL-FAIL-001';

(async () => {
  const token = await login();
  console.log('1) 登录成功, token 长度:', token.length);

  console.log('\n2) 推送销售（有效门店 ST-REPL-DIR，未知 SKU SKU-NOPE-999）→ 预期 400 失败');
  const push = await req('/api/pos-receiver/sales', 'POST', {
    storeCode: 'ST-REPL-DIR',
    orderNo: DOCNO,
    saleDate: '2026-09-27',
    items: [{ skuCode: 'SKU-NOPE-999', color: 'R', size: 'M', quantity: 2, tagPrice: 100, dealPrice: 90, lineAmount: 180 }],
  }, null, UP);
  console.log('   push status =', push.status, '| msg =', push.data?.message || JSON.stringify(push.data));

  console.log('\n3) 查 pos_receive_log：失败应持久化（status=failed + errorMessage + payload）');
  const log1 = await req(`/api/pos-receiver/failures?status=failed&pageSize=5`, 'GET', null, token);
  console.log('   failures status =', log1.status);
  const row = (log1.data?.list || []).find((r) => r.posDocNo === DOCNO);
  console.log('   找到记录:', JSON.stringify(row, null, 1));
  if (!row || row.status !== 'failed') { console.log('   ❌ 失败未持久化'); process.exit(1); }
  const logId = row.id;

  console.log('\n4) 补主数据：插入 SKU-NOPE-999');
  // 直接走 DB 插入最小 sku 行（测试数据）
  const db = require('postgres');
  const sql = db('postgres://erp:erp@localhost:5434/erp_db');
  await sql`INSERT INTO sku (id, sku_code, style_no, color, size) VALUES (gen_random_uuid(), 'SKU-NOPE-999', 'STYLE-REPL', 'R', 'M') ON CONFLICT DO NOTHING`;
  await sql.end();

  console.log('\n5) 重放 /api/pos-receiver/replay/:id → 预期 success');
  const replay = await req(`/api/pos-receiver/replay/${logId}`, 'POST', null, token);
  console.log('   replay status =', replay.status, '| data =', JSON.stringify(replay.data));

  console.log('\n6) 复核日志：应翻为 success，且 retail_order 已生成');
  const log2 = await req(`/api/pos-receiver/failures?status=success&pageSize=5`, 'GET', null, token);
  const row2 = (log2.data?.list || []).find((r) => r.posDocNo === DOCNO);
  console.log('   复核记录:', JSON.stringify(row2, null, 1));
  if (row2 && row2.status === 'success' && replay.data?.success) {
    console.log('\n✅ P1-4 补偿闭环验证通过：失败持久化 → 补主数据 → 重放成功');
  } else {
    console.log('\n❌ 补偿闭环未达成');
    process.exit(1);
  }
})().catch((e) => { console.error('E2E error:', e.message); process.exit(1); });
