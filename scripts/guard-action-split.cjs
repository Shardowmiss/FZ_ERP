// 守卫动作级细化 codemod（#815）
//
// 目标：把控制器里「资源级粗码守卫」(@CheckPermission('res')) 改写为「动作子码」(@CheckPermission('res:action'))，
//       并为缺失守卫的 GET 端点补 res:view，从而让写资源上的冗余粗码可从 OPERATIONAL_ROLES 移除，达成真正最小授权。
//
// 安全约束：
//   · 仅当目标 res:action 确实存在于 rbac_permission 目录时才改写（绝不凭空造码）。
//   · 标准 CRUD 自动映射：Post→create, Put/Patch→edit, Delete→delete；
//     其余（含自定义路由如 /void /approve /submit /accept /print /restore /audit /book /export 等）一律「标记」交人工。
//   · 未守卫的 GET 端点：若文件只有一个粗码资源则补 res:view；多资源则「标记」。
//
// 用法：
//   node scripts/guard-action-split.cjs            # dry-run：打印每个文件的拟改 + 标记
//   node scripts/guard-action-split.cjs --apply     # 应用安全改写（自定义路由与多资源 GET 仍只标记不碰）
//   node scripts/guard-action-split.cjs --file=path # 只处理某文件

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const sql = postgres({
  host: '127.0.0.1',
  port: 5434,
  database: 'erp_db',
  username: 'erp',
  password: 'erp',
});

const MODULES_DIR = path.resolve(__dirname, '../server/modules');
const HTTP_DECORATORS = ['@Get', '@Post', '@Put', '@Patch', '@Delete'];

// 自定义路由映射：语义明确可自动落码 vs 需人工核对
const SAFE_CUSTOM = {
  void: 'void',
  print: 'print',
  submit: 'submit',
  accept: 'accept',
  export: 'view',
  download: 'view',
  restore: 'edit',
};
const FLAG_CUSTOM = {
  approve: 'approve',
  reject: 'approve',
  audit: 'approve',
  review: 'approve',
  book: 'approve',
  cancel: 'edit',
};

