#!/usr/bin/env node
/**
 * #807 前端按钮级门控 codemod（默认 dry-run，需 --apply 才写盘）
 *
 * 做什么：
 *   1) 给目标页面注入 `usePageActions('<资源码>')` 调用（资源码取自 menuConfig.routeComponents）
 *   2) 把「会改数据」的按钮用 `{canXxx && ( ... )}` 包起来
 *
 * 不做/不会：
 *   - 不动「查询/重置/导出/确定/取消」这类非业务按钮（SAFE_WORDS 显式排除）
 *   - 不改任何业务逻辑，只是包一层条件渲染；后端守卫仍是安全边界
 *
 * 用法:
 *   node scripts/gate-page-actions.cjs            # dry-run，打印将要改的按钮
 *   node scripts/gate-page-actions.cjs --apply    # 落盘
 */
const fs = require('fs');
const path = require('path');

const PAGES = path.join(__dirname, '..', 'client', 'src', 'pages');

/** 目标页 → 资源码（来源: scripts/map-page-permission.cjs 由 menuConfig.routeComponents 派生） */
const TARGETS = {
  'base/ColorGroupPage.tsx': 'base:color-group',
  'base/DealerPage.tsx': 'base:dealer',
  'base/MaterialPage.tsx': 'base:material',
  'base/ProductImportPage.tsx': 'base:import',
  'base/SizeGroupRelationPage.tsx': 'base:size-group',
  'base/SizePage.tsx': 'base:size',
  'base/SkuPage.tsx': 'base:sku',
  'base/StorePage.tsx': 'base:store',
  'base/StyleAttrDefPage.tsx': 'base:style-attribute',
  'base/StyleAttributePage.tsx': 'base:style-attribute',
  'base/SupplierPage.tsx': 'base:supplier',
  'bom/BomPage.tsx': 'base:material',
  'finance/MonthClosePage.tsx': 'finance:month_close',
  'finance/PaymentEditPage.tsx': 'finance:payment',
  'finance/PaymentPage.tsx': 'finance:payment',
  'finance/ReceiptEditPage.tsx': 'finance:receipt',
  'finance/ReceiptPage.tsx': 'finance:receipt',
  'inventory/InventoryStocktakeEditPage.tsx': 'inventory:stocktake',
  'inventory/InventoryStocktakePage.tsx': 'inventory:stocktake',
  'inventory/InventoryTransferEditPage.tsx': 'inventory:transfer',
  'inventory/InventoryTransferPage.tsx': 'inventory:transfer',
  'omni/OmniPage.tsx': 'omni:manage',
  'production/BomPage.tsx': 'production:bom',
  'production/FinishReceiptEditPage.tsx': 'production:finish_receipt',
  'production/FinishReceiptPage.tsx': 'production:finish_receipt',
  'production/MaterialIssueEditPage.tsx': 'production:material_issue',
  'production/MaterialIssuePage.tsx': 'production:material_issue',
  'production/MaterialPurchaseInboundEditPage.tsx': 'production:material_inbound',
  'production/MaterialPurchaseInboundPage.tsx': 'production:material_inbound',
  'production/MaterialPurchaseOrderEditPage.tsx': 'production:material_order',
  'production/MaterialPurchaseOrderPage.tsx': 'production:material_order',
  'production/WorkOrderEditPage.tsx': 'production:work_order',
  'production/WorkOrderPage.tsx': 'production:work_order',
  'purchase/GarmentPurchaseInboundEditPage.tsx': 'purchase:inbound',
  'purchase/GarmentPurchaseOrderEditPage.tsx': 'purchase:order',
  'purchase/GarmentPurchaseOrderPage.tsx': 'purchase:order',
  'purchase/GarmentPurchaseReturnEditPage.tsx': 'purchase:return',
  'purchase/GarmentPurchaseReturnPage.tsx': 'purchase:return',
  'purchase/PurchaseInboundEditPage.tsx': 'purchase:inbound',
  'purchase/PurchaseOrderEditPage.tsx': 'purchase:order',
  'purchase/PurchaseOrderPage.tsx': 'purchase:order',
  'purchase/ReconciliationPage.tsx': 'purchase:reconciliation',
  'retail/RetailOrderEditPage.tsx': 'sales:retail',
  'retail/RetailOrderPage.tsx': 'sales:retail',
  'sales/ReconciliationPage.tsx': 'sales:reconciliation',
  'system/RoleManagePage.tsx': 'system:role',
  'system/SystemConfigPage.tsx': 'system:config',
  'system/UserManagePage.tsx': 'system:user',
  'trade-show/AllocationPage.tsx': 'tradeshow:allocation',
  'trade-show/PreOrderPage.tsx': 'tradeshow:preorder',
  'trade-show/TradeShowPage.tsx': 'tradeshow:manage',
};

