#!/usr/bin/env node
/**
 * 建立「前端页面文件 → 权限码」映射，来源唯一：menuConfig.tsx 的 routeComponents 注册表。
 * 用于 #807 批量给页面接动作级门控时确定每个页面该用哪个资源码。
 *
 * 用法: node scripts/map-page-permission.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MENU = path.join(ROOT, 'client', 'src', 'config', 'menuConfig.tsx');
const src = fs.readFileSync(MENU, 'utf8');

// 抓 routeComponents 块
const start = src.indexOf('export const routeComponents');
const end = src.indexOf('\n};', start);
const block = src.slice(start, end);

/** 解析每条:  '/path': { component: X, permission: 'code', edit: () => import('.../YPage') } */
const entryRe = /'([^']+)':\s*\{([^}]*(?:\}[^}]*)*?)\}/g;
const compToCode = new Map();
const fileToCode = new Map();
let m;
while ((m = entryRe.exec(block))) {
  const [, routePath, body] = m;
  const perm = (body.match(/permission:\s*'([^']+)'/) || [])[1];
  if (!perm) continue;
  const comp = (body.match(/component:\s*([A-Za-z_][\w]*)/) || [])[1];
  if (comp) compToCode.set(comp, { code: perm, routePath });
  const editImp = body.match(/edit:\s*\(\)\s*=>\s*import\(\s*'([^']+)'/);
  if (editImp) {
    // import 路径无扩展名，页面文件有 .tsx，统一按「去扩展名」对齐
    const f = path.basename(editImp[1]).replace(/\.tsx$/, '');
    fileToCode.set(f, { code: perm, routePath: routePath + '/:id/edit' });
  }
}

// 反查：页面文件 basename (XxxPage) 是否在 component 名里出现
const pagesDir = path.join(ROOT, 'client', 'src', 'pages');
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const compNames = [...compToCode.keys()];
const rows = walk(pagesDir).sort().map((f) => {
  const rel = path.relative(pagesDir, f);
  const base = path.basename(f, '.tsx');
  let hit = fileToCode.get(path.basename(f, '.tsx'));
  if (!hit) {
    // 组件名可能被重命名导入:  e.g. ProductionBomPage -> 文件 BomPage.tsx
    const cand = compNames.filter((c) => base && (c === base || c.endsWith(base) || base.endsWith(c)));
    if (cand.length) hit = compToCode.get(cand[0]);
  }
  return { rel, base, code: hit ? hit.code : null, route: hit ? hit.routePath : null };
});

const unmapped = rows.filter((r) => !r.code);
console.log(`页面文件 ${rows.length} 个；已映射 ${rows.length - unmapped.length}；未映射 ${unmapped.length}`);
if (unmapped.length) {
  console.log('\n=== 未映射（需人工判断资源码；多为子组件或孤儿页） ===');
  for (const r of unmapped) console.log(`  ${r.rel}`);
}
console.log('\n=== 映射表 ===');
for (const r of rows.filter((x) => x.code)) {
  console.log(`${r.rel.padEnd(52)} ${r.code}`);
}
