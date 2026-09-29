/* 服装ERP 多级分销 · 组织数据模拟脚本
 * ---------------------------------------------------------------------------
 * 目标：构造一套可用于测试多级分销的组织主数据。
 *   - 经销商层级：总部(HQ, level0) → 一级 → 二级 → 三级 → 四级 → 五级（最深 5 层经销商）。
 *   - 每个经销商可有多个下级（childCount 控制），也允许没有下级（叶子）。
 *   - 每个经销商自身可有 0..N 家门店（总部演示"无门店"，其余按哈希 0..3 家）。
 *   - 每个经销商（含总部）下建 1 个默认仓库。
 *   - 为每个非总部经销商生成"客户身份"(customer, partner_id=经销商)；
 *     为每个有下级的经销商（含总部）生成"供应商身份"(supplier, partner_id=经销商)，
 *     实现"一个经销商同时持有客户身份(对上级买)与供应商身份(对下级卖)"的伙伴模型。
 *   - 把示例 rbac_user 绑定到分销节点，便于直接通过分销门户端点验证"我的采购单"可见范围。
 *
 * 用法：
 *   1) npm run build:server        # 生成 dist（脚本依赖 dist 中的 schema）
 *   2) node sim-org.cjs            # 应用迁移 + 生成组织数据
 *
 * 幂等：重复运行会先清空 code 以 "DL-" 开头的模拟数据，再重建。
 * ---------------------------------------------------------------------------
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, inArray, like, gt } = require('drizzle-orm');
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- 加载 .env（仅当环境变量缺失时补充） ----------
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const txt = fs.readFileSync(envPath, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch (_) { /* ignore */ }
}
loadEnv();

const distSchema = path.join(__dirname, 'dist', 'server', 'database', 'schema.js');
if (!fs.existsSync(distSchema)) {
  console.error('未找到 dist/server/database/schema.js，请先运行：npm run build:server');
  process.exit(1);
}
const schema = require(distSchema);
const { dealer, warehouse, store, customer, supplier, rbacUser, rbacUserPartner } = schema;

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();

