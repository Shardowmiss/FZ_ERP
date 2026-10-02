// 真实 HTTP 端到端冒烟：验证 md:merge 权限修复后，合并全链路（候选/合并/审计/回滚）
// 经真实控制器 + @CheckPermission('md:merge') 守卫可通行（修复前对任何人 403）。
// 测试客户由 psql 预置（固定 UUID 经环境变量传入），避免依赖未知的 create 端点。
// 写操作需自签 ERP CSRF 令牌：登录响应下发 erp-csrf cookie，按 double-submit 回放为
// cookie + x-erp-csrf header（ErpCsrfGuard 校验）。
const BASE = 'http://127.0.0.1:3000/client';
const SUDA_CSRF = 'verify-perm';

const SURVIVOR = process.env.SMOKE_SURVIVOR_ID;
const MERGED = process.env.SMOKE_MERGED_ID;
const ENTITY = process.env.SMOKE_ENTITY || 'customer';
if (!SURVIVOR || !MERGED) {
  console.error('缺少 SMOKE_SURVIVOR_ID / SMOKE_MERGED_ID 环境变量');
  process.exit(2);
}

function parseCookie(setCookieArr, name) {
  for (const c of setCookieArr || []) {
    const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    if (m) return m[1];
  }
  return null;
}

// 缓存 erp-csrf 令牌（登录后抓取一次）
let erpCsrf = null;

async function req(path, method, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'x-suda-csrf-token': SUDA_CSRF,
    Cookie: 'suda-csrf-token=' + SUDA_CSRF,
  };
  // 写操作附加 ERP 自签 CSRF（double-submit）
  if (method !== 'GET' && erpCsrf) {
    headers['x-erp-csrf'] = erpCsrf;
    headers['Cookie'] += `; erp-csrf=${erpCsrf}`;
  }
  if (token) headers['x-auth-token'] = token;
  const init = { method, headers };
  if (body && method !== 'GET') init.body = JSON.stringify(body);
  const r = await fetch(BASE + path, init);
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') || '').split(', ');
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data, setCookie };
}

(async () => {
  const login = await req('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' }, null);
  erpCsrf = parseCookie(login.setCookie, 'erp-csrf');
  const token =
    (login.data && (login.data.token || (login.data.data && login.data.data.token))) ||
    (login.data && login.data.accessToken);
  console.log('[login]', login.status, 'token?', !!token, 'erpCsrf?', !!erpCsrf);
  if (!token) { console.error('登录失败，无法继续'); process.exit(2); }
  if (!erpCsrf) { console.error('未抓到 erp-csrf cookie（写操作将 403）'); process.exit(3); }

  // 1) 候选发现（GET，无 CSRF 要求；修复前 403）
  const cand = await req(`/api/md-merge/${ENTITY}/candidates?limit=50`, 'GET', null, token);
  const candCount = Array.isArray(cand.data) ? cand.data.length : 'n/a';
  console.log('[candidates]', cand.status, '组数=', candCount, '(expect 200, NOT 403)');

  // 2) 执行合并（POST，需 erp-csrf）
  const merge = await req(
    `/api/md-merge/${ENTITY}/merge`,
    'POST',
    { survivorId: SURVIVOR, mergedIds: [MERGED], reason: 'smoke-e2e' },
    token,
  );
  const runId = merge.data && merge.data.runId;
  console.log('[merge]', merge.status, 'runId=', runId, '(expect 201, NOT 403)');

  // 3) 审计日志列表（GET；修复前路由缺失→404，修复后 200）
  const logs = await req(`/api/md-merge/${ENTITY}/merge-logs?reversed=false`, 'GET', null, token);
  const found = Array.isArray(logs.data) && logs.data.some((l) => l.runId === runId);
  console.log('[merge-logs]', logs.status, '命中批次?', found, '(expect 200 且命中)');

  // 4) 整批回滚（POST，需 erp-csrf）
  let revStatus = 'skip';
  let revData = null;
  if (runId) {
    const rev = await req(`/api/md-merge/${ENTITY}/merge/${runId}/reverse`, 'POST', { runId }, token);
    revStatus = rev.status; revData = rev.data;
  }
  console.log('[reverse]', revStatus, JSON.stringify(revData), '(expect 200, reversed=1)');

  const ok =
    cand.status === 200 &&
    merge.status === 201 &&
    logs.status === 200 && found &&
    revStatus === 201 && revData && revData.reversed === 1;

  console.log(ok
    ? '\n✅ md:merge 端到端冒烟通过：候选/合并/审计/回滚全程经真实守卫放行'
    : '\n❌ 端到端冒烟异常，见上方状态码');
  process.exit(ok ? 0 : 4);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
