const BASE = 'http://127.0.0.1:3000';
const CSRF = 'verify-perm';

function req(path, method, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'x-suda-csrf-token': CSRF,
    'Cookie': 'suda-csrf-token=' + CSRF,
  };
  if (token) headers['x-auth-token'] = token;
  const init = { method, headers, credentials: 'include' };
  if (body) init.body = JSON.stringify(body);
  return fetch(BASE + path, init).then(async (r) => {
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  });
}

(async () => {
  // 1. login admin
  const login = await req('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' }, null);
  const setCookie = login.headers ? login.headers.get ? login.headers.get('set-cookie') : null : null;
  const token =
    login.data && (login.data.token || (login.data.data && login.data.data.token)) ||
    (login.data && login.data.accessToken);
  console.log('login status=', login.status, 'tokenLen=', token ? token.length : 0);

  // 2. calc with new permission code (must be 200, not 403)
  const calc = await req('/api/inventory/replenish-plan/calc', 'POST', {
    storeId: 'd1111111-1111-1111-1111-111111111111',
    n: 30, expectedDays: 14, leadTimeDays: 3, safetyDays: 3, caseQty: 10,
  }, token);
  console.log('calc status=', calc.status, '(expect 200, NOT 403)');

  // 3. templates list with new permission code
  const list = await req('/api/inventory/replenish-template?page=1&pageSize=20', 'GET', null, token);
  console.log('template list status=', list.status, '(expect 200)');

  console.log(calc.status < 300 && list.status < 300
    ? '\n✅ 独立权限码生效：新接口用各自独立码通过 @CheckPermission 守卫（calc=201 为成功码，非 403）'
    : '\n❌ 权限校验异常');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
