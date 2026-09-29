/* 多级分销端到端验证脚本
 * 目的：用已模拟的组织数据，验证"总部(HQ)→一级经销商 销售单 book → 自动镜像生成一级经销商采购单"。
 * 同时验证 allocation 统一后的伙伴模型（客户以 partner_id 关联经销商）。
 *
 * 用法：node verify-distribution.cjs
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq } = require('drizzle-orm');
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

const schema = require('./dist/server/database/schema');
const { dealer, customer, sku, style, garmentPurchaseOrder, salesOrder } = schema;
const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service');
const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { GarmentPurchaseOrderService } = require('./dist/server/modules/purchase/garment-order/garment-purchase-order.service');
const { GarmentPurchaseReturnService } = require('./dist/server/modules/purchase/garment-return/garment-purchase-return.service');
const { GarmentPurchaseInboundService } = require('./dist/server/modules/purchase/garment-inbound/garment-purchase-inbound.service');
const { MonthCloseService } = require('./dist/server/modules/finance/month-close/month-close.service');
const { DistributionMirrorService } = require('./dist/server/modules/distribution/distribution-mirror.service');
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log('=== 多级分销 端到端验证 ===');

  // 1) 取 HQ 与一级经销商 + 其客户
  const [hq] = await db.select().from(dealer).where(eq(dealer.code, 'DL-HQ'));
  const [l1] = await db.select().from(dealer).where(eq(dealer.code, 'DL-HQ-01'));
  if (!hq || !l1) { throw new Error('未找到 DL-HQ / DL-HQ-01，请先运行 node sim-org.cjs'); }
  const [l1Cust] = await db.select().from(customer).where(eq(customer.code, 'CUST-DL-HQ-01'));
  if (!l1Cust) { throw new Error('未找到 CUST-DL-HQ-01（伙伴客户），请先运行 node sim-org.cjs'); }
  console.log(`· HQ: ${hq.name} (${hq.code})；一级: ${l1.name} (${l1.code})；客户: ${l1Cust.name} (partner_id=${l1Cust.partnerId === l1.id ? '✓ 与经销商一致' : '✗ 不一致'})`);

  // 2) 取一个 SKU（没有则造一个最小 style+sku）
  let [sk] = await db.select().from(sku).limit(1);
  if (!sk) {
    const styleId = uid();
    await db.insert(style).values({ id: styleId, code: 'STY-TEST', name: '验证款', status: 'active' });
    const skuId = uid();
    await db.insert(sku).values({ id: skuId, skuCode: 'SKU-TEST-001', styleId, styleNo: 'STY-TEST', color: '黑', size: 'M', costPrice: '50', tagPrice: '199', supplyPrice: '100', status: 'active' });
    [sk] = await db.select().from(sku).where(eq(sku.id, skuId));
    console.log('· 已创建测试 SKU: SKU-TEST-001');
  } else {
    console.log(`· 复用现有 SKU: ${sk.skuCode}`);
  }

  // 3) 装配服务（与 sim-business.cjs 一致的方式）
  const ng = new NumberGeneratorService();
  const monthClose = new MonthCloseService(db);
  const stockService = new StockService(db);
  const garmentOrder = new GarmentPurchaseOrderService(db, ng);
  const garmentReturn = new GarmentPurchaseReturnService(db, ng);
  const garmentInbound = new GarmentPurchaseInboundService(db, monthClose, ng, stockService);
  const mirror = new DistributionMirrorService(db, garmentOrder, garmentReturn);
  const salesOrderSvc = new SalesOrderService(db, ng, mirror);

  // 4) 总部向一级经销商开销售单 → 审核 → 记账（触发镜像）
  const so = await salesOrderSvc.create({
    customerId: l1Cust.id,
    orderDate: today,
    items: [{ skuId: sk.id, quantity: 10, price: 100 }],
    remark: '端到端验证：总部→一级经销商',
  }, 'SYS-VERIFY');
  console.log(`· 已创建销售单 ${so.orderNo}（状态 ${so.status}）`);
  await salesOrderSvc.audit(so.id);
  await salesOrderSvc.book(so.id);
  console.log(`· 已审核并记账销售单 ${so.orderNo}`);

  // 5) 校验镜像生成的下游采购单
  const gpos = await db.select().from(garmentPurchaseOrder).where(eq(garmentPurchaseOrder.sourceDocId, so.id));
  if (gpos.length === 0) {
    throw new Error('✗ 镜像未生成下游成衣采购单！分销链路异常。');
  }
  const gpo = gpos[0];
  const okDownstream = gpo.downstreamOrgId === l1.id;
  const okType = gpo.sourceDocType === 'SALES_ORDER';
  console.log(`· 镜像生成成衣采购单 ${gpo.orderNo}（状态 ${gpo.status}）`);
  console.log(`  - downstream_org_id == 一级经销商? ${okDownstream ? '✓' : '✗'}`);
  console.log(`  - source_doc_type == SALES_ORDER? ${okType ? '✓' : '✗'}`);
  const okWaitConfirm = gpo.status === 'wait_confirm';
  console.log(`  - 初始状态 == wait_confirm（待下游确认，F1）? ${okWaitConfirm ? '✓' : '✗'}`);

  // 5a) P1-3 原子回填回归：下游采购单的 sourceDocId 必须等于源销售单。
  //     此前 sourceDocId 由独立 UPDATE 设置，现已并入与 create 同一个事务；若仍单独提交则此处捕获不到回填。
  const okSourceDoc = gpo.sourceDocId === so.id;
  console.log(`  - sourceDocId == 源销售单（原子回填，P1-3）? ${okSourceDoc ? '✓' : '✗'}`);

  // 5b) P1-3 幂等回归：再次触发镜像不应重复生成下游采购单。
  //     这是修复"部分失败→sourceDocId=NULL→重试重复下游单"的护栏：重复调用必须命中去重、不新增。
  await mirror.mirrorFromSalesOrder(so.id);
  const gposAgain = await db.select().from(garmentPurchaseOrder).where(eq(garmentPurchaseOrder.sourceDocId, so.id));
  const okIdempotent = gposAgain.length === 1;
  console.log(`  - 重复触发镜像后下游采购单数量 == 1（幂等，不重复生成，P1-3）? ${okIdempotent ? '✓' : '✗(' + gposAgain.length + ')'}`);

  // 5b) 下游确认接收（F1：wait_confirm -> approved）并入库 + 应付闭环（F3）
  const confirmed = await garmentOrder.confirmPurchaseOrder(gpo.id);
  console.log(`· 下游确认接收采购单：${gpo.orderNo} ${gpo.status} -> ${confirmed.status} ${confirmed.status === 'approved' ? '✓' : '✗'}`);
  const [l1Wh] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.dealerId, l1.id)).limit(1);
  const gSkus = await db.select().from(schema.garmentPurchaseOrderSku).where(eq(schema.garmentPurchaseOrderSku.orderId, gpo.id));
  const ib = await garmentInbound.create({ orderId: gpo.id, warehouseId: l1Wh.id, warehouseName: l1Wh.name, inboundDate: today, skus: gSkus.map(gs => ({ orderSkuId: gs.id, styleId: gs.styleId, styleNo: gs.styleNo, skuId: gs.skuId, color: gs.color, size: gs.size, quantity: Number(gs.quantity), price: Number(gs.price) })) }, 'SYS-VERIFY');
  await garmentInbound.approve(ib.id);
  const [sup] = await db.select().from(schema.supplier).where(eq(schema.supplier.partnerId, hq.id)).limit(1);
  const [ap] = await db.select().from(schema.payable).where(eq(schema.payable.supplierId, sup.id));
  console.log(`· 采购入库 ${ib.inboundNo} 完成；应付单：${ap ? ap.payableNo + ' ✓' : '缺失 ✗'}`);

  // 6) 校验客户确为伙伴模型（partner_id = 经销商）
  const [chkCust] = await db.select().from(customer).where(eq(customer.id, l1Cust.id));
  console.log(`· 客户 ${chkCust.code} 的 partner_id == 经销商 ${l1.code}? ${chkCust.partnerId === l1.id ? '✓' : '✗'}`);

  console.log('\n=== 验证结论 ===');
  if (okDownstream && okType && okWaitConfirm && okSourceDoc && okIdempotent && confirmed.status === 'approved' && !!ap && chkCust.partnerId === l1.id) {
    console.log('✅ 通过：组织数据 + 伙伴模型 + 销售单镜像(wait_confirm→确认→入库→应付) 全链路正常。');
  } else {
    console.log('❌ 未通过，请检查上述问题。');
    process.exitCode = 1;
  }
  await client.end();
}

main().catch(async (e) => { console.error('验证失败：', e); try { await client.end(); } catch (_) {} process.exit(1); });