/**
 * 明确不做门控的按钮（文案特征）。
 * 例：月结页弹窗的确认按钮文案是 `confirmType === 'close' ? '确认月结' : '确认反月结'`，
 * 同一个按钮服务两个动作，挂任何一个单动作码都会误藏；其触发按钮（月结/反月结）已分别门控，
 * 弹窗本身无需再控。
 */
const EXCLUDE = [
  /confirmType === 'close' \? '确认月结'/,
];

/** 顺序敏感：先判安全词，再按顺序匹配动作 */
const SAFE_WORDS = [
  '查询', '搜索', '重置', '刷新', '返回', '关闭', '取消', '确定', '导出', '打印',
  '预览', '展开', '收起', '详情', '查看', '上一步', '下一步', '下载', '上传', '选择',
  '全选', '清空', '复制', '更多', '筛选', '高级', '保存为模板',
];

const ACTION_WORDS = [
  ['void', ['作废', '反审核', '反月结', '弃审', '驳回', '拒绝']],
  ['submit', ['提交', '送审']],
  ['approve', ['审核', '审批', '过账', '记账', '结账', '结算', '月结', '验收', '确认收货', '收货确认', '通过', '批准', '发布']],
  ['delete', ['删除', '移除']],
  // 保存：新建态靠 create、编辑态靠 edit，故单列 canSave（见 usePageActions 注释）
  ['save', ['保存']],
  ['create', ['新增', '新建', '创建', '添加', '导入', '生成']],
  ['edit', ['修改', '编辑', '调整', '设置', '关联', '绑定', '解绑']],
];

const VAR_OF = {
  create: 'canCreate', edit: 'canEdit', delete: 'canDelete',
  approve: 'canApprove', void: 'canVoid', submit: 'canSubmit',
  save: 'canSave',
};

/** DocPage 共享组件里保存按钮由 onSave 控制（无 onSave 即不渲染）→ 门控点在这里 */
const ONSAVE_RULES = [
  [/onSave=\{viewOnly \? undefined : handleSave\}/, 'onSave={!viewOnly && canSave ? handleSave : undefined}'],
  [/onSave=\{!viewOnly \? handleSave : undefined\}/, 'onSave={!viewOnly && canSave ? handleSave : undefined}'],
  [/onSave=\{handleSave\}/, 'onSave={canSave ? handleSave : undefined}'],
  [/onSave=\{!viewOnly && isNew \? handleSave : undefined\}/, 'onSave={!viewOnly && isNew && canCreate ? handleSave : undefined}'],
  [/onSave=\{showSave \? handleSave : undefined\}/, 'onSave={showSave && canSave ? handleSave : undefined}'],
];

/** 从 `<button` 起始位置找到开标签真正的 `>`（引号与括号深度感知） */
function findTagEnd(src, start) {
  let q = null;      // 当前引号 ' " `
  let depth = 0;     // () 与 {} 合计深度
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '{') { depth++; continue; }
    if (c === ')' || c === '}') { depth--; continue; }
    if (c === '>' && depth === 0) return i;
  }
  return -1;
}

