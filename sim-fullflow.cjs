/* 品牌服装ERP · 全流程业务联调模拟（聚焦多级分销链路）
 * ---------------------------------------------------------------------------
 * 业务主线（用户指定）：
 *   商品建档 -> 订货会 -> 销售订单 -> 采购订单(分销镜像) -> 采购入库单
 *   -> 销售出库单 -> 零售单
 * 并额外验证：一级->二级 的多级分销镜像，以及财务应收/经营分析的轻量连通性。
 *
 * 设计：
 *   - 自包含：内置多级组织构建（HQ + 2 个一级 + 2 个二级，含伙伴模型），
 *     不依赖外部 sim-org 数据，可独立重复运行（FF- 前缀幂等）。
 *   - 绕过 HTTP/代理，直接实例化 Service + 注入真实 db，跑真实业务数据。
 *   - 每步 try/catch 收集结果；关键节点显式断言并写入 issues。
 *
 * 用法：
 *   1) npm run build:server   # 生成 dist（脚本依赖 dist 中的 schema）
 *   2) node sim-fullflow.cjs
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
if (!fs.existsSync(distSchema)) {
  console.error('未找到 dist/server/database/schema.js，请先运行：npm run build:server');
  process.exit(1);
}
const schema = require(distSchema);

// ---------- 迁移（幂等应用 0006 / 0007，确保分销字段存在） ----------
function splitSql(sqlText) {
  const stmts = [];
  let cur = '', inDollar = false, tag = '', i = 0;
  let inLineComment = false, inBlockComment = false;
  while (i < sqlText.length) {
    const ch = sqlText[i];
    if (!inDollar && !inBlockComment) {
      if (inLineComment) { if (ch === '\n') { inLineComment = false; i++; continue; } i++; continue; }
      if (ch === '-' && sqlText[i + 1] === '-') { inLineComment = true; i += 2; continue; }
      if (ch === '/' && sqlText[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
    }
    if (inBlockComment) { if (ch === '*' && sqlText[i + 1] === '/') { inBlockComment = false; i += 2; continue; } i++; continue; }
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
  if (!fs.existsSync(p)) { console.log(`  · 跳过（无迁移文件）：${file}`); return; }
  const text = fs.readFileSync(p, 'utf8');
  for (const s of splitSql(text)) { if (s) await client.unsafe(s); }
  console.log(`  ✓ 迁移已应用：${file}`);
}

const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service');
const { OperationLogService } = require('./dist/server/modules/system/operation-log/operation-log.service');
const { MonthCloseService } = require('./dist/server/modules/finance/month-close/month-close.service');
const { TradeShowService } = require('./dist/server/modules/trade-show/trade-show.service');
const { PreOrderService } = require('./dist/server/modules/trade-show/pre-order.service');
const { BomService } = require('./dist/server/modules/bom/bom.service');
const { GarmentPurchaseOrderService } = require('./dist/server/modules/purchase/garment-order/garment-purchase-order.service');
const { GarmentPurchaseReturnService } = require('./dist/server/modules/purchase/garment-return/garment-purchase-return.service');
const { GarmentPurchaseInboundService } = require('./dist/server/modules/purchase/garment-inbound/garment-purchase-inbound.service');
const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service');
const { SalesOutboundService } = require('./dist/server/modules/sales/outbound/sales-outbound.service');
const { RetailService } = require('./dist/server/modules/retail/retail.service');
const { DistributionMirrorService } = require('./dist/server/modules/distribution/distribution-mirror.service');
const { ReceivableService } = require('./dist/server/modules/finance/receivable/receivable.service');
const { AnalyticsService } = require('./dist/server/modules/analytics/analytics.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();

// ---------- 工具 ----------
function assignDb(svc) { svc.db = db; return svc; }
async function q1(t, where) { const r = await db.select().from(t).where(where).limit(1); return r[0]; }
async function skuStockAt(whId, skuId) {
  const r = await q1(schema.inventoryStock, and(eq(schema.inventoryStock.warehouseId, whId), eq(schema.inventoryStock.skuId, skuId)));
  return r ? Number(r.quantity) : 0;
}
function distribute(total, n) { const a = new Array(n).fill(0); for (let i = 0; i < total; i++) a[i % n]++; return a.slice(0, n); }
const ctx = { userId: 'SYS-SIM', userName: '模拟器', module: 'sim' };

// 步骤收集器
const R = {
  meta: {}, issues: [], errors: [],
  org: {}, master: {}, prep: {}, tradeShow: {},
  flow: [], multilevel: {}, finance: {}, analytics: {}, snapshot: {},
};
function step(store, name, fn) {
  return (async () => {
    try { const v = await fn(); store[name] = (typeof v === 'object' && v !== null) ? v : String(v); return v; }
    catch (e) { const msg = String(e && e.message ? e.message : e).slice(0, 240); store[name] = 'ERR:' + msg; R.errors.push({ where: name, msg }); throw e; }
  })();
}
function assert(cond, issue, detail) {
  R.issues.push({ ok: !!cond, issue, detail: detail || '' });
  return cond;
}
function note(issue, detail) { R.issues.push({ ok: true, issue, detail: detail || '' }); }

(async () => {
  console.log('=== 品牌服装ERP · 全流程业务联调模拟 ===');

  // 0. 迁移 + 清空历史模拟（FF- 前缀） + 业务表
  console.log('· 应用迁移并清理 FF- 模拟数据 ...');
  await applyMigration('0006_multilevel_distribution.sql');
  await applyMigration('0007_rbac_user_partner.sql');
  await applyMigration('0008_distribution_mirror_observability.sql');

  const CLEAN_BIZ = [
    'trade_show','pre_order','pre_order_item','allocation_order','allocation_item',
    'garment_purchase_order','garment_purchase_order_sku','garment_purchase_return',
    'garment_purchase_inbound','garment_purchase_inbound_sku',
    'sales_order','sales_order_item','sales_outbound','sales_outbound_item',
    'sales_return','sales_return_item','retail_order','retail_order_item','retail_return',
    'inventory_stock','inventory_flow','member_point',
    'payable','receivable','finance_payment','finance_receipt',
    'month_close','month_close_detail','month_close_log',
  ];
  await client.unsafe('TRUNCATE ' + CLEAN_BIZ.map(t => `"${t}"`).join(', ') + ' RESTART IDENTITY CASCADE');
  // 清理 FF- 前缀的组织/主数据
  const ffDealers = (await db.select({ id: schema.dealer.id }).from(schema.dealer).where(like(schema.dealer.code, 'FF-%'))).map(r => r.id);
  if (ffDealers.length) {
    await db.delete(schema.rbacUserPartner).where(inArray(schema.rbacUserPartner.partnerId, ffDealers));
    await db.delete(schema.customer).where(inArray(schema.customer.partnerId, ffDealers));
    await db.delete(schema.supplier).where(inArray(schema.supplier.partnerId, ffDealers));
    await db.delete(schema.store).where(inArray(schema.store.dealerId, ffDealers));
    await db.delete(schema.warehouse).where(inArray(schema.warehouse.dealerId, ffDealers));
    await db.delete(schema.dealer).where(inArray(schema.dealer.id, ffDealers));
  }
  // 清理 FF- 前缀的商品/主数据（注意外键顺序：先删 bom，再删 style/sku）
  await db.delete(schema.bom).where(sql`${schema.bom.styleId} IN (SELECT id FROM style WHERE style_no LIKE 'FF-%')`);
  await db.delete(schema.sku).where(like(schema.sku.skuCode, 'FF-%'));
  await db.delete(schema.style).where(like(schema.style.styleNo, 'FF-%'));
  await db.delete(schema.material).where(like(schema.material.code, 'FF-%'));
  await db.delete(schema.supplier).where(like(schema.supplier.code, 'FF-%'));
  await db.delete(schema.colorGroup).where(like(schema.colorGroup.code, 'FF-%'));
  await db.delete(schema.sizeGroup).where(like(schema.sizeGroup.code, 'FF-%'));
  // 会员（member_no 唯一约束，需按前缀清理避免重跑冲突）
  await db.delete(schema.member).where(like(schema.member.memberNo, 'FFM%'));

  // 实例化服务
  const ng = new NumberGeneratorService();
  const stock = assignDb(new StockService());
  const opLog = assignDb(new OperationLogService());
  const monthClose = assignDb(new MonthCloseService());
  const bom = assignDb(new BomService(db));
  const tradeShow = assignDb(new TradeShowService(db, ng));
  const preOrder = assignDb(new PreOrderService(db, ng));
  const garmentOrder = assignDb(new GarmentPurchaseOrderService(db, ng));
  const garmentReturn = assignDb(new GarmentPurchaseReturnService(db, ng));
  const garmentInbound = assignDb(new GarmentPurchaseInboundService(db, monthClose, ng));
  const mirror = assignDb(new DistributionMirrorService(db, garmentOrder, garmentReturn));
  const salesOrder = assignDb(new SalesOrderService(db, ng, mirror));
  const salesOutbound = assignDb(new SalesOutboundService(db, monthClose, stock, ng));
  const retail = assignDb(new RetailService(db, monthClose, stock, ng));
  const receivable = assignDb(new ReceivableService(db, monthClose));
  const analytics = assignDb(new AnalyticsService());
  R.meta.services = 'all instantiated';
  R.meta.dbUrl = (process.env.SUDA_DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@');

  // ===== 1. 商品建档（Product Master） =====
  console.log('· 1) 商品建档 ...');
  const M = {};
  await step(R.master, 'colorGroup', async () => { M.cg = uid(); await db.insert(schema.colorGroup).values({ id: M.cg, code: 'FF-CG', name: '基础色组', status: 'active' }); return M.cg; });
  await step(R.master, 'sizeGroup', async () => { M.sg = uid(); await db.insert(schema.sizeGroup).values({ id: M.sg, code: 'FF-SG', name: '标准尺码', status: 'active' }); return M.sg; });
  await step(R.master, 'material', async () => {
    M.mat = uid();
    await db.insert(schema.material).values({ id: M.mat, code: 'FF-MAT', name: '精梳棉布', unit: '米', status: 'active' });
    return M.mat;
  });
  // 工厂供应商（真实外部供应商，用于总部外部采买备货，非伙伴身份）
  await step(R.master, 'factorySupplier', async () => {
    M.factory = uid();
    await db.insert(schema.supplier).values({ id: M.factory, code: 'FF-SUP-FAC', name: '锦绣服装加工厂', status: 'active' });
    return M.factory;
  });
  // 款式 + SKU（1 款 2 色 × 2 码 = 4 SKU）
  await step(R.master, 'style+sku', async () => {
    const sid = uid();
    await db.insert(schema.style).values({ id: sid, styleNo: 'FF-SPRING', name: '春日清新卫衣', colorGroupId: M.cg, sizeGroupId: M.sg, season: 'spring', status: 'active', lifecycleStatus: 'active', attributes: {} });
    M.styleId = sid;
    M.skus = [];
    const colors = ['红', '黑']; const sizes = ['M', 'L'];
    for (const c of colors) for (const sz of sizes) {
      const kid = uid(); const skuCode = `FF-SPRING-${c}-${sz}`;
      await db.insert(schema.sku).values({ id: kid, skuCode, styleId: sid, styleNo: 'FF-SPRING', color: c, size: sz, status: 'active', costPrice: '80', tagPrice: '299', supplyPrice: '120' });
      M.skus.push({ id: kid, skuCode, color: c, size: sz });
    }
    return { styleId: sid, skuCount: M.skus.length };
  });
  await step(R.master, 'bom', async () => {
    await bom.createBom({ styleId: M.styleId, version: 'V1', items: [
      { materialId: M.mat, usagePerPiece: 1.5, lossRate: 0.05, bomType: 'fabric', remark: '面料' },
    ] }, 'SYS-SIM');
    return 'ok';
  });
  R.master.skuIds = M.skus.map(s => s.id);

  // ===== 2. 组织建档（多级分销，含伙伴模型） =====
  console.log('· 2) 多级组织建档（HQ + 2 一级 + 2 二级）...');
  const O = { dealers: [], customers: {}, suppliers: {}, warehouses: {}, stores: {} };
  await step(R.org, 'buildHQ', async () => {
    const id = uid(); O.hq = { id, code: 'FF-HQ', name: '品牌总部(HQ)' };
    await db.insert(schema.dealer).values({ id, code: 'FF-HQ', name: '品牌总部(HQ)', status: 'active', parentId: null, level: 0, treePath: '/' + id, partnerType: 'hq' });
    // HQ 供应商身份（对下级卖）
    const supId = uid(); O.hq.supplierId = supId;
    await db.insert(schema.supplier).values({ id: supId, code: 'FF-SUP-HQ', name: '品牌总部(HQ)', status: 'active', partnerId: id });
    // HQ 成品总仓
    const whId = uid(); O.hq.whId = whId;
    await db.insert(schema.warehouse).values({ id: whId, code: 'FF-WH-HQ', name: '中央总仓', type: 'finished', status: 'active', dealerId: id });
    return { id, supplierId: supId, whId };
  });
  await step(R.org, 'buildL1L2', async () => {
    for (let i = 0; i < 2; i++) {
      const l1id = uid(); const l1code = `FF-L1-${String(i + 1).padStart(2, '0')}`;
      await db.insert(schema.dealer).values({ id: l1id, code: l1code, name: `一级经销商·${l1code}`, status: 'active', parentId: O.hq.id, level: 1, treePath: O.hq.treePath + '/' + l1id, partnerType: 'level1' });
      // L1 客户身份（向 HQ 买）
      const l1cust = uid(); O.customers[l1code] = l1cust;
      await db.insert(schema.customer).values({ id: l1cust, code: 'FF-CUST-' + l1code, name: `一级经销商·${l1code}`, creditPeriod: 0, status: 'active', partnerId: l1id });
      // L1 供应商身份（向 L2 卖，因有下级）
      const l1sup = uid();
      await db.insert(schema.supplier).values({ id: l1sup, code: 'FF-SUP-' + l1code, name: `一级经销商·${l1code}`, status: 'active', partnerId: l1id });
      // L1 默认仓 + 门店
      const l1wh = uid();
      await db.insert(schema.warehouse).values({ id: l1wh, code: 'FF-WH-' + l1code, name: `一级·${l1code}仓`, type: 'dealer', status: 'active', dealerId: l1id });
      const l1store = uid();
      await db.insert(schema.store).values({ id: l1store, code: 'FF-ST-' + l1code, name: `一级·${l1code}门店`, storeType: 'direct', dealerId: l1id, warehouseId: l1wh, status: 'active' });
      O.dealers.push({ code: l1code, id: l1id, custId: l1cust, supId: l1sup, whId: l1wh, storeId: l1store });
      // 每个 L1 下一个 L2
      const l2id = uid(); const l2code = `${l1code}-L2-01`;
      await db.insert(schema.dealer).values({ id: l2id, code: l2code, name: `二级经销商·${l2code}`, status: 'active', parentId: l1id, level: 2, treePath: O.hq.treePath + '/' + l1id + '/' + l2id, partnerType: 'level2' });
      const l2cust = uid(); O.customers[l2code] = l2cust;
      await db.insert(schema.customer).values({ id: l2cust, code: 'FF-CUST-' + l2code, name: `二级经销商·${l2code}`, creditPeriod: 0, status: 'active', partnerId: l2id });
      const l2wh = uid();
      await db.insert(schema.warehouse).values({ id: l2wh, code: 'FF-WH-' + l2code, name: `二级·${l2code}仓`, type: 'dealer', status: 'active', dealerId: l2id });
      const l2store = uid();
      await db.insert(schema.store).values({ id: l2store, code: 'FF-ST-' + l2code, name: `二级·${l2code}门店`, storeType: 'direct', dealerId: l2id, warehouseId: l2wh, status: 'active' });
      O.dealers.push({ code: l2code, id: l2id, custId: l2cust, supId: null, whId: l2wh, storeId: l2store, parentCode: l1code });
    }
    return { dealerCount: O.dealers.length, customerCount: Object.keys(O.customers).length };
  });
  R.org.summary = {
    hq: O.hq.code, l1: O.dealers.filter(d => d.parentCode === undefined).length,
    l2: O.dealers.filter(d => d.parentCode !== undefined).length,
    customers: Object.keys(O.customers).length,
  };

  // 会员
  await step(R.master, 'members', async () => {
    M.members = [];
    for (let i = 0; i < 4; i++) {
      const mid = uid();
      await db.insert(schema.member).values({ id: mid, memberNo: 'FFM' + String(1000 + i), name: '会员' + (i + 1), phone: '1380000' + String(1000 + i).slice(1), status: 'active' });
      M.members.push(mid);
    }
    return M.members.length;
  });

  // ===== 3. 总部备货（外部成衣采购 + 入库，作为销售出库的货源） =====
  console.log('· 3) 总部备货（采购订单 + 采购入库）...');
  const prep = {};
  await step(R.prep, 'hqGarmentPO', async () => {
    const skus = M.skus.map(s => ({ styleId: M.styleId, styleNo: 'FF-SPRING', skuId: s.id, color: s.color, size: s.size, quantity: 200, price: 80 }));
    const go = await garmentOrder.create({ supplierId: M.factory, supplierName: '锦绣服装加工厂', orderDate: '2026-09-01', skus }, 'SYS-SIM');
    await garmentOrder.submit(go.id, 'SYS-SIM');
    await garmentOrder.approve(go.id);
    prep.poId = go.id;
    return { orderNo: go.orderNo, status: go.status };
  });
  await step(R.prep, 'hqGarmentInbound', async () => {
    const gSkus = await db.select().from(schema.garmentPurchaseOrderSku).where(eq(schema.garmentPurchaseOrderSku.orderId, prep.poId));
    const ib = await garmentInbound.create({ orderId: prep.poId, warehouseId: O.hq.whId, warehouseName: '中央总仓', inboundDate: '2026-09-02', skus: gSkus.map(gs => ({ orderSkuId: gs.id, styleId: gs.styleId, styleNo: gs.styleNo, skuId: gs.skuId, color: gs.color, size: gs.size, quantity: Number(gs.quantity), price: Number(gs.price) })) }, 'SYS-SIM');
    await garmentInbound.approve(ib.id);
    prep.inboundNo = ib.inboundNo;
    return { inboundNo: ib.inboundNo };
  });
  // HQ 备货后库存快照
  prep.hqStockAfter = {};
  for (const s of M.skus) prep.hqStockAfter[s.id] = await skuStockAt(O.hq.whId, s.id);
  R.prep = Object.assign(R.prep, prep);

  // ===== 4. 订货会（Trade Show） =====
  console.log('· 4) 订货会 ...');
  const ts = {};
  await step(R.tradeShow, 'create+start', async () => {
    const t = await tradeShow.create({ name: '2026秋季订货会', year: '2026', season: 'autumn', startDate: '2026-09-05', endDate: '2026-09-10', remark: '模拟订货会' }, 'SYS-SIM');
    await tradeShow.start(t.id, 'SYS-SIM');
    ts.id = t.id; ts.no = t.showNo;
    return { id: t.id, no: t.showNo };
  });
  await step(R.tradeShow, 'preOrders', async () => {
    const created = [];
    // 两个一级经销商各下预订单
    for (const d of O.dealers.filter(x => x.parentCode === undefined)) {
      const items = M.skus.map(s => ({ skuId: s.id, skuCode: s.skuCode, color: s.color, size: s.size, qty: 50 }));
      const po = await preOrder.create({ tradeShowId: ts.id, submitterType: 'dealer', dealerId: d.id, styleId: M.styleId, items }, 'SYS-SIM');
      await preOrder.submit(po.id, 'SYS-SIM');
      await preOrder.confirm(po.id, 'SYS-SIM');
      created.push(po.preOrderNo);
    }
    return { preOrders: created };
  });
  R.tradeShow = Object.assign(R.tradeShow, ts);

  // ===== 5~7. 分销主链路：对每个一级经销商 销售订单 -> 镜像采购订单 -> 采购入库 -> 销售出库 -> 零售 =====
  console.log('· 5~7) 分销主链路（销售订单→采购订单→采购入库→销售出库→零售）...');
  const l1Dealers = O.dealers.filter(d => d.parentCode === undefined);
  for (const d of l1Dealers) {
    const F = { dealerCode: d.code, steps: {}, assertions: {} };
    // 5. 总部 -> 一级 销售订单
    await step(F.steps, 'salesOrder', async () => {
      const items = M.skus.map(s => ({ skuId: s.id, quantity: 50, price: 100 }));
      const so = await salesOrder.create({ customerId: d.custId, customerName: `一级经销商·${d.code}`, orderDate: '2026-09-12', items }, 'SYS-SIM');
      await salesOrder.audit(so.id);
      await salesOrder.book(so.id); // 触发镜像
      F.soId = so.id; F.soNo = so.orderNo;
      // F2：镜像可观测性 —— 记账后销售单应回写镜像状态与下游单据 id
      const soRow = await q1(schema.salesOrder, eq(schema.salesOrder.id, so.id));
      assert(soRow && soRow.mirrorStatus === 'success', `一级 ${d.code} 销售单记账后镜像状态=success`, `实际 ${soRow && soRow.mirrorStatus}; err=${soRow && soRow.mirrorError}`);
      assert(soRow && soRow.mirrorOrderId != null, `一级 ${d.code} 销售单回写镜像采购单 id`, `实际 ${soRow && soRow.mirrorOrderId}`);
      F.mirrorStatus = soRow && soRow.mirrorStatus; F.mirrorOrderId = soRow && soRow.mirrorOrderId;
      return { orderNo: so.orderNo, status: so.status };
    });
    // 6. 镜像生成的采购订单（一级视角）
    await step(F.steps, 'mirrorPurchaseOrder', async () => {
      const gpos = await db.select().from(schema.garmentPurchaseOrder).where(eq(schema.garmentPurchaseOrder.sourceDocId, F.soId));
      F.gpoId = gpos[0] ? gpos[0].id : null;
      const ok = gpos.length === 1;
      const okDown = gpos[0] && gpos[0].downstreamOrgId === d.id;
      const okType = gpos[0] && gpos[0].sourceDocType === 'SALES_ORDER';
      const okSup = gpos[0] && gpos[0].supplierId === O.hq.supplierId;
      assert(ok, `一级 ${d.code} 销售单记账后镜像出 1 张下游采购单`, `实际 ${gpos.length} 张`);
      assert(okDown, `一级 ${d.code} 镜像采购单 downstreamOrgId == 该经销商`, `实际 ${gpos[0] && gpos[0].downstreamOrgId}`);
      assert(okType, `一级 ${d.code} 镜像采购单 sourceDocType == SALES_ORDER`, `实际 ${gpos[0] && gpos[0].sourceDocType}`);
      assert(okSup, `一级 ${d.code} 镜像采购单 supplierId == 总部供应商`, `实际 ${gpos[0] && gpos[0].supplierId}`);
      assert(gpos[0] && gpos[0].status === 'wait_confirm', `一级 ${d.code} 镜像采购单初始为 wait_confirm（待下游确认）`, `实际 ${gpos[0] && gpos[0].status}`);
      F.assertions.mirror = { ok, okDown, okType, okSup, orderNo: gpos[0] && gpos[0].orderNo, status: gpos[0] && gpos[0].status };
      return F.assertions.mirror;
    });
    // 7a. 一级采购入库（收总部货）：镜像单先确认接收(wait_confirm->approved)，再入库
    await step(F.steps, 'confirmMirror', async () => {
      // F1：下游确认接收镜像采购单（入库门禁要求 status='approved'）
      const before = (await q1(schema.garmentPurchaseOrder, eq(schema.garmentPurchaseOrder.id, F.gpoId))).status;
      const updated = await garmentOrder.confirmPurchaseOrder(F.gpoId);
      assert(before === 'wait_confirm' && updated.status === 'approved', `一级 ${d.code} 确认接收镜像采购单 wait_confirm->approved`, `before=${before}; after=${updated.status}`);
      F.confirmedStatus = updated.status;
      return { before, after: updated.status };
    });
    await step(F.steps, 'purchaseInbound', async () => {
      const gSkus = await db.select().from(schema.garmentPurchaseOrderSku).where(eq(schema.garmentPurchaseOrderSku.orderId, F.gpoId));
      const ib = await garmentInbound.create({ orderId: F.gpoId, warehouseId: d.whId, warehouseName: `${d.code}仓`, inboundDate: '2026-09-13', skus: gSkus.map(gs => ({ orderSkuId: gs.id, styleId: gs.styleId, styleNo: gs.styleNo, skuId: gs.skuId, color: gs.color, size: gs.size, quantity: Number(gs.quantity), price: Number(gs.price) })) }, 'SYS-SIM');
      await garmentInbound.approve(ib.id);
      F.l1StockAfterInbound = {}; for (const s of M.skus) F.l1StockAfterInbound[s.id] = await skuStockAt(d.whId, s.id);
      // F3：应付闭环 —— 入库后应按 supplier 自动生成应付单（本场景供应商=总部）
      const ap = await q1(schema.payable, and(eq(schema.payable.supplierId, O.hq.supplierId), eq(schema.payable.bizType, 'garment_purchase_inbound')));
      assert(!!ap, `一级 ${d.code} 采购入库后生成下游应付单（供应商=总部）`, `应付单 ${ap ? ap.payableNo : '缺失'}`);
      F.payableNo = ap && ap.payableNo;
      return { inboundNo: ib.inboundNo, payableNo: ap && ap.payableNo };
    });
    // 7b. 总部销售出库（发往一级）
    await step(F.steps, 'salesOutbound', async () => {
      const soItems = await db.select().from(schema.salesOrderItem).where(eq(schema.salesOrderItem.orderId, F.soId));
      const ob = await salesOutbound.create({ orderId: F.soId, warehouseId: O.hq.whId, outboundDate: '2026-09-14', items: soItems.map(it => ({ orderItemId: it.id, quantity: Number(it.quantity) })) }, 'SYS-SIM');
      await salesOutbound.audit(ob.id);
      await salesOutbound.book(ob.id);
      F.hqStockAfterOutbound = {}; for (const s of M.skus) F.hqStockAfterOutbound[s.id] = await skuStockAt(O.hq.whId, s.id);
      return { outboundNo: ob.outboundNo, status: ob.status };
    });
    // 7c. 一级门店零售（会员）
    await step(F.steps, 'retail', async () => {
      const items = []; let amount = 0;
      for (const s of M.skus) {
        const avail = await skuStockAt(d.whId, s.id);
        const q = Math.min(2, avail);
        if (q > 0) { items.push({ skuId: s.id, quantity: q, dealPrice: 199 }); amount += q * 199; }
      }
      const memberId = M.members[l1Dealers.indexOf(d) % M.members.length];
      const beforePts = (await q1(schema.member, eq(schema.member.id, memberId))).points || 0;
      const ro = await retail.createDraftRetail({ storeId: d.storeId, saleDate: '2026-09-15', memberId, source: 'pos', items }, 'SYS-SIM');
      await retail.settleRetailOrder(ro.id, { payMethods: [{ method: 'cash', amount: String(amount) }], receivedAmount: amount, wholeDiscount: 1 }, 'SYS-SIM');
      const afterPts = (await q1(schema.member, eq(schema.member.id, memberId))).points || 0;
      F.retailNo = ro.retailNo; F.pointsDelta = Number(afterPts) - Number(beforePts);
      assert(F.pointsDelta > 0, `一级 ${d.code} 零售产生会员积分`, `积分增量 ${F.pointsDelta}`);
      return { retailNo: ro.retailNo, pointsDelta: F.pointsDelta };
    });
    R.flow.push(F);
  }

  // ===== 8. 多级验证：一级 -> 二级（L1 已有库存，向 L2 开销售单，镜像出 L2 采购单） =====
  console.log('· 8) 多级分销验证（一级->二级）...');
  const ml = {};
  const l1ForL2 = O.dealers.find(d => d.parentCode === undefined);
  const l2 = O.dealers.find(d => d.parentCode === l1ForL2.code);
  await step(R.multilevel, 'l1ToL2SalesOrder', async () => {
    const items = M.skus.map(s => ({ skuId: s.id, quantity: 20, price: 110 }));
    const so = await salesOrder.create({ customerId: l2.custId, customerName: `二级经销商·${l2.code}`, orderDate: '2026-09-16', items }, 'SYS-SIM');
    await salesOrder.audit(so.id);
    await salesOrder.book(so.id);
    ml.soNo = so.orderNo; ml.soId = so.id;
    // F2：一级->二级 镜像可观测性
    const soRow = await q1(schema.salesOrder, eq(schema.salesOrder.id, so.id));
    assert(soRow && soRow.mirrorStatus === 'success', `二级 ${l2.code} 上级销售单记账后镜像状态=success`, `实际 ${soRow && soRow.mirrorStatus}`);
    assert(soRow && soRow.mirrorOrderId != null, `二级 ${l2.code} 上级销售单回写镜像采购单 id`, `实际 ${soRow && soRow.mirrorOrderId}`);
    ml.mirrorStatus = soRow && soRow.mirrorStatus;
    return { orderNo: so.orderNo };
  });
  await step(R.multilevel, 'l2MirrorPurchaseOrder', async () => {
    const gpos = await db.select().from(schema.garmentPurchaseOrder).where(eq(schema.garmentPurchaseOrder.sourceDocId, ml.soId));
    const ok = gpos.length === 1;
    const okDown = gpos[0] && gpos[0].downstreamOrgId === l2.id;
    const okSup = gpos[0] && gpos[0].supplierId === l1ForL2.supId;
    assert(ok, `二级 ${l2.code} 镜像采购单数量为 1`, `实际 ${gpos.length}`);
    assert(okDown, `二级 ${l2.code} 镜像采购单 downstreamOrgId == 二级经销商`, `实际 ${gpos[0] && gpos[0].downstreamOrgId}`);
    assert(okSup, `二级 ${l2.code} 镜像采购单 supplierId == 一级供应商`, `实际 ${gpos[0] && gpos[0].supplierId}`);
    assert(gpos[0] && gpos[0].status === 'wait_confirm', `二级 ${l2.code} 镜像采购单初始为 wait_confirm`, `实际 ${gpos[0] && gpos[0].status}`);
    ml.gpoId = gpos[0] ? gpos[0].id : null;
    ml.assert = { ok, okDown, okSup, orderNo: gpos[0] && gpos[0].orderNo };
    return ml.assert;
  });
  await step(R.multilevel, 'l2ConfirmMirror', async () => {
    // F1：二级确认接收镜像采购单
    const before = (await q1(schema.garmentPurchaseOrder, eq(schema.garmentPurchaseOrder.id, ml.gpoId))).status;
    const updated = await garmentOrder.confirmPurchaseOrder(ml.gpoId);
    assert(before === 'wait_confirm' && updated.status === 'approved', `二级 ${l2.code} 确认接收镜像采购单 wait_confirm->approved`, `before=${before}; after=${updated.status}`);
    return { before, after: updated.status };
  });
  await step(R.multilevel, 'l2PurchaseInbound', async () => {
    const gSkus = await db.select().from(schema.garmentPurchaseOrderSku).where(eq(schema.garmentPurchaseOrderSku.orderId, ml.gpoId));
    const ib = await garmentInbound.create({ orderId: ml.gpoId, warehouseId: l2.whId, warehouseName: `${l2.code}仓`, inboundDate: '2026-09-17', skus: gSkus.map(gs => ({ orderSkuId: gs.id, styleId: gs.styleId, styleNo: gs.styleNo, skuId: gs.skuId, color: gs.color, size: gs.size, quantity: Number(gs.quantity), price: Number(gs.price) })) }, 'SYS-SIM');
    await garmentInbound.approve(ib.id);
    ml.l2Stock = {}; for (const s of M.skus) ml.l2Stock[s.id] = await skuStockAt(l2.whId, s.id);
    // F3：二级入库后应按 supplier（=一级供应商）生成应付单
    const ap = await q1(schema.payable, and(eq(schema.payable.supplierId, l1ForL2.supId), eq(schema.payable.bizType, 'garment_purchase_inbound')));
    assert(!!ap, `二级 ${l2.code} 采购入库后生成下游应付单（供应商=一级）`, `应付单 ${ap ? ap.payableNo : '缺失'}`);
    ml.payableNo = ap && ap.payableNo;
    return { inboundNo: ib.inboundNo, payableNo: ap && ap.payableNo };
  });
  await step(R.multilevel, 'l2SalesOutbound', async () => {
    const soItems = await db.select().from(schema.salesOrderItem).where(eq(schema.salesOrderItem.orderId, ml.soId));
    const ob = await salesOutbound.create({ orderId: ml.soId, warehouseId: l1ForL2.whId, outboundDate: '2026-09-18', items: soItems.map(it => ({ orderItemId: it.id, quantity: Number(it.quantity) })) }, 'SYS-SIM');
    await salesOutbound.audit(ob.id);
    await salesOutbound.book(ob.id);
    return { outboundNo: ob.outboundNo };
  });
  await step(R.multilevel, 'l2Retail', async () => {
    const items = []; let amount = 0;
    for (const s of M.skus) { const avail = await skuStockAt(l2.whId, s.id); const q = Math.min(2, avail); if (q > 0) { items.push({ skuId: s.id, quantity: q, dealPrice: 219 }); amount += q * 219; } }
    if (!items.length) return { skipped: true };
    const ro = await retail.createDraftRetail({ storeId: l2.storeId, saleDate: '2026-09-19', memberId: M.members[3], source: 'pos', items }, 'SYS-SIM');
    await retail.settleRetailOrder(ro.id, { payMethods: [{ method: 'cash', amount: String(amount) }], receivedAmount: amount, wholeDiscount: 1 }, 'SYS-SIM');
    ml.retailNo = ro.retailNo;
    return { retailNo: ro.retailNo, amount };
  });
  // 仅补充 ml 中独有的字段，避免覆盖 step 已采集的明细
  R.multilevel.soNo = ml.soNo; R.multilevel.soId = ml.soId;
  R.multilevel.gpoId = ml.gpoId; R.multilevel.assert = ml.assert;
  R.multilevel.l2Stock = ml.l2Stock; R.multilevel.retailNo = ml.retailNo;

  // ===== 9. 财务 / 经营分析 轻量连通 =====
  console.log('· 9) 财务应收 / 经营分析 连通校验 ...');
  await step(R.finance, 'receivableList', async () => {
    const list = (await receivable.list({})).items;
    // 销售单记账应生成应收（分销场景下总部对一级的应收）
    const fromSo = list.filter(r => r.sourceDocType === 'SALES_ORDER' || r.remark && String(r.remark).includes('销售'));
    R.finance.receivableCount = list.length;
    note(`应收单据 ${list.length} 张（来自销售单 ${fromSo.length} 张）`);
    // F3：应付闭环总额校验 —— 下游入库生成的应付，应与上游销售应收总额基本对应
    const payRows = await db.select({ amt: sql`coalesce(sum(${schema.payable.amount}::numeric),0)` }).from(schema.payable).where(eq(schema.payable.bizType, 'garment_purchase_inbound'));
    R.finance.totalPayable = Number(payRows[0].amt);
    assert(list.length >= 3 && Number(payRows[0].amt) > 0, `上下游应收(${list.length})/应付(¥${Number(payRows[0].amt)})闭环连通`, `应收 ${list.length} 笔；应付合计 ¥${Number(payRows[0].amt)}`);
    return { total: list.length, fromSalesOrder: fromSo.length, totalPayable: Number(payRows[0].amt) };
  });
  await step(R.analytics, 'mobileDashboard', async () => {
    const d = await analytics.mobileDashboard();
    R.analytics.keys = Object.keys(d || {});
    return { keys: Object.keys(d || {}).length };
  });
  await step(R.analytics, 'bi', async () => {
    const b = await analytics.bi('style', 'amount', '2026-01-01', '2026-12-31');
    return { rows: (b && b.rows ? b.rows.length : 0) };
  });

  // ===== 数据规模快照（组织/主数据按 FF- 前缀精确统计本测试产物；业务表已截断故为全量） =====
  const snap = await client.unsafe(`SELECT
    (SELECT count(*) FROM style WHERE style_no LIKE 'FF-%') styles,
    (SELECT count(*) FROM sku WHERE sku_code LIKE 'FF-%') skus,
    (SELECT count(*) FROM dealer WHERE code LIKE 'FF-%') dealers,
    (SELECT count(*) FROM customer WHERE code LIKE 'FF-%') customers,
    (SELECT count(*) FROM supplier WHERE code LIKE 'FF-%') suppliers,
    (SELECT count(*) FROM warehouse WHERE code LIKE 'FF-%') warehouses,
    (SELECT count(*) FROM store WHERE code LIKE 'FF-%') stores,
    (SELECT count(*) FROM trade_show) trade_shows,
    (SELECT count(*) FROM pre_order) pre_orders,
    (SELECT count(*) FROM garment_purchase_order) garment_pos,
    (SELECT count(*) FROM garment_purchase_inbound) garment_inbounds,
    (SELECT count(*) FROM sales_order) sales_orders,
    (SELECT count(*) FROM sales_outbound) sales_outbounds,
    (SELECT count(*) FROM retail_order) retail_orders,
    (SELECT count(*) FROM receivable) receivables,
    (SELECT count(*) FROM inventory_stock WHERE warehouse_id IN (SELECT id FROM warehouse WHERE code LIKE 'FF-%')) stock_rows,
    (SELECT sum(quantity::numeric) FROM inventory_stock WHERE warehouse_id IN (SELECT id FROM warehouse WHERE code LIKE 'FF-%')) total_stock_qty,
    (SELECT sum(points) FROM member WHERE member_no LIKE 'FFM%') total_member_points
  `);
  R.snapshot = snap[0];

  // 汇总 issue 统计
  const fail = R.issues.filter(i => !i.ok).length;
  const pass = R.issues.filter(i => i.ok).length;
  R.issueSummary = { total: R.issues.length, fail, pass };

  fs.writeFileSync('/tmp/fullflow-result.json', JSON.stringify(R, null, 2));
  console.log('\n=== 模拟完成 ===');
  console.log(`断言/检查：${R.issueSummary.total} 项（通过 ${pass} / 失败 ${fail}）；运行期错误：${R.errors.length} 个`);
  console.log(`数据规模：${JSON.stringify(R.snapshot)}`);
  console.log('结果已写入 /tmp/fullflow-result.json');
  await client.end();
  process.exit(fail === 0 && R.errors.length === 0 ? 0 : 2);
})().catch(async (e) => {
  console.error('FATAL', e);
  try { R.errors.push({ where: 'FATAL', msg: String(e && e.message ? e.message : e) }); fs.writeFileSync('/tmp/fullflow-result.json', JSON.stringify(R, null, 2)); } catch (_) {}
  try { await client.end(); } catch (_) {}
  process.exit(1);
});