function actionFor(method, route, guardCode, catalogSet) {
  const r = (route || '').replace(/^['"`]/, '').replace(/['"`]$/, '');
  // 自定义路由：取最后一个路径段
  const seg = r.split('/').filter(Boolean).pop() || '';
  if (seg && SAFE_CUSTOM[seg] && catalogSet.has(`${guardCode}:${SAFE_CUSTOM[seg]}`)) {
    return SAFE_CUSTOM[seg];
  }
  if (seg && (SAFE_CUSTOM[seg] || FLAG_CUSTOM[seg])) {
    // 自定义路由（含目录无对应码）→ 标记人工
    return null;
  }
  switch (method) {
    case '@Get':
      return 'view';
    case '@Post':
      return 'create';
    case '@Put':
    case '@Patch':
      return 'edit';
    case '@Delete':
      return 'delete';
    default:
      return null;
  }
}

function isCoarseResource(code, resourceCodes) {
  // 2 段且有子码的资源码才算粗码；2 段叶子动作码（如 dashboard:view）视为已动作级，跳过
  const segs = code.split(':');
  return segs.length === 2 && resourceCodes.has(code);
}

function findControllers(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findControllers(p));
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function primaryResource(coarseCodes) {
  if (coarseCodes.length === 1) return coarseCodes[0];
  return null;
}

async function processFile(file, catalogSet, resourceCodes, apply) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const changes = []; // {line, from, to}
  const flags = []; // {line, msg}
  // 收集本文件粗码资源（去重：同一粗码多次出现只计一次，否则单资源文件会被误判为多资源）
  const coarseSet = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/@CheckPermission\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m && isCoarseResource(m[1], resourceCodes)) coarseSet.add(m[1]);
  }
  const coarseCodes = [...coarseSet];
  // 遍历方法装饰器，定位每个方法最近的 @CheckPermission 与 HTTP 装饰器 + 路由
  let i = 0;
  while (i < lines.length) {
    const http = HTTP_DECORATORS.find((h) => lines[i].includes(h + '('));
    if (http) {
      // 提取路由字符串
      const rm = lines[i].match(/@(?:Get|Post|Put|Patch|Delete)\(\s*([^)]*)\)/);
      const route = rm ? rm[1].trim() : '';
      // 向上找紧邻的 @CheckPermission（忽略空行/注释/其它装饰器/多行装饰器内部，遇方法签名即停）
      let j = i - 1;
      let guardLine = -1;
      let guardCode = null;
      let scanned = 0;
      while (j >= 0 && scanned < 12) {
        const l = lines[j].trim();
        const gm = l.match(/@CheckPermission\(\s*['"]([^'"]+)['"]\s*\)/);
        if (gm) {
          guardLine = j;
          guardCode = gm[1];
          break;
        }
        // 命中方法签名/类声明/接口声明 → 已越过本方法，停止
        if (
          l.startsWith('async') ||
          /\)\s*\{?\s*$/.test(l) ||
          l.includes(' implements ') ||
          l.startsWith('export class') ||
          l.startsWith('export abstract class')
        ) {
          break;
        }
        j--;
        scanned++;
      }
      if (guardCode && isCoarseResource(guardCode, resourceCodes)) {
        const action = actionFor(http, route, guardCode, catalogSet);
        if (!action) {
          flags.push({ line: i + 1, msg: `${file}:${i + 1} 自定义路由 ${route} 需人工映射 ${guardCode}` });
        } else {
          const target = `${guardCode}:${action}`;
          if (catalogSet.has(target)) {
            if (target !== guardCode) changes.push({ line: guardLine + 1, from: guardCode, to: target });
          } else {
            flags.push({ line: i + 1, msg: `${file}:${i + 1} 目标 ${target} 不在目录，标记人工` });
          }
        }
      } else if (!guardCode && http === '@Get') {
        // 未守卫的 GET：补 res:view（仅当文件单一资源）
        const res = primaryResource(coarseCodes);
        if (res) {
          const target = `${res}:view`;
          if (catalogSet.has(target)) {
            changes.push({ line: i + 1, from: null, to: target, insertGuard: true });
          } else {
            flags.push({ line: i + 1, msg: `${file}:${i + 1} 目标 ${target} 不在目录，标记人工` });
          }
        } else {
          flags.push({ line: i + 1, msg: `${file}:${i + 1} 多资源文件未守卫 GET 需人工` });
        }
      }
      i++;
    } else {
      i++;
    }
  }
  if (!apply) return { file, changes, flags };
  // 应用：从后往前改，避免行号偏移
  changes.sort((a, b) => b.line - a.line);
  for (const c of changes) {
    if (c.insertGuard) continue; // 本轮不做 view 守卫插入（避免对未持码角色造成 403 回归，单独评估）
    lines[c.line - 1] = lines[c.line - 1].replace(`@CheckPermission('${c.from}')`, `@CheckPermission('${c.to}')`);
  }
  fs.writeFileSync(file, lines.join('\n'));
  return { file, changes, flags };
}

async function main() {
  const catalogRows = await sql`SELECT code FROM rbac_permission`;
  const catalogSet = new Set(catalogRows.map((r) => r.code));
  // 资源粗码集合：2 段且目录中存在以其为父的子码（排除 dashboard:view 之类叶子动作码）
  const resourceCodes = new Set();
  for (const c of catalogSet) {
    const idx = c.lastIndexOf(':');
    if (idx > 0) {
      const parent = c.slice(0, idx);
      if (parent.split(':').length === 2) resourceCodes.add(parent);
    }
  }
  const onlyFile = process.argv.find((a) => a.startsWith('--file='));
  const apply = process.argv.includes('--apply');
  let files = findControllers(MODULES_DIR);
  if (onlyFile) files = [path.resolve(onlyFile.split('=')[1])];

  let totalChanges = 0;
  let totalFlags = 0;
  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    const res = await processFile(f, catalogSet, resourceCodes, apply);
    if (res.changes.length === 0 && res.flags.length === 0) continue;
    console.log(`\n=== ${rel} ===`);
    for (const c of res.changes) {
      if (c.insertGuard) console.log(`  + L${c.line} 插入 @CheckPermission('${c.to}')`);
      else console.log(`  ~ L${c.line} ${c.from} → ${c.to}`);
    }
    for (const fl of res.flags) console.log(`  ! ${fl.msg}`);
    totalChanges += res.changes.length;
    totalFlags += res.flags.length;
  }
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`拟改 ${totalChanges} 处，标记 ${totalFlags} 处（自定义路由/多资源 GET，需人工）`);
  console.log(apply ? '已应用（仅安全改写）' : 'dry-run 未改动文件');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
