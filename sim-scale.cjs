/* 品牌服装ERP · 多级分销 规模压测 / 子树查询正确性验证（F4）
 * ---------------------------------------------------------------------------
 * 目的：
 *  1) 验证“物化路径 tree_path 前缀匹配”在较大组织树下的子树收集结果正确
 *     （门户 resolveVisiblePartnerIds 的核心过滤逻辑）。
 *  2) 验证批量销售单记账 -> 批量镜像生成下游采购单 的性能与正确性。
 *
 * 设计：自包含。构建一棵 5 层规模树（SC- 前缀，幂等隔离）：
 *   HQ + 3×L1 + 9×L2 + 27×L3 + 81×L4 = 121 个经销商，
 *   每个非叶节点建“客户身份”（向下级卖）与默认仓库。
 *   对每个 L1 开销售单 -> 记账 -> 镜像出 3 张 L1 采购单，并验证幂等。
 *
 * 用法：
 *   1) npm run build:server
 *   2) node sim-scale.cjs
 * ---------------------------------------------------------------------------
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, inArray, like, sql } = require('drizzle-orm');
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch (_) {}
}
loadEnv();

const distSchema = path.join(__dirname, 'dist', 'server', 'database', 'schema.js');
if (!fs.existsSync(distSchema)) { console.error('未找到 dist schema，请先 npm run build:server'); process.exit(1); }
const schema = require(distSchema);

function splitSql(sqlText) {
  const stmts = []; let cur = '', inDollar = false, tag = '', i = 0, inLineComment = false, inBlockComment = false;
  while (i < sqlText.length) {
    const ch = sqlText[i];
    if (!inDollar && !inBlockComment) {
      if (inLineComment) { if (ch === '\n') { inLineComment = false; i++; continue; } i++; continue; }
      if (ch === '-' && sqlText[i + 1] === '-') { inLineComment = true; i += 2; continue; }
      if (ch === '/' && sqlText[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
    }
    if (inBlockComment) { if (ch === '*' && sqlText[i + 1] === '/') { inBlockComment = false; i += 2; continue; } i++; continue; }
    if (!inDollar && ch === '$') {
      let j = i + 1, t = ''; while (j < sqlText.length && sqlText[j] !== '$') { t += sqlText[j]; j++; }
      if (j < sqlText.length) { inDollar = true; tag = t; cur += '$' + t + '$'; i = j + 1; continue; }
    }
    if (inDollar) { if (ch === '$') { let j = i + 1, t = ''; while (j < sqlText.length && sqlText[j] !== '$') { t += sqlText[j]; j++; } if (j < sqlText.length && t === tag) { inDollar = false; cur += '$' + t + '$'; i = j + 1; continue; } } cur += ch; i++; continue; }
    if (ch === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}
async function applyMigration(file) {
  const p = path.join(__dirname, 'migrations', file);
  if (!fs.existsSync(p)) return;
  for (const s of splitSql(fs.readFileSync(p, 'utf8'))) if (s) await client.unsafe(s);
}

const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { GarmentPurchaseOrderService } = require('./dist/server/modules/purchase/garment-order/garment-purchase-order.service');
const { GarmentPurchaseReturnService } = require('./dist/server/modules/purchase/garment-return/garment-purchase-return.service');
const { DistributionMirrorService } = require('./dist/server/modules/distribution/distribution-mirror.service');
const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();
const R = { meta: {}, org: {}, subtree: {}, batchMirror: {}, errors: [] };
const assert = (c, issue, detail) => { R.checks = R.checks || []; R.checks.push({ ok: !!c, issue, detail: detail || '' }); };

(async () => {
  console.log('=== 品牌服装ERP · 多级分销 规模压测 / 子树查询验证（F4）===');
  await applyMigration('0006_multilevel_distribution.sql');
  await applyMigration('0007_rbac_user_partner.sql');
  await applyMigration('0008_distribution_mirror_observability.sql');

  // 0. 清理历史 SC- 数据
  const scDealers = (await db.select({ id: schema.dealer.id }).from(schema.dealer).where(like(schema.dealer.code, 'SC-%'))).map(r => r.id);
  if (scDealers.length) {
    await db.delete(schema.rbacUserPartner).where(inArray(schema.rbacUserPartner.partnerId, scDealers));
    await db.delete(schema.customer).where(inArray(schema.customer.partnerId, scDealers));
    await db.delete(schema.supplier).where(inArray(schema.supplier.partnerId, scDealers));
    await db.delete(schema.store).where(inArray(schema.store.dealerId, scDealers));
    await db.delete(schema.warehouse).where(inArray(schema.warehouse.dealerId, scDealers));
    // 业务数据：SC 客户下的销售单 / SC 下游采购单
    const scCustomers = (await db.select({ id: schema.customer.id }).from(schema.customer).where(inArray(schema.customer.partnerId, scDealers))).map(r => r.id);
    if (scCustomers.length) {
      const soIds = (await db.select({ id: schema.salesOrder.id }).from(schema.salesOrder).where(inArray(schema.salesOrder.customerId, scCustomers))).map(r => r.id);
      if (soIds.length) {
        await db.delete(schema.salesOrderItem).where(inArray(schema.salesOrderItem.orderId, soIds));
        await db.delete(schema.salesOrder).where(inArray(schema.salesOrder.id, soIds));
        await db.delete(schema.garmentPurchaseOrder).where(inArray(schema.garmentPurchaseOrder.sourceDocId, soIds));
      }
    }
    await db.delete(schema.dealer).where(inArray(schema.dealer.id, scDealers));
  }

  // 1. 构建 5 层规模组织树
  console.log('· 构建 5 层规模组织树（SC-）...');
  const hqId = uid();
  await db.insert(schema.dealer).values({ id: hqId, code: 'SC-HQ', name: '规模总部', status: 'active', parentId: null, level: 0, treePath: '/' + hqId, partnerType: 'hq' });
  const hqSupId = uid();
  await db.insert(schema.supplier).values({ id: hqSupId, code: 'SC-SUP-HQ', name: '规模总部', status: 'active', partnerId: hqId });
  const hqWhId = uid();
  await db.insert(schema.warehouse).values({ id: hqWhId, code: 'SC-WH-HQ', name: '规模总仓', type: 'finished', status: 'active', dealerId: hqId });

  const L1 = 3, L2 = 3, L3 = 3, L4 = 3; // 每层每个节点下钻 3 个
  const dealers = []; // {id, code, level, treePath, parentId, custId}
  const makeNode = async (parentId, parentPath, level, code) => {
    const id = uid();
    const treePath = parentPath + '/' + id;
    await db.insert(schema.dealer).values({ id, code, name: `SC·${code}`, status: 'active', parentId, level, treePath, partnerType: 'level' + level });
    // 非叶节点：建客户身份（向下级卖）+ 默认仓
    const custId = uid();
    await db.insert(schema.customer).values({ id: custId, code: 'SC-CUST-' + code, name: `SC·${code}`, creditPeriod: 0, status: 'active', partnerId: id });
    const whId = uid();
    await db.insert(schema.warehouse).values({ id: whId, code: 'SC-WH-' + code, name: `SC·${code}仓`, type: 'dealer', status: 'active', dealerId: id });
    const node = { id, code, level, treePath, parentId, custId, children: [] };
    dealers.push(node);
    return node;
  };

  const root = { id: hqId, code: 'SC-HQ', level: 0, treePath: '/' + hqId, parentId: null, custId: null, children: [] };
  dealers.push(root);
  // 递归构建 L1..L4
  const buildChildren = async (parent, depth, fanout, prefixFn) => {
    if (depth > 4) return;
    for (let i = 0; i < fanout; i++) {
      const code = prefixFn(i + 1);
      const node = await makeNode(parent.id, parent.treePath, depth, code);
      parent.children.push(node);
      await buildChildren(node, depth + 1, fanout, (k) => `${code}-L${depth + 1}-${String(k).padStart(2, '0')}`);
    }
  };
  for (let i = 0; i < L1; i++) {
    const l1 = await makeNode(root.id, root.treePath, 1, `SC-L1-${String(i + 1).padStart(2, '0')}`);
    root.children.push(l1);
    await buildChildren(l1, 2, L2, (k) => `${l1.code}-L2-${String(k).padStart(2, '0')}`);
  }

  const totalDealers = dealers.length;
  const l1Nodes = dealers.filter(d => d.level === 1);
  R.org = { totalDealers, l1Count: l1Nodes.length, treeDepth: 4 };
  console.log(`  · 经销商总数：${totalDealers}（HQ + ${l1Nodes.length}×L1 + 子树）`);

  // 2. 子树查询正确性（tree_path 前缀，门户核心过滤）
  console.log('· 验证 tree_path 前缀子树收集正确性 ...');
  // HQ 子树应包含全部
  const hqSubtree = await db.select({ id: schema.dealer.id }).from(schema.dealer).where(like(schema.dealer.treePath, root.treePath + '%'));
  assert(hqSubtree.length === totalDealers, `HQ 前缀子树 == 全部经销商(${totalDealers})`, `实际 ${hqSubtree.length}`);
  // 每个 L1 子树应包含 自身 + 3*L2 + 9*L3 + 27*L4 = 1+3+9+27 = 40
  const expectL1Sub = 1 + L2 + L2 * L3 + L2 * L3 * L4;
  for (const l1 of l1Nodes) {
    const sub = await db.select({ id: schema.dealer.id }).from(schema.dealer).where(like(schema.dealer.treePath, l1.treePath + '%'));
    assert(sub.length === expectL1Sub, `L1 ${l1.code} 子树 == ${expectL1Sub}`, `实际 ${sub.length}`);
  }
  // 末层 L4 子树应等于自身（1）
  const l4Nodes = dealers.filter(d => d.level === 4);
  const l4sample = l4Nodes[0];
  const l4sub = await db.select({ id: schema.dealer.id }).from(schema.dealer).where(like(schema.dealer.treePath, l4sample.treePath + '%'));
  assert(l4sub.length === 1, `L4 ${l4sample.code} 子树 == 1（叶子）`, `实际 ${l4sub.length}`);
  R.subtree = { hqSubtree: hqSubtree.length, expectL1Sub, l1Verified: l1Nodes.length };

  // 3. 批量镜像：对每个 L1 开销售单 -> 记账 -> 批量镜像
  console.log('· 批量销售单记账 -> 批量镜像 ...');
  const ng = new NumberGeneratorService();
  const monthClose = null; // 规模测试不涉及入库，无需 monthClose
  const garmentOrder = new GarmentPurchaseOrderService(db, ng);
  const garmentReturn = new GarmentPurchaseReturnService(db, ng);
  const mirror = new DistributionMirrorService(db, garmentOrder, garmentReturn);
  const salesOrder = new SalesOrderService(db, ng, mirror);

  // 复用一个测试 SKU
  const [sk] = await db.select().from(schema.sku).limit(1);
  const soIds = [];
  const t0 = Date.now();
  for (const l1 of l1Nodes) {
    const so = await salesOrder.create({ customerId: l1.custId, customerName: `SC·${l1.code}`, orderDate: '2026-09-20', items: [{ skuId: sk.id, quantity: 5, price: 100 }] }, 'SYS-SCALE');
    await salesOrder.audit(so.id);
    await salesOrder.book(so.id); // 触发镜像
    soIds.push(so.id);
  }
  const tBatch = Date.now() - t0;

  // 校验镜像数量与幂等（重复记账不重复生成）
  const gpos = await db.select().from(schema.garmentPurchaseOrder).where(inArray(schema.garmentPurchaseOrder.sourceDocId, soIds));
  assert(gpos.length === l1Nodes.length, `批量镜像生成下游采购单数 == L1 数(${l1Nodes.length})`, `实际 ${gpos.length}`);
  assert(gpos.every(g => g.status === 'wait_confirm'), `批量镜像采购单初始均为 wait_confirm`, `n=${gpos.length}`);
  // 幂等：对第一个销售单再 book 一次（已记账会抛错？）—— 改为直接调用 mirror 两次
  const beforeDup = gpos.length;
  await mirror.mirrorFromSalesOrder(soIds[0]);
  const afterDup = (await db.select().from(schema.garmentPurchaseOrder).where(inArray(schema.garmentPurchaseOrder.sourceDocId, soIds))).length;
  assert(beforeDup === afterDup, `镜像幂等：重复触发不重复生成`, `before=${beforeDup} after=${afterDup}`);

  R.batchMirror = { l1Count: l1Nodes.length, mirrored: gpos.length, batchMs: tBatch, idempotent: beforeDup === afterDup };
  console.log(`  · 批量记账+镜像 ${l1Nodes.length} 张销售单耗时 ${tBatch}ms；镜像 ${gpos.length} 张`);

  // 汇总
  const fail = (R.checks || []).filter(c => !c.ok).length;
  const pass = (R.checks || []).filter(c => c.ok).length;
  R.summary = { total: (R.checks || []).length, pass, fail };
  fs.writeFileSync('/tmp/scale-result.json', JSON.stringify(R, null, 2));
  console.log(`\n=== 规模压测完成 ===`);
  console.log(`检查：${R.summary.total} 项（通过 ${pass} / 失败 ${fail}）`);
  await client.end();
  process.exit(fail === 0 ? 0 : 2);
})().catch(async (e) => {
  console.error('FATAL', e);
  try { await client.end(); } catch (_) {}
  process.exit(1);
});
