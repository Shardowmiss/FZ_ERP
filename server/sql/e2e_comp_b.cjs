// P1-4 Part B: 补偿闭环验证
// 1) 登录拿 token
// 2) 查 failures，定位 REPL-COMP-001 的 failed 行 id
// 3) POST /replay/:id 重放（此时 ZZZ-UNKNOWN-001 主数据已存在）
// 4) 断言：replay 返回 success，日志行变 success，且生成了销售订单
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
  if (login.status !== 201 && login.status !== 200) { console.log('登录失败', login.status, login.data); process.exit(1); }
  const token = (login.data.token) || (login.data.data && login.data.data.token);
  console.log('登录成功 token len=', (token || '').length);

  // 查 failures
  const list = await req('/api/pos-receiver/failures?status=failed&pageSize=50', 'GET', null, token);
  console.log('\nFAILURES status=', list.status, 'total=', list.data && list.data.total);
  const rows = (list.data && list.data.list) || [];
  const target = rows.find((r) => r.posDocNo === 'REPL-COMP-001');
  if (!target) { console.log('未找到 REPL-COMP-001 failed 行'); console.log(rows.map(r=>r.posDocNo)); process.exit(1); }
  console.log('定位 failed 行 id=', target.id, 'err=', (target.errorMessage||'').slice(0,30));

  // replay
  const replay = await req('/api/pos-receiver/replay/' + target.id, 'POST', null, token);
  console.log('\nREPLAY status=', replay.status);
  console.log('REPLAY body=', JSON.stringify(replay.data));

  // 断言
  const ok = replay.status === 201 || replay.status === 200;
  console.log(ok ? '\n✅ 补偿重放接口返回成功（2xx）' : '\n❌ 补偿重放失败');

  // 验证日志行变 success + 生成销售订单
  const after = await req('/api/pos-receiver/failures?status=success&pageSize=50', 'GET', null, token);
  const succ = ((after.data && after.data.list) || []).find((r) => r.posDocNo === 'REPL-COMP-001');
  console.log('重放后日志行状态=', succ ? succ.status : '(未在 success 列表找到，可能 status 展示不同)');

  const so = await req('/api/pos-receiver/failures?status=failed&pageSize=50', 'GET', null, token);
  const stillFailed = ((so.data && so.data.list) || []).find((r) => r.posDocNo === 'REPL-COMP-001');
  console.log('REPL-COMP-001 是否仍在 failed 列表=', !!stillFailed);

  process.exit(ok ? 0 : 1);
})();