// ---------- 幂等应用迁移（支持 DO $$ 块，且忽略 SQL 注释） ----------
function splitSql(sqlText) {
  const stmts = [];
  let cur = '', inDollar = false, tag = '', i = 0;
  let inLineComment = false, inBlockComment = false;
  while (i < sqlText.length) {
    const ch = sqlText[i];
    // 注释处理（注释中的 $$ 不得被当作美元引号）
    if (!inDollar && !inBlockComment) {
      if (inLineComment) {
        if (ch === '\n') { inLineComment = false; i++; continue; }
        i++; continue;
      }
      if (ch === '-' && sqlText[i + 1] === '-') { inLineComment = true; i += 2; continue; }
      if (ch === '/' && sqlText[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
    }
    if (inBlockComment) {
      if (ch === '*' && sqlText[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
      i++; continue;
    }
    // 美元引号
    if (!inDollar && ch === '$') {
      let j = i + 1, t = '';
      while (j < sqlText.length && sqlText[j] !== '$') { t += sqlText[j]; j++; }
      if (j < sqlText.length) { inDollar = true; tag = t; cur += '$' + t + '$'; i = j + 1; continue; }
    }
    if (inDollar) {
      if (ch === '$') {
        let j = i + 1, t = '';
        while (j < sqlText.length && sqlText[j] !== '$') { t += sqlText[j]; j++; }
        if (j < sqlText.length && t === tag) { inDollar = false; cur += '$' + t + '$'; i = j + 1; continue; }
      }
      cur += ch; i++; continue;
    }
    if (ch === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

async function applyMigration(file) {
  const p = path.join(__dirname, 'migrations', file);
  const text = fs.readFileSync(p, 'utf8');
  const stmts = splitSql(text);
  for (const s of stmts) { if (s) await client.unsafe(s); }
  console.log(`  ✓ 迁移已应用：${file}（${stmts.length} 条语句）`);
}

// ---------- 工具 ----------
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// ---------- 构建经销商树 ----------
const MAX_DEPTH = 5; // 总部 level0；经销商最深 level5 → 共 5 层经销商（满足"四至五层"）
function childCount(depth, indexInParent) {
  switch (depth) {
    case 0: return 3;                          // 总部下 3 个一级
    case 1: return 2;                          // 每个一级下 2 个二级
    case 2: return 2;                          // 每个二级下 2 个三级
    case 3: return 1;                          // 每个三级下 1 个四级
    case 4: return indexInParent === 0 ? 1 : 0; // 仅首个四级继续到五级，其余为叶子
    default: return 0;
  }
}

const nodes = [];
function build(parent, depth, indexInParent, codePrefix) {
  const code = depth === 0 ? 'DL-HQ' : `${codePrefix}-${String(indexInParent + 1).padStart(2, '0')}`;
  const levelName = ['总部', '一级', '二级', '三级', '四级', '五级'][depth] || `L${depth}`;
  const name = depth === 0 ? '总部(HQ)' : `${levelName}经销商·${code}`;
  const node = {
    id: uid(), code, name, level: depth,
    parentId: parent ? parent.id : null,
    partnerType: depth === 0 ? 'hq' : `level${depth}`,
    treePath: '', // 稍后用真实 id 回填
    children: [],
  };
  nodes.push(node);
  if (parent) parent.children.push(node);
  const n = childCount(depth, indexInParent);
  for (let i = 0; i < n; i++) build(node, depth + 1, i, code);
  return node;
}
const root = build(null, 0, 0, '');

function fixPath(node, parentPath) {
  node.treePath = (parentPath || '') + '/' + node.id;
  for (const c of node.children) fixPath(c, node.treePath);
}
fixPath(root, '');

// ---------- 主流程 ----------
async function main() {
  console.log('=== 服装ERP 多级分销 · 组织数据模拟 ===');

  console.log('· 应用迁移 0006 / 0007 ...');
  await applyMigration('0006_multilevel_distribution.sql');
  await applyMigration('0007_rbac_user_partner.sql');

  // 清空历史模拟数据（code 以 DL- 开头），避免重复主数据
  console.log('· 清空历史模拟数据（code 以 DL- 开头）...');
  const seeded = (await db.select({ id: dealer.id }).from(dealer).where(like(dealer.code, 'DL-%'))).map((r) => r.id);
  if (seeded.length) {
    await db.delete(rbacUserPartner).where(inArray(rbacUserPartner.partnerId, seeded));
    await db.delete(customer).where(inArray(customer.partnerId, seeded));
    await db.delete(supplier).where(inArray(supplier.partnerId, seeded));
    await db.delete(store).where(inArray(store.dealerId, seeded));
    await db.delete(warehouse).where(inArray(warehouse.dealerId, seeded));
    await db.delete(dealer).where(and(gt(dealer.level, 0), like(dealer.code, 'DL-%')));
    await db.delete(dealer).where(and(eq(dealer.level, 0), like(dealer.code, 'DL-%')));
  }

  // 插入经销商
  console.log('· 写入经销商树 ...');
  for (const n of nodes) {
    await db.insert(dealer).values({
      id: n.id, code: n.code, name: n.name, status: 'active',
      parentId: n.parentId, level: n.level, treePath: n.treePath, partnerType: n.partnerType,
    });
  }

  // 仓库 / 门店 / 伙伴主数据
  console.log('· 写入仓库 / 门店 / 伙伴主数据 ...');
  let nWarehouse = 0, nStore = 0, nCustomer = 0, nSupplier = 0;
  for (const n of nodes) {
    // 每个经销商（含总部）一个默认仓库
    const whId = uid();
    n.whId = whId;
    await db.insert(warehouse).values({
      id: whId, code: 'WH-' + n.code, name: n.name + '·默认仓',
      type: 'dealer', status: 'active', dealerId: n.id,
    });
    nWarehouse++;

    // 门店：总部 0 家（演示"无门店"）；其余 0..3 家
    const storeCount = n.level === 0 ? 0 : (hashStr(n.code) % 4);
    for (let i = 0; i < storeCount; i++) {
      await db.insert(store).values({
        id: uid(), code: `ST-${n.code}-${String(i + 1).padStart(2, '0')}`,
        name: n.name + '·门店' + (i + 1), storeType: 'direct',
        dealerId: n.id, warehouseId: whId, status: 'active',
      });
      nStore++;
    }

    // 客户身份（对上级买）：非总部经销商
    if (n.level > 0) {
      await db.insert(customer).values({
        id: uid(), code: 'CUST-' + n.code, name: n.name,
        creditPeriod: 0, status: 'active', partnerId: n.id,
        remark: '组织模拟自动创建（客户身份）',
      });
      nCustomer++;
    }
    // 供应商身份（对下级卖）：有下级的经销商（含总部）
    if (n.children.length > 0) {
      await db.insert(supplier).values({
        id: uid(), code: 'SUP-' + n.code, name: n.name,
        status: 'active', partnerId: n.id,
        remark: '组织模拟自动创建（供应商身份）',
      });
      nSupplier++;
    }
  }

  // 绑定示例用户到分销节点（验证分销门户可见范围）
  console.log('· 绑定示例用户到分销节点 ...');
  const users = await db.select({ id: rbacUser.id, username: rbacUser.username })
    .from(rbacUser).limit(10);
  let nBind = 0;
  if (users.length) {
    await db.insert(rbacUserPartner)
      .values({ userId: users[0].id, partnerId: root.id, role: 'owner' })
      .onConflictDoNothing();
    nBind++;
    const firstL1 = root.children[0];
    if (users[1] && firstL1) {
      await db.insert(rbacUserPartner)
        .values({ userId: users[1].id, partnerId: firstL1.id, role: 'viewer' })
        .onConflictDoNothing();
      nBind++;
    }
  }

  // 汇总
  const byLevel = {};
  for (const n of nodes) byLevel[n.level] = (byLevel[n.level] || 0) + 1;
  console.log('\n=== 完成 ===');
  console.log(`经销商：${nodes.length} 家（按层分布：${JSON.stringify(byLevel)}）`);
  console.log(`默认仓库：${nWarehouse} 个`);
  console.log(`门店：${nStore} 家`);
  console.log(`客户主数据：${nCustomer} 条`);
  console.log(`供应商主数据：${nSupplier} 条`);
  console.log(`用户-节点绑定：${nBind} 条${users.length ? `（示例用户：${users.map((u) => u.username).join(', ')}）` : '（无 rbac_user，已跳过）'}`);
  console.log(`\n验证建议：`);
  console.log(`  1) 以绑定总部的用户调用 GET /distribution/portal/purchase-orders → 可见整棵树下的采购单；`);
  console.log(`  2) 以绑定一级经销商的用户调用同一端点 → 仅可见该一级及其下级采购单；`);
  console.log(`  3) 对 DL-HQ 下的一级经销商做"订货会配货→销售单 book" → 该一级经销商自动生成对应成衣采购单（镜像）。`);

  await client.end();
}

main().catch(async (e) => {
  console.error('模拟失败：', e);
  try { await client.end(); } catch (_) {}
  process.exit(1);
});
