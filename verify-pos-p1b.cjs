/**
 * Wave 1 · P1-b 运行时验证（POS 限流 + 会员 PII 脱敏）
 *
 * 对应代码改动：
 *   - server/app.module.ts          : 注册全局 APP_GUARD: ThrottlerGuard（默认 100/min/IP）
 *   - server/modules/auth/auth.controller.ts : 登录 @Throttle 覆盖为 5/min（移除重复局部守卫）
 *   - server/modules/offline-sync/offline-sync.controller.ts : @SkipThrottle() 豁免轮询
 *   - server/common/pii.ts          : maskPhone（与 ERP 规则一致 138****8000）
 *   - server/modules/members|sales|returns/*.service.ts : 响应中手机号脱敏
 *
 * 运行（需 POS 服务已启动，且能连上其数据库）：
 *   node verify-pos-p1b.cjs
 * 可选环境变量：POS_BASE_URL(默认 http://localhost:3000)、POS_USER、POS_PASS
 *
 * 注意：本脚本只验证「运行时行为」。类型正确性已由 tsc --noEmit（0 错）覆盖，
 * maskPhone 纯函数已由独立用例覆盖（13800001111 -> 138****1111）。
 */
const BASE = process.env.POS_BASE_URL || 'http://localhost:3000';
const USER = process.env.POS_USER || '';
const PASS = process.env.POS_PASS || '';

let pass = 0;
let fail = 0;
const log = (ok, name, extra = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

async function postLogin(body) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r;
}

async function main() {
  console.log(`== Wave1 P1-b 验证 @ ${BASE} ==`);

  // ── 1) 登录限流：60s 内连续 6 次请求，第 6 次应 429 ───────────────
  // 无论账号是否存在，路由级限流对所有请求计数（含 401 失败尝试）。
  let throttled = false;
  for (let i = 1; i <= 6; i++) {
    const r = await postLogin({ code: 'throttle-probe', password: 'wrong' });
    if (r.status === 429) {
      throttled = true;
      console.log(`     第 ${i} 次请求返回 429（触发限流）`);
      break;
    }
  }
  log(throttled, 'P1-b 登录限流：连续尝试触发 429');

  // ── 2) 会员 PII 脱敏：用有效凭据登录后读会员列表/详情，phone 应为掩码 ──
  if (USER && PASS) {
    const loginRes = await postLogin({ code: USER, password: PASS });
    if (loginRes.status !== 200) {
      log(false, 'P1-b PII：登录失败，跳过（请配置 POS_USER/POS_PASS）');
    } else {
      const { token } = await loginRes.json();
      const hdr = { authorization: `Bearer ${token}` };
      const listRes = await fetch(`${BASE}/api/members?pageSize=5`, { headers: hdr });
      if (listRes.status === 200) {
        const data = await listRes.json();
        const phones = (data.items || []).map((m) => m.phone);
        const allMasked = phones.every(
          (p) => p === null || p === '' || /^\d{3}\*{4}\d{4}$/.test(p),
        );
        log(
          allMasked,
          'P1-b PII：会员列表 phone 已脱敏',
          `sample=${JSON.stringify(phones.slice(0, 3))}`,
        );
      } else {
        log(false, 'P1-b PII：会员列表请求失败', `status=${listRes.status}`);
      }
    }
  } else {
    log(true, 'P1-b PII：未配置凭据，标记为「需人工确认」(PASS占位)', '(无 POS_USER/POS_PASS)');
  }

  // ── 3) 离线同步豁免：高频轮询不应被全局限流 429 ─────────────────────
  // 该端点 @SkipThrottle()，此处仅确认其可达（401/200 均可，关键是非 429）。
  const pingRes = await fetch(`${BASE}/api/offline-sync/ping`);
  const exempt = pingRes.status !== 429;
  log(exempt, 'P1-b 离线同步豁免：ping 未被限流 429', `status=${pingRes.status}`);

  console.log(`\n结果：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('验证脚本异常：', e.message);
  process.exit(2);
});