function buttonBlocks(src) {
  const out = [];
  const re = /<(button|Button)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1];
    const start = m.index;
    const closeIdx = src.indexOf(`</${tag}>`, start);
    if (closeIdx < 0) continue;
    const end = closeIdx + `</${tag}>`.length;
    // 块内容：开标签的结束 > 必须按「引号 + 括号/花括号深度」扫描，
    // 否则 `onClick={() => x()}` 里箭头的 > 会被当成标签结束，把属性混进文案匹配。
    const openEnd = findTagEnd(src, start) + 1;
    const content = src.slice(openEnd, closeIdx);
    // 行首缩进
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const indent = src.slice(lineStart, start).match(/^\s*/)[0];
    out.push({ start, end, lineStart, indent, content, tag });
  }
  return out;
}

function detectActions(content) {
  // 安全词优先：命中即不门控（弹窗的 确定/取消、查询等）
  if (SAFE_WORDS.some((w) => content.includes(w))) {
    // 但如果同时含明确的写动作词（如「确定删除」），仍要门控
    const strong = ['删除', '作废', '审核', '提交', '新增'];
    if (!strong.some((w) => content.includes(w))) return null;
  }
  const hits = [];
  for (const [act, words] of ACTION_WORDS) {
    if (words.some((w) => content.includes(w))) hits.push(act);
  }
  if (!hits.length) return null;
  // 三元文案（编辑/新增共存）→ 用 canSave
  if (hits.includes('create') && hits.includes('edit')) return ['save'];
  return hits;
}

