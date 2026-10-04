/* 新模块(P0/P1)业务逻辑层功能测试
 * 直接实例化 Service（注入真实 db + 协作服务），绕过平台 HTTP/代理，验证真实业务流程。
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, getTableName } = require('drizzle-orm');
const postgres = require('postgres');
const crypto = require('crypto');
const schema = require('./dist/server/database/schema');
const { SubcontractService } = require('./dist/server/modules/subcontract/subcontract.service');
const { InventoryReplenishService } = require('./dist/server/modules/inventory/replenish/inventory-replenish.service');
const { InventoryMobileService } = require('./dist/server/modules/inventory/mobile/inventory-mobile.service');
const { AnalyticsService } = require('./dist/server/modules/analytics/analytics.service');
const { MemberService } = require('./dist/server/modules/member/member.service');
const { OmniService } = require('./dist/server/modules/omni/omni.service');
const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service');

const client = postgres(process.env.SUDA_DATABASE_URL);
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();
const R = {};

function assignDb(svc) { svc.db = db; return svc; }
async function q1(t, where) { const r = await db.select().from(t).where(where).limit(1); return r[0]; }

(async () => {
  // 清空本测试涉及的表，保证可重复运行（前置表用了固定编码，业务表用了固定单号/编码）
  const CLEAN = [
    'color_group','size_group','style','sku','warehouse','material','supplier',
    'material_stock','inventory_stock','inventory_flow','inventory_batch',
    'inventory_stocktake','inventory_stocktake_item',
    'subcontract_order','subcontract_order_item','subcontract_issue','subcontract_issue_item',
    'subcontract_receipt','subcontract_receipt_item','subcontract_fee','payable',
    'garment_purchase_order','garment_purchase_order_sku',
    'sales_channel','omni_order','omni_order_item',
    'member','member_tag','member_point',
  ];
  await client.unsafe('TRUNCATE ' + CLEAN.map(t => `"${t}"`).join(', ') + ' RESTART IDENTITY CASCADE');

  // 前置数据
  const colorGroupId = uid(), sizeGroupId = uid(), styleId = uid(), skuId = uid(), whId = uid(), matId = uid(), supId = uid();
  await db.insert(schema.colorGroup).values({ id: colorGroupId, code: 'CG-T', name: '色组T', status: 'active' });
  await db.insert(schema.sizeGroup).values({ id: sizeGroupId, code: 'SG-T', name: '尺码T', status: 'active' });
  await db.insert(schema.style).values({ id: styleId, styleNo: 'ST-T001', name: '测试款', colorGroupId, sizeGroupId, status: 'active', lifecycleStatus: 'introduction', attributes: {} });
  await db.insert(schema.sku).values({ id: skuId, skuCode: 'SKU-T001', styleId, styleNo: 'ST-T001', color: '红', size: 'M', status: 'active' });
  await db.insert(schema.warehouse).values({ id: whId, code: 'WH-T', name: '测试仓', type: 'main', status: 'active' });
  await db.insert(schema.material).values({ id: matId, code: 'MAT-T', name: '测试面料', unit: '米', status: 'active' });
  await db.insert(schema.supplier).values({ id: supId, code: 'SUP-T', name: '测试供应商', status: 'active' });

  const ng = new NumberGeneratorService();
  const stock = assignDb(new StockService());
  const sub = assignDb(new SubcontractService(db, ng, stock));
  const replenish = assignDb(new InventoryReplenishService(db, ng));
  const mobile = assignDb(new InventoryMobileService(db, ng));
  const analytics = assignDb(new AnalyticsService());
  const member = assignDb(new MemberService(db, ng));
  const omni = assignDb(new OmniService(db, stock, ng));

  // ---- 1. Subcontract 全生命周期 ----
  R.subcontract = {};
  try {
    const order = await sub.createOrder({ supplierId: supId, orderDate: '2026-09-17', items: [
      { skuId, quantity: 100, unitPrice: 50 }, { skuId, quantity: 50, unitPrice: 60 } ] });
    R.subcontract.createOrder = 'OK ' + order.orderNo + ' 金额=' + order.totalAmount + ' 数量=' + order.totalQuantity;
    const orderId = order.id;
    // 发料
    const issue = await sub.createIssue({ orderId, warehouseId: whId, issueDate: '2026-09-18', items: [ { materialId: matId, quantity: 200 } ] });
    R.subcontract.createIssue = 'OK ' + issue.id;
    // 发料审核前给物料库存 500
    await db.insert(schema.materialStock).values({ materialId: matId, warehouseId: whId, warehouseName: '测试仓', materialCode: 'MAT-T', materialName: '测试面料', quantity: '500' });
    const matBefore = (await q1(schema.materialStock, eq(schema.materialStock.materialId, matId)))?.quantity;
    await sub.approveIssue(issue.id);
    const matAfter = (await q1(schema.materialStock, eq(schema.materialStock.materialId, matId)))?.quantity;
    R.subcontract.approveIssue = `OK 物料库存 ${matBefore} -> ${matAfter}`;
    // 回收
    const receipt = await sub.createReceipt({ orderId, warehouseId: whId, receiptDate: '2026-09-19', items: [ { skuId, quantity: 80, qualifiedQty: 75 } ] });
    await sub.approveReceipt(receipt.id);
    const skuStock = await q1(schema.inventoryStock, eq(schema.inventoryStock.skuId, skuId));
    R.subcontract.approveReceipt = 'OK 成衣库存=' + (skuStock ? skuStock.quantity : 'NULL');
    // 加工费 + 结算
    const fee = await sub.createFee({ orderId, quantity: 150, unitPrice: 10 });
    await sub.settleFee(fee.id);
    const payableRows = await db.select().from(schema.payable).where(eq(schema.payable.bizNo, fee.id));
    R.subcontract.settleFee = 'OK 生成应付单=' + (payableRows[0]?.payableNo || 'NONE');
  } catch (e) { R.subcontract.error = String(e.message || e).slice(0, 200); }

  // ---- 2. Analytics 读取/计算 ----
  R.analytics = {};
  try {
    const f = await analytics.forecast(skuId); R.analytics.forecast = 'OK months=' + (f.history?.length ?? 0) + ' forecast=' + (f.forecast?.length ?? 0) + ' recStock=' + f.recommendedStock;
  } catch (e) { R.analytics.forecast = 'ERR:' + String(e.message||e).slice(0,120); }
  try { const l = await analytics.lifecycleList(); R.analytics.lifecycleList = 'OK items=' + (l?.length ?? 0); } catch (e) { R.analytics.lifecycleList = 'ERR:' + String(e.message||e).slice(0,120); }
  try { const b = await analytics.bi('style', 'amount', '2026-01-01', '2026-12-31'); R.analytics.bi = 'OK rows=' + (b?.rows?.length ?? 0); } catch (e) { R.analytics.bi = 'ERR:' + String(e.message||e).slice(0,120); }

  // ---- 3. Member ----
  R.member = {};
  try { const c = await member.create({ memberNo: 'M-T001', name: '测试会员', phone: '13800000000' }); R.member.create = 'OK ' + c.memberNo; } catch (e) { R.member.create = 'ERR:' + String(e.message||e).slice(0,120); }
  try { const lst = await member.list({ page:1, pageSize:10 }); R.member.list = 'OK total=' + (lst?.total ?? 0); } catch (e) { R.member.list = 'ERR:' + String(e.message||e).slice(0,120); }
  try { const t = await member.createTag('VIP测试'); R.member.createTag = 'OK ' + t.name; } catch (e) { R.member.createTag = 'ERR:' + String(e.message||e).slice(0,120); }
  try { const ts = await member.listTags(); R.member.listTags = 'OK ' + (ts?.length ?? 0); } catch (e) { R.member.listTags = 'ERR:' + String(e.message||e).slice(0,120); }

  // ---- 4. Omni ----
  R.omni = {};
  try { const ch = await omni.createChannel({ channelCode: 'CH-T01', name: '测试渠道', platform: 'wechat' }); R.omni.createChannel = 'OK ' + ch.channelCode;
    const o = await omni.createOrder({ channelId: ch.id, customerName: '张三', items: [ { skuId, skuCode:'SKU-T001', styleNo:'ST-T001', color:'红', size:'M', quantity:2, price:99 } ] });
    R.omni.createOrder = 'OK ' + o.orderNo;
    const alloc = await omni.allocate(o.id); R.omni.allocate = 'OK ' + JSON.stringify(alloc).slice(0,80);
  } catch (e) { R.omni.error = 'ERR:' + String(e.message||e).slice(0,160); }

  // ---- 5. Replenish / Mobile ----
  R.replenish = {};
  try { const s = await replenish.suggest({ page:1, pageSize:10 }); R.replenish.suggest = 'OK suggestions=' + (s?.items?.length ?? 0); } catch (e) { R.replenish.suggest = 'ERR:' + String(e.message||e).slice(0,120); }
  R.mobile = {};
  try { const b = await mobile.generateBarcodes(); R.mobile.generateBarcodes = 'OK ' + JSON.stringify(b).slice(0,80); } catch (e) { R.mobile.generateBarcodes = 'ERR:' + String(e.message||e).slice(0,120); }
  try { const lst = await mobile.listBatches({ page:1, pageSize:10 }); R.mobile.listBatches = 'OK total=' + (lst?.total ?? 0); } catch (e) { R.mobile.listBatches = 'ERR:' + String(e.message||e).slice(0,120); }

  console.log(JSON.stringify(R, null, 2));
  await client.end();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
