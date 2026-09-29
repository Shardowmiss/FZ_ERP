/**
 * POS ↔ ERP 上行路由契约自检（零依赖，纯文本解析）。
 *
 * 背景：代码级复核发现 P0-a 的 ERP 接收端 5 个路由中有 2 个与 POS 真实发出的 URL 不符
 * （POS 发 /transfer-requests、/eods；ERP 原注册 /transfer_requests、/eod），上线即 404。
 * 原 sim-pos-receiver.cjs 直接 new Service 调方法，不经过 HTTP 路由，是“假绿”。
 *
 * 本脚本直接解析两端源码，断言「POS upstreamPath 实际发出的 URL」===「ERP 控制器真实路由」，
 * 作为路由级回归护栏（CI 可调用：node verify-pos-erp-contract.cjs）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POS_ADAPTER = path.resolve(
  ROOT,
  '../pos-review/pos-review/server/modules/erp-integration/real-erp.adapter.ts',
);
const ERP_CTRL = path.resolve(ROOT, 'server/modules/pos-receiver/pos-receiver.controller.ts');

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  \u2713', name);
  } else {
    fail++;
    console.log('  \u2717 FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

/** 提取 POS 适配器 upstreamPath 映射：{ key: '/path' } */
function parsePosUpstreamPaths(file) {
  const src = fs.readFileSync(file, 'utf8');
  // 定位 upstreamPath(bizType) { const map = { ... } }
  const m = src.match(/upstreamPath\([\s\S]*?const map\s*:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\};/);
  if (!m) throw new Error('无法在 POS 适配器定位 upstreamPath 映射');
  const body = m[1];
  const out = {};
  const re = /(\w+)\s*:\s*'([^']+)'/g;
  let r;
  while ((r = re.exec(body))) {
    out[r[1]] = r[2]; // key -> '/sales' 等
  }
  return out;
}

/** 提取 ERP 控制器 @Controller('prefix') + 全部 @Post('sub') */
function parseErpRoutes(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ctrl = src.match(/@Controller\(\s*'([^']+)'\s*\)/);
  if (!ctrl) throw new Error('无法在 ERP 控制器定位 @Controller 前缀');
  const prefix = ctrl[1]; // 'api/pos-receiver'
  const posts = [];
  const re = /@Post\(\s*'([^']+)'\s*\)/g;
  let r;
  while ((r = re.exec(src))) posts.push(r[1]);
  return { prefix, routes: posts };
}

console.log('【POS↔ERP 上行路由契约自检】');

const posPaths = parsePosUpstreamPaths(POS_ADAPTER);
const { prefix, routes: erpRoutes } = parseErpRoutes(ERP_CTRL);

console.log('  POS upstreamPath 实际 URL:', JSON.stringify(posPaths));
console.log(`  ERP 控制器路由前缀: ${prefix}/`);
console.log('  ERP @Post 路由:', JSON.stringify(erpRoutes));

const expected = Object.values(posPaths).map((p) => p.replace(/^\//, '')); // 'sales' 等（去掉前导/）

console.log('\n【断言：每个 POS 实际 URL 必须被 ERP 路由精确覆盖】');
for (const sub of expected) {
  const full = `${prefix}/${sub}`;
  assert(`ERP 注册路由覆盖 ${full}`, erpRoutes.includes(sub), { erpRoutes });
}

// 反向：ERP 不应有多余的、POS 不会调用的上行路由（避免静默错配）
console.log('\n【断言：ERP 路由不得有 POS 永不调用的多余项】');
for (const r of erpRoutes) {
  assert(`ERP 路由 ${prefix}/${r} 有对应 POS 调用`, expected.includes(r), { expected });
}

console.log(`\n========== 路由契约: pass=${pass} fail=${fail} ==========`);
process.exit(fail === 0 ? 0 : 1);
