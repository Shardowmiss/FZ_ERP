#!/usr/bin/env node
/**
 * 扫描前端页面，分类「是否有写操作」以及「是否已有动作级门控」。
 * 只读页（报表/看板/溯源/日志）只需路由级 hasMenu，无需动作门控 —— 先排除以收窄真实工作量。
 *
 * 用法: node scripts/scan-page-write-actions.cjs [--detail]
 */
const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'client', 'src', 'pages');

/** 已知「会改数据」的 api 方法名（与 api/*.ts 的 create/update/remove 约定一致） */
const WRITE_METHODS = new Set([
  'create', 'update', 'remove', 'delete', 'destroy',
  'addMember', 'removeMember', 'setMembers', 'upsert', 'save',
  'submit', 'audit', 'approve', 'approveAll', 'reject', 'void', 'cancel',
  'confirm', 'reverse', 'merge', 'generate', 'import', 'importJson', 'importExcel',
  'settle', 'close', 'reopen', 'lock', 'unlock', 'enable', 'disable',
  'allocate', 'issue', 'receive', 'post', 'sync', 'bind', 'unbind',
  'reset', 'recalc', 'changeStatus', 'batch', 'batchDelete', 'batchUpdate',
  'upgradeTo', 'adjust', 'confirmReceive', 'finish', 'start', 'stop',
]);

/** 页面级门控信号 */
const GATE_SIGNALS = ['hasPermission', 'CanButton'];

const NON_PAGE_HINTS = /Modal|Form|Dialog|Drawer|Preview|Editor|Picker|Bar$|Table$|Card$|Item$|Cell$|Step|Wizard/;

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { sortable: true })) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = walk(PAGES_DIR).sort();
const rows = files.map((f) => {
  const rel = path.relative(PAGES_DIR, f);
  const src = fs.readFileSync(f, 'utf8');
  const base = path.basename(f, '.tsx');

  // api 调用: xxxApi.resource.method(  或  xxxApi.method(
  const calls = new Set();
  const re = /\b([a-zA-Z][\w]*Api)\s*(?:\.\s*([A-Za-z][\w]*))?\s*\.\s*([A-Za-z][\w]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const [, apiNs, resource, method] = m;
    calls.add(`${apiNs}.${resource ? resource + '.' : ''}${method}`);
  }
  const writeCalls = [...calls].filter((c) => WRITE_METHODS.has(c.split('.').pop()));
  const gated = GATE_SIGNALS.some((s) => src.includes(s));
  const isPage = !NON_PAGE_HINTS.test(base);
  return { rel, base, isPage, gated, writeCalls, calls: [...calls] };
});

const pages = rows.filter((r) => r.isPage);
const comps = rows.filter((r) => !r.isPage);

const summary = {
  页面总数: pages.length,
  子组件数: comps.length,
  已有门控: pages.filter((r) => r.gated).length,
  有写操作: pages.filter((r) => r.writeCalls.length > 0).length,
  有写操作且未门控: pages.filter((r) => r.writeCalls.length > 0 && !r.gated).length,
  有写操作已门控: pages.filter((r) => r.writeCalls.length > 0 && r.gated).length,
  纯只读页: pages.filter((r) => r.writeCalls.length === 0).length,
  只读但未门控: pages.filter((r) => r.writeCalls.length === 0 && !r.gated).length,
};
console.log('=== 汇总 ===');
console.table(summary);

if (process.argv.includes('--detail')) {
  console.log('\n=== A. 有写操作 + 未门控（必须补） ===');
  for (const r of pages.filter((x) => x.writeCalls.length > 0 && !x.gated)) {
    console.log(`${r.rel}\n    ${r.writeCalls.join(', ')}`);
  }
  console.log('\n=== B. 有写操作 + 已门控（复核即可） ===');
  for (const r of pages.filter((x) => x.writeCalls.length > 0 && x.gated)) {
    console.log(`${r.rel}\n    ${r.writeCalls.join(', ')}`);
  }
  console.log('\n=== C. 纯只读页（无需动作门控） ===');
  for (const r of pages.filter((x) => x.writeCalls.length === 0)) {
    console.log(`${r.rel}   ${r.gated ? '[已门控]' : ''}`);
  }
  console.log('\n=== D. 子组件（非页面，门控放调用方） ===');
  for (const r of comps) console.log(`${r.rel}   ${r.gated ? '[已门控]' : ''}`);
}