function processFile(rel, code, apply) {
  const file = path.join(PAGES, rel);
  if (!fs.existsSync(file)) return { rel, error: '文件不存在' };
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('usePageActions')) return { rel, skipped: '已接入 usePageActions' };

  const blocks = buttonBlocks(src).filter((b) => detectActions(b.content));
  const usedVars = new Set();
  const log = [];

  // (0) DocPage 共享保存按钮：onSave 规则改写
  for (const [re, to] of ONSAVE_RULES) {
    if (re.test(src)) {
      const varName = to.includes('canCreate') ? 'canCreate' : 'canSave';
      usedVars.add(varName);
      log.push(`  ${varName.padEnd(11)} [DocPage.onSave] ${re.source}`);
      if (apply) src = src.replace(re, to);
      break; // 每个文件只应有一条 onSave
    }
  }

  // 排除：文案里命中这些片段的按钮不做门控（见 EXCLUDE 说明）
  const blocks2 = blocks.filter((b) => !EXCLUDE.some((re) => re.test(b.content)));
  if (!blocks2.length && !usedVars.size) return { rel, skipped: '未找到需门控的按钮' };

  // 从后往前替换，避免索引漂移。
  // 用 <CanButton> 组件包裹（而非 `{can && (...)}` 表达式）——组件是合法 JSX 元素，
  // 在原按钮合法的任何上下文都成立；表达式包裹遇到 `{cond && (<button/>)}` 会变成非法的 `( {expr} )`。
  for (const b of blocks2.reverse()) {
    const acts = detectActions(b.content);
    const isSave = acts[0] === 'save';
    const tag = isSave ? 'CanSave' : 'CanButton';
    const attrs = isSave ? `menu="${code}"` : `menu="${code}" action="${acts[0]}"`;
    const inner = src.slice(b.start, b.end);
    // 原按钮元素整体下移一层。
    // ⚠️ b.start 恰好落在 `<`，即**原行的前导空白仍在 src 里**（不在 inner 内）。
    // 所以替换串开头**不能**再写一次 b.indent，否则该行会变成「原空白 + b.indent」双倍缩进；
    // 也正因如此，inner 首行要自己补 `b.indent + '  '`（相对包裹层再进一级），其余非空行统一 +2。
    // 顺手抹掉 inner 末尾「闭合标签前的那段纯空白行」，避免留出只有空格的残行。
    const innerIndented = inner
      .replace(/\n[ \t]*$/, '')
      .split('\n')
      .map((line, i) => {
        if (i === 0) return b.indent + '  ' + line;
        if (line.trim() === '') return line;
        return '  ' + line;
      })
      .join('\n');
    const replacement = `<${tag} ${attrs}>\n${innerIndented}\n${b.indent}</${tag}>`;
    log.push(`  ${String(isSave ? 'save' : acts[0]).padEnd(11)} ${b.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)}`);
    if (apply) src = src.slice(0, b.start) + replacement + src.slice(b.end);
  }

  const needCanButton = blocks2.some((b) => detectActions(b.content)[0] !== 'save');
  const needCanSave = blocks2.some((b) => detectActions(b.content)[0] === 'save');

  // 注入 import：放在最后一条 import 之后
  const importLines = [`import { usePageActions } from '@client/src/hooks/usePageActions';`];
  if (needCanButton) importLines.push(`import CanButton from '@client/src/components/CanButton';`);
  if (needCanSave) importLines.push(`import { CanSave } from '@client/src/components/CanButton';`);

  // 注入 hook 调用：仅当 DocPage.onSave 需要变量时（按钮已改走组件，不再需要 hook 变量）
  if (usedVars.size) {
    const declRe = /^(?:const\s+\w+\s*:\s*React\.FC\s*=\s*\(\)\s*=>\s*\{|export\s+default\s+function\s+\w+\s*\(\s*\)\s*\{)/m;
    const dm = src.match(declRe);
    if (!dm) return { rel, error: '未找到组件声明行，跳过（需人工接入）' };
    const declEnd = dm.index + dm[0].length;
    const hookLine = `\n  const { ${[...usedVars].sort().join(', ')} } = usePageActions('${code}');`;
    if (apply) src = src.slice(0, declEnd) + hookLine + src.slice(declEnd);
  }
  // onSave 用到 canSave 时必须显式声明：hook 返回 canSave，直接解构即可
  if (usedVars.has('canSave') && apply) {
    src = src.replace(
      /const \{ ([^}]+) \} = usePageActions\('([^']+)'\);/,
      (mm, v, c) => `const { ${[...new Set([...v.split(', '), 'canSave'])].sort().join(', ')} } = usePageActions('${c}');`,
    );
  }

  // 注入 import（放在最后一条 import 之后）
  const lines = src.split('\n');
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i]) || /^} from '/.test(lines[i])) lastImport = i;
  }
  if (apply) {
    if (usedVars.size) {
      if (lastImport >= 0) lines.splice(lastImport + 1, 0, importLines[0]);
      else lines.unshift(importLines[0]);
      lastImport += 1;
    }
    const rest = importLines.slice(1);
    if (rest.length) {
      if (lastImport >= 0) lines.splice(lastImport + 1, 0, ...rest);
      else lines.unshift(...rest);
    }
    src = lines.join('\n');
    fs.writeFileSync(file, src);
  }
  return { rel, code, vars: [...usedVars].sort().join(', '), count: blocks2.length, log };
}

const apply = process.argv.includes('--apply');
console.log(apply ? '=== APPLY 模式：写盘 ===' : '=== DRY-RUN（加 --apply 才写盘）===');
let ok = 0, skip = [], err = [];
for (const [rel, code] of Object.entries(TARGETS)) {
  const r = processFile(rel, code, apply);
  if (r.error) { err.push(`${rel}: ${r.error}`); continue; }
  if (r.skipped) { skip.push(`${rel}: ${r.skipped}`); continue; }
  ok++;
  console.log(`\n${rel}  [${r.code}]  按钮 ${r.count} 个  → const { ${r.vars} }`);
  r.log.forEach((l) => console.log(l));
}
console.log(`\n=== 汇总: 改造 ${ok} / 跳过 ${skip.length} / 失败 ${err.length} ===`);
if (skip.length) { console.log('\n跳过:'); skip.forEach((s) => console.log('  ' + s)); }
if (err.length) { console.log('\n失败:'); err.forEach((s) => console.log('  ' + s)); }
