/* 服装ERP 全业务链路模拟（订货会 -> 店铺零售）
 * 绕过平台 HTTP/代理，直接实例化 Service + 注入真实 db，跑通真实业务数据。
 * 多轮（3 个订货季）演练，每步 try/catch 收集结果，发现流程问题。
 *
 * 业务主线（修正后）：
 *   订货会 -> 预订单(经销商 + 直营门店) -> 生产备货(MRP/原料采购/工单/完工入库)
 *   -> 批发销售出库(手动) -> 配货(聚合预订单,审核自动生成 经销商销售单/应收 + 门店调拨单)
 *   -> 门店调拨收货 -> 门店零售(会员积分) -> 零售退货 -> 成衣采购(第3轮)
 *   -> 财务核销 -> 经营分析 -> 库存盘点 -> 月结
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, sql, getTableName } = require('drizzle-orm');
const postgres = require('postgres');
const crypto = require('crypto');

const schema = require('./dist/server/database/schema');
const { TradeShowService } = require('./dist/server/modules/trade-show/trade-show.service');
const { PreOrderService } = require('./dist/server/modules/trade-show/pre-order.service');
const { AllocationService } = require('./dist/server/modules/trade-show/allocation.service');
const { BomService } = require('./dist/server/modules/bom/bom.service');
const { MrpService } = require('./dist/server/modules/production/mrp/mrp.service');
const { WorkOrderService } = require('./dist/server/modules/production/work-order/work-order.service');
const { MaterialIssueService } = require('./dist/server/modules/production/material-issue/material-issue.service');
const { FinishReceiptService } = require('./dist/server/modules/production/finish-receipt/finish-receipt.service');
const { MaterialPurchaseOrderService } = require('./dist/server/modules/production/material-purchase/material-purchase-order.service');
const { MaterialPurchaseInboundService } = require('./dist/server/modules/production/material-purchase/material-purchase-inbound.service');
const { InventoryTransferService } = require('./dist/server/modules/inventory/transfer/inventory-transfer.service');
const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service');
const { SalesOutboundService } = require('./dist/server/modules/sales/outbound/sales-outbound.service');
const { RetailService } = require('./dist/server/modules/retail/retail.service');
const { RetailReportService } = require('./dist/server/modules/retail/retail-report.service');
const { GarmentPurchaseOrderService } = require('./dist/server/modules/purchase/garment-order/garment-purchase-order.service');
const { GarmentPurchaseInboundService } = require('./dist/server/modules/purchase/garment-inbound/garment-purchase-inbound.service');
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service');
const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { OperationLogService } = require('./dist/server/modules/system/operation-log/operation-log.service');
const { MonthCloseService } = require('./dist/server/modules/finance/month-close/month-close.service');
const { PayableService } = require('./dist/server/modules/finance/payable/payable.service');
const { ReceivableService } = require('./dist/server/modules/finance/receivable/receivable.service');
const { PaymentService } = require('./dist/server/modules/finance/payment/payment.service');
const { ReceiptService } = require('./dist/server/modules/finance/receipt/receipt.service');
const { AnalyticsService } = require('./dist/server/modules/analytics/analytics.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();
const R = { meta: {}, master: {}, rounds: [], finance: {}, analytics: {}, monthClose: {} };

function assignDb(svc) { svc.db = db; return svc; }
async function q1(t, where) { const r = await db.select().from(t).where(where).limit(1); return r[0]; }
async function skuStockAt(whId, skuId) {
  const r = await q1(schema.inventoryStock, and(eq(schema.inventoryStock.warehouseId, whId), eq(schema.inventoryStock.skuId, skuId)));
  return r ? Number(r.quantity) : 0;
}
function distribute(total, n) {
  const arr = new Array(n).fill(0);
  for (let i = 0; i < total; i++) arr[i % n]++;
  return arr.slice(0, n);
}
const ctx = { userId: 'SYS-SIM', userName: '模拟器', module: 'sim' };
const step = async (store, name, fn) => {
  try { const v = await fn(); store[name] = (typeof v === 'object') ? v : String(v); }
  catch (e) { store[name] = 'ERR:' + String(e.message || e).slice(0, 220); }
};

(async () => {
  const uidLocal = uid;
  // ===== 清空全部业务表（可重复运行）=====
  const CLEAN = [
    'color_group','size_group','style','sku','material','supplier','dealer','customer','member','member_tag','member_point',
    'warehouse','store','trade_show','pre_order','pre_order_item','allocation_order','allocation_item',
    'bom','bom_item','production_work_order','production_material_issue','production_material_issue_item',
    'production_finish_receipt','production_finish_receipt_item',
    'material_purchase_order','material_purchase_order_item','material_purchase_inbound','material_purchase_inbound_item',
    'inventory_stock','material_stock','inventory_flow','inventory_transfer','inventory_transfer_item',
    'inventory_stocktake','inventory_stocktake_item',
    'garment_purchase_order','garment_purchase_order_sku','garment_purchase_inbound','garment_purchase_inbound_sku',
    'sales_order','sales_order_item','sales_outbound','sales_outbound_item','sales_return','sales_return_item',
    'retail_order','retail_order_item','retail_return',
    'payable','payable_payment','receivable','receivable_payment',
    'finance_payment','finance_payment_writeoff','finance_receipt','finance_receipt_writeoff',
    'month_close','month_close_detail','month_close_log','system_operation_log',
    'subcontract_order','subcontract_order_item','subcontract_issue','subcontract_issue_item',
    'subcontract_receipt','subcontract_receipt_item','subcontract_fee',
  ];
  await client.unsafe('TRUNCATE ' + CLEAN.map(t => `"${t}"`).join(', ') + ' RESTART IDENTITY CASCADE');

  // ===== 实例化服务 =====
  const ng = new NumberGeneratorService();
  const stock = assignDb(new StockService());
  const opLog = assignDb(new OperationLogService());
  const monthClose = assignDb(new MonthCloseService());
  const tradeShow = assignDb(new TradeShowService(db, ng));
  const preOrder = assignDb(new PreOrderService(db, ng));
  const allocation = assignDb(new AllocationService(db, stock, ng));
  const bom = assignDb(new BomService(db));
  const mrp = assignDb(new MrpService(db));
  const workOrder = assignDb(new WorkOrderService(db, ng));
  const materialIssue = assignDb(new MaterialIssueService(db, ng, stock));
  const finishReceipt = assignDb(new FinishReceiptService(db, ng, stock));
  const materialPurchaseOrder = assignDb(new MaterialPurchaseOrderService(db, ng));
  const materialPurchaseInbound = assignDb(new MaterialPurchaseInboundService(db, monthClose, ng));
  const transfer = assignDb(new InventoryTransferService(db, monthClose, stock, ng));
  const salesOrder = assignDb(new SalesOrderService(db, ng));
  const salesOutbound = assignDb(new SalesOutboundService(db, monthClose, stock, ng));
  const retail = assignDb(new RetailService(db, monthClose, stock, ng));
  const retailReport = assignDb(new RetailReportService(db));
  const garmentOrder = assignDb(new GarmentPurchaseOrderService(db, ng));
  const garmentInbound = assignDb(new GarmentPurchaseInboundService(db, monthClose, ng));
  const payable = assignDb(new PayableService(db, monthClose));
  const receivable = assignDb(new ReceivableService(db, monthClose));
  const payment = assignDb(new PaymentService(db, ng, opLog));
  const receipt = assignDb(new ReceiptService(db, ng, opLog));
  const analytics = assignDb(new AnalyticsService());

  R.meta.services = 'all instantiated';

  // ===== 主数据 =====
  const M = {};
  M.colorGroupId = uid(); M.sizeGroupId = uid();
  await db.insert(schema.colorGroup).values({ id: M.colorGroupId, code: 'CG-01', name: '基础色组', status: 'active' });
  await db.insert(schema.sizeGroup).values({ id: M.sizeGroupId, code: 'SG-01', name: '标准尺码', status: 'active' });
  // 2 个面料
  M.matA = uid(); M.matB = uid();
  await db.insert(schema.material).values([
    { id: M.matA, code: 'MAT-COTTON', name: '精梳棉布', unit: '米', status: 'active' },
    { id: M.matB, code: 'MAT-POLY', name: '聚酯纤维', unit: '米', status: 'active' },
  ]);
  // 供应商：面料商 + 加工厂
  M.fabricSup = uid(); M.factory = uid();
  await db.insert(schema.supplier).values([
    { id: M.fabricSup, code: 'SUP-FAB', name: '锦绣面料有限公司', status: 'active' },
    { id: M.factory, code: 'SUP-FAC', name: '晨光服装加工厂', status: 'active' },
  ]);
  // 经销商 + 批发客户
  M.dealer = uid(); M.cust = uid();
  await db.insert(schema.dealer).values({ id: M.dealer, code: 'DL-001', name: '华东总经销商' });
  await db.insert(schema.customer).values({ id: M.cust, code: 'CUS-001', name: '华南连锁批发' });
  // 主仓（总部成品仓，allocation 审核时按 type='finished' 查找）
  M.whMain = uid();
  await db.insert(schema.warehouse).values({ id: M.whMain, code: 'WH-MAIN', name: '中央总仓', type: 'finished', status: 'active' });
  // 门店（2 直营 + 1 加盟），各挂独立仓
  M.stores = [];
  const storeDefs = [
    { code: 'ST-D01', name: '杭州湖滨直营店', type: 'direct' },
    { code: 'ST-D02', name: '上海南京路直营店', type: 'direct' },
    { code: 'ST-F01', name: '苏州加盟店', type: 'franchise' },
  ];
  for (const sd of storeDefs) {
    const wid = uid(); const sid = uid();
    await db.insert(schema.warehouse).values({ id: wid, code: sd.code + '-WH', name: sd.name + '仓', type: 'store', status: 'active' });
    await db.insert(schema.store).values({ id: sid, code: sd.code, name: sd.name, storeType: sd.type, warehouseId: wid, status: 'active' });
    M.stores.push({ id: sid, whId: wid, ...sd });
  }
  // 会员
  M.members = [];
  for (let i = 0; i < 5; i++) {
    const mid = uid();
    await db.insert(schema.member).values({ id: mid, memberNo: 'M' + String(1000 + i), name: '会员' + (i + 1), phone: '1380000' + String(1000 + i).slice(1), status: 'active' });
    M.members.push(mid);
  }
  // 款式 + SKU（3 款，每款 2 色 x 2 码 = 4 SKU）
  const colors = [['红', 'CG-RED'], ['黑', 'CG-BLK']];
  const sizes = ['S', 'M', 'L', 'XL'];
  const styleDefs = [
    { no: 'ST-SPRING', name: '春日清新卫衣', season: 'spring' },
    { no: 'ST-SUMMER', name: '盛夏冰丝T恤', season: 'summer' },
    { no: 'ST-AUTUMN', name: '秋日风衣外套', season: 'autumn' },
  ];
  M.styles = [];
  for (let s = 0; s < styleDefs.length; s++) {
    const sd = styleDefs[s];
    const sid = uid();
    await db.insert(schema.style).values({ id: sid, styleNo: sd.no, name: sd.name, colorGroupId: M.colorGroupId, sizeGroupId: M.sizeGroupId, season: sd.season, status: 'active', lifecycleStatus: 'active', attributes: {} });
    const skus = [];
    for (const [c, _] of colors) {
      for (const sz of sizes.slice(0, 2)) { // 每色 2 码
        const kid = uid();
        const skuCode = sd.no + '-' + c + '-' + sz;
        await db.insert(schema.sku).values({ id: kid, skuCode, styleId: sid, styleNo: sd.no, color: c, size: sz, status: 'active', costPrice: '80', tagPrice: '299', supplyPrice: '120' });
        skus.push({ id: kid, skuCode, color: c, size: sz });
      }
    }
    M.styles.push({ id: sid, no: sd.no, name: sd.name, skus });
    // BOM（每款用 2 种面料）
    await bom.createBom({ styleId: sid, version: 'V1', items: [
      { materialId: M.matA, usagePerPiece: 1.5, lossRate: 0.05, bomType: 'fabric', remark: '面料A' },
      { materialId: M.matB, usagePerPiece: 0.3, lossRate: 0.03, bomType: 'accessory', remark: '辅料B' },
    ] }, 'SYS-SIM');
  }
  R.master = { styles: M.styles.length, skus: M.styles.reduce((a, x) => a + x.skus.length, 0), stores: M.stores.length, members: M.members.length, materials: 2 };

  // ===== 三轮订货季 =====
  const rounds = [
    { name: '2026春季订货会', season: 'spring', base: '2026-03-10', styleIdx: 0, dealerPerSku: 20, storePerSku: 10, manualPerSku: 10 },
    { name: '2026夏季订货会', season: 'summer', base: '2026-06-10', styleIdx: 1, dealerPerSku: 30, storePerSku: 15, manualPerSku: 10 },
    { name: '2026秋季订货会', season: 'autumn', base: '2026-09-10', styleIdx: 2, dealerPerSku: 25, storePerSku: 12, manualPerSku: 10 },
  ];
  for (let r = 0; r < rounds.length; r++) {
    const rd = rounds[r];
    const style = M.styles[rd.styleIdx];
    const numSkus = style.skus.length;
    const RR = { name: rd.name, steps: {}, tradeShowId: null, styleId: style.id };
    const date = rd.base;

    // 1. 订货会 + 预订单（1 经销商 + 3 门店）
    await step(RR.steps, 'tradeShow.create', async () => {
      const t = await tradeShow.create({ name: rd.name, year: '2026', season: rd.season, startDate: date, endDate: date, remark: '模拟订货会' }, 'SYS-SIM');
      RR.tradeShowId = t.id; return { id: t.id, no: t.showNo };
    });
    await step(RR.steps, 'tradeShow.start', async () => { await tradeShow.start(RR.tradeShowId, 'SYS-SIM'); return 'started'; });
    await step(RR.steps, 'preOrder(dealer)+submit+confirm', async () => {
      const items = style.skus.map(sk => ({ skuId: sk.id, skuCode: sk.skuCode, color: sk.color, size: sk.size, qty: rd.dealerPerSku }));
      const po = await preOrder.create({ tradeShowId: RR.tradeShowId, submitterType: 'dealer', dealerId: M.dealer, styleId: style.id, items }, 'SYS-SIM');
      await preOrder.submit(po.id, 'SYS-SIM');
      await preOrder.confirm(po.id, 'SYS-SIM');
      return { preOrderNo: po.preOrderNo, totalQty: items.reduce((a, x) => a + x.qty, 0) };
    });
    await step(RR.steps, 'preOrder(3 stores)+submit+confirm', async () => {
      let total = 0;
      for (const st of M.stores) {
        const items = style.skus.map(sk => ({ skuId: sk.id, skuCode: sk.skuCode, color: sk.color, size: sk.size, qty: rd.storePerSku }));
        const po = await preOrder.create({ tradeShowId: RR.tradeShowId, submitterType: 'direct', storeId: st.id, styleId: style.id, items }, 'SYS-SIM');
        await preOrder.submit(po.id, 'SYS-SIM');
        await preOrder.confirm(po.id, 'SYS-SIM');
        total += items.reduce((a, x) => a + x.qty, 0);
      }
      return { storePreOrders: M.stores.length, totalQty: total };
    });

    // 2. 生产备货（先有货，再配货）：MRP -> 原料采购+入库 -> 工单+发料+完工入库
    const allocatedTotal = numSkus * (rd.dealerPerSku + 3 * rd.storePerSku);
    const produceQty = allocatedTotal + numSkus * rd.manualPerSku; // 多备 manualPerSku/款 用于手动批发
    RR.totalQty = allocatedTotal;
    await step(RR.steps, 'mrp.calc', async () => {
      const res = await mrp.calculate({ styleId: style.id, quantity: produceQty });
      RR.mrp = res.items.map(it => ({ materialId: it.materialId, net: it.netDemand, sug: it.suggestedPurchaseQty }));
      return { items: res.items.length, totalSug: res.items.reduce((a, x) => a + x.suggestedPurchaseQty, 0) };
    });
    await step(RR.steps, 'materialPurchaseOrder.create+submit+approve', async () => {
      const items = RR.mrp.map(it => ({ materialId: it.materialId, quantity: it.sug, price: 20 }));
      const o = await materialPurchaseOrder.create({ supplierId: M.fabricSup, orderDate: date, items }, 'SYS-SIM');
      await materialPurchaseOrder.submit(o.id, 'SYS-SIM');
      await materialPurchaseOrder.approve(o.id);
      RR.matPoId = o.id; return { orderNo: o.orderNo };
    });
    await step(RR.steps, 'materialPurchaseInbound.create+approve', async () => {
      const poItems = await db.select().from(schema.materialPurchaseOrderItem).where(eq(schema.materialPurchaseOrderItem.orderId, RR.matPoId));
      const items = poItems.map(it => ({ orderItemId: it.id, quantity: Number(it.quantity), batchNo: 'B' + rd.season }));
      const ib = await materialPurchaseInbound.create({ orderId: RR.matPoId, warehouseId: M.whMain, inboundDate: date, items }, 'SYS-SIM');
      await materialPurchaseInbound.approve(ib.id);
      return { inboundNo: ib.inboundNo };
    });
    await step(RR.steps, 'workOrder.create+approve', async () => {
      const wo = await workOrder.create({ styleId: style.id, quantity: produceQty, supplierId: M.factory, planStartDate: date, planFinishDate: date, remark: '自产工单' });
      await workOrder.approve(wo.id, ctx);
      RR.woId = wo.id; return { workNo: wo.workNo };
    });
    await step(RR.steps, 'materialIssue.create+approve', async () => {
      const items = RR.mrp.map(it => ({ materialId: it.materialId, planQty: it.net, actualQty: it.net }));
      const mi = await materialIssue.create({ workOrderId: RR.woId, warehouseId: M.whMain, issueDate: date, items }, 'SYS-SIM');
      await materialIssue.approve(mi.id, ctx);
      return { issueNo: mi.issueNo };
    });
    await step(RR.steps, 'finishReceipt.create+approve', async () => {
      const dist = distribute(produceQty, style.skus.length);
      const items = style.skus.map((sk, i) => ({ skuId: sk.id, qty: dist[i] }));
      const fr = await finishReceipt.create({ workOrderId: RR.woId, warehouseId: M.whMain, receiptDate: date, finishedQty: produceQty, defectiveQty: 0, items }, 'SYS-SIM');
      await finishReceipt.approve(fr.id, ctx);
      RR.frId = fr.id; return { receiptNo: fr.receiptNo };
    });

    // 3. 批发销售出库（手动，从总仓发给批发客户，消耗 manualPerSku 缓冲）
    await step(RR.steps, 'salesOrder+outbound(manual wholesale)', async () => {
      const items = [];
      for (const sk of style.skus) {
        const avail = await skuStockAt(M.whMain, sk.id);
        const q = Math.min(rd.manualPerSku, avail);
        if (q > 0) items.push({ skuId: sk.id, quantity: q, price: 120 });
      }
      if (!items.length) return { skipped: true };
      const so = await salesOrder.create({ customerId: M.cust, customerName: '华南连锁批发', orderDate: date, items }, 'SYS-SIM');
      await salesOrder.audit(so.id);
      await salesOrder.book(so.id);
      const soItems = await db.select().from(schema.salesOrderItem).where(eq(schema.salesOrderItem.orderId, so.id));
      const ob = await salesOutbound.create({ orderId: so.id, warehouseId: M.whMain, outboundDate: date, items: soItems.map(it => ({ orderItemId: it.id, quantity: Number(it.quantity) })) }, 'SYS-SIM');
      await salesOutbound.audit(ob.id);
      await salesOutbound.book(ob.id);
      return { orderNo: so.orderNo, outboundNo: ob.outboundNo };
    });

    // 4. 配货（聚合 经销商+门店 预订单；审核后自动生成 经销商销售单/应收 + 门店调拨单）
    await step(RR.steps, 'allocation.create+update+approve', async () => {
      const a = await allocation.create({ tradeShowId: RR.tradeShowId, styleId: style.id, totalArrivedQty: allocatedTotal, remark: '按订货量配货' }, 'SYS-SIM');
      const updItems = (a.items || []).map(it => ({ id: it.id, allocatedQty: Number(it.preQty || it.allocatedQty || 0) }));
      await allocation.update(a.id, { items: updItems }, 'SYS-SIM');
      await allocation.approve(a.id, 'SYS-SIM');
      RR.allocNo = a.allocationNo;
      return { allocId: a.id, allocNo: a.allocationNo };
    });

    // 5. 门店调拨收货（配货自动生成的调拨单已是 in_transit，只需收货 → 实际入库）
    RR.transfers = [];
    await step(RR.steps, 'transfer.receive(allocation-generated)', async () => {
      const trs = await db.select().from(schema.inventoryTransfer).where(sql`${schema.inventoryTransfer.remark} like ${'%' + RR.allocNo + '%'}`);
      for (const tr of trs) {
        await transfer.receiveTransfer(tr.id, 'SYS-SIM');
        RR.transfers.push(tr.transferNo);
      }
      return { count: trs.length };
    });

    // 6. 门店零售（含会员积分）
    RR.retails = [];
    for (let si = 0; si < M.stores.length; si++) {
      const st = M.stores[si];
      const items = [];
      let amount = 0;
      for (const sk of style.skus) {
        const avail = await skuStockAt(st.whId, sk.id);
        const q = Math.min(2, avail);
        if (q > 0) { items.push({ skuId: sk.id, quantity: q, dealPrice: 199 }); amount += q * 199; }
      }
      if (!items.length) continue;
      await step(RR.steps, 'retail@' + st.code, async () => {
        const memberId = M.members[si % M.members.length];
        const ro = await retail.createDraftRetail({ storeId: st.id, saleDate: date, memberId, source: 'pos', items }, 'SYS-SIM');
        const settled = await retail.settleRetailOrder(ro.id, { payMethods: [{ method: 'cash', amount: String(amount) }], receivedAmount: amount, wholeDiscount: 1 }, 'SYS-SIM');
        RR.retails.push(ro.id);
        return { retailNo: ro.retailNo, amount, memberId };
      });
    }

    // 7. 零售退货（首个零售单退 1 件）
    if (RR.retails.length) {
      await step(RR.steps, 'retailReturn', async () => {
        const ro = await retail.getRetailOrderDetail(RR.retails[0]);
        const it = ro.items[0];
        const ret = await retail.createReturn({ originalRetailId: RR.retails[0], items: [{ retailItemId: it.id, quantity: 1 }] }, 'SYS-SIM');
        await retail.refundReturn(ret.id, 'SYS-SIM');
        return { returnNo: ret.returnNo };
      });
    }

    // 8. 成衣采购（第3轮，外部工厂直接采买，丰富链路）
    if (r === 2) {
      await step(RR.steps, 'garmentPurchase.create+approve+inbound', async () => {
        const skus = style.skus.map(sk => ({ styleId: style.id, styleNo: style.no, skuId: sk.id, color: sk.color, size: sk.size, quantity: 30, price: 80 }));
        const go = await garmentOrder.create({ supplierId: M.factory, supplierName: '晨光服装加工厂', orderDate: date, skus }, 'SYS-SIM');
        await garmentOrder.submit(go.id, 'SYS-SIM');
        await garmentOrder.approve(go.id);
        const gSkus = await db.select().from(schema.garmentPurchaseOrderSku).where(eq(schema.garmentPurchaseOrderSku.orderId, go.id));
        const ib = await garmentInbound.create({ orderId: go.id, warehouseId: M.whMain, warehouseName: '中央总仓', inboundDate: date, skus: gSkus.map(gs => ({ orderSkuId: gs.id, styleId: gs.styleId, styleNo: gs.styleNo, skuId: gs.skuId, color: gs.color, size: gs.size, quantity: Number(gs.quantity), price: Number(gs.price) })) }, 'SYS-SIM');
        await garmentInbound.approve(ib.id);
        RR.garmentInboundNo = ib.inboundNo; return { inboundNo: ib.inboundNo };
      });
    }

    R.rounds.push(RR);
  }

  // ===== 财务：应付/应收核销 =====
  await step(R.finance, 'payable.list', async () => (await payable.list({})).items.length);
  await step(R.finance, 'payPayment', async () => {
    const list = (await payable.list({})).items;
    if (!list.length) return { skipped: 'no payable' };
    const p = list[0];
    const amt = Math.min(Number(p.amount || 0), 1000);
    const pay = await payment.create({ paymentDate: '2026-09-20', supplierId: p.supplierId, supplierName: p.supplierName, amount: amt, paymentMethod: 'bank', remark: '模拟付款', writeoffs: [{ payableId: p.id, payableNo: p.payableNo, writeoffAmount: amt }] }, 'SYS-SIM');
    await payment.approve(pay.id, 'SYS-SIM');
    return { paymentNo: pay.paymentNo, amt };
  });
  await step(R.finance, 'receivable.list', async () => (await receivable.list({})).items.length);
  await step(R.finance, 'receipt', async () => {
    const list = (await receivable.list({})).items;
    if (!list.length) return { skipped: 'no receivable' };
    const rc = list[0];
    const amt = Math.min(Number(rc.amount || 0), 1000);
    const rec = await receipt.create({ receiptDate: '2026-09-20', customerId: rc.customerId, customerName: rc.customerName, amount: amt, paymentMethod: 'bank', remark: '模拟收款', writeoffs: [{ receivableId: rc.id, receivableNo: rc.receivableNo, writeoffAmount: amt }] }, 'SYS-SIM');
    await receipt.approve(rec.id, 'SYS-SIM');
    return { receiptNo: rec.receiptNo, amt };
  });

  // ===== 经营分析 + 零售报表 =====
  const sampleSku = M.styles[0].skus[0].id;
  await step(R.analytics, 'forecast', async () => { const f = await analytics.forecast(sampleSku); return { months: f.forecast?.length ?? 0 }; });
  await step(R.analytics, 'bi', async () => { const b = await analytics.bi('style', 'amount', '2026-01-01', '2026-12-31'); return { rows: b?.rows?.length ?? 0 }; });
  await step(R.analytics, 'lifecycleList', async () => (await analytics.lifecycleList())?.length ?? 0);
  await step(R.analytics, 'mobileDashboard', async () => Object.keys(await analytics.mobileDashboard()).length);
  await step(R.analytics, 'retailReport', async () => { const d = await retailReport.getReport({ startDate: '2026-01-01', endDate: '2026-12-31' }); return { keys: Object.keys(d || {}).length }; });

  // ===== 库存盘点（抽查一款）=====
  await step(R.analytics, 'stocktake', async () => {
    const st = M.stores[0];
    const sk = M.styles[0].skus[0];
    const book = await skuStockAt(st.whId, sk.id);
    const skt = require('./dist/server/modules/inventory/stocktake/inventory-stocktake.service');
    const svc = assignDb(new skt.InventoryStocktakeService(db, monthClose, stock, ng));
    const created = await svc.createStocktake({ warehouseId: st.whId, stocktakeDate: '2026-09-25', itemType: 'sku', items: [{ skuId: sk.id, itemCode: sk.skuCode, itemName: M.styles[0].name, color: sk.color, size: sk.size, bookQty: book, actualQty: book }] }, 'SYS-SIM');
    await svc.approveStocktake(created.id, 'SYS-SIM');
    return { stocktakeNo: created.stocktakeNo };
  });

  // ===== 月结（插入 2026-09 月记录再关账）=====
  await step(R.monthClose, 'close', async () => {
    const [mc] = await db.insert(schema.monthClose).values({ id: uid(), month: '2026-09', status: 'open', openingQty: '0', openingAmount: '0', inboundQty: '0', inboundAmount: '0', outboundQty: '0', outboundAmount: '0', closingQty: '0', closingAmount: '0' }).returning();
    const closed = await monthClose.close(mc.id, 'SYS-SIM');
    return { month: closed.month, status: closed.status };
  });

  // ===== 数据规模快照 =====
  const snap = await client.unsafe(`SELECT
    (SELECT count(*) FROM style) styles,
    (SELECT count(*) FROM sku) skus,
    (SELECT count(*) FROM trade_show) trade_shows,
    (SELECT count(*) FROM pre_order) pre_orders,
    (SELECT count(*) FROM allocation_order) allocations,
    (SELECT count(*) FROM production_work_order) work_orders,
    (SELECT count(*) FROM material_purchase_order) mat_pos,
    (SELECT count(*) FROM material_purchase_inbound) mat_inbounds,
    (SELECT count(*) FROM production_finish_receipt) finish_receipts,
    (SELECT count(*) FROM inventory_transfer) transfers,
    (SELECT count(*) FROM retail_order) retail_orders,
    (SELECT count(*) FROM sales_order) sales_orders,
    (SELECT count(*) FROM sales_outbound) sales_outbounds,
    (SELECT count(*) FROM garment_purchase_order) garment_pos,
    (SELECT count(*) FROM payable) payables,
    (SELECT count(*) FROM receivable) receivables,
    (SELECT count(*) FROM finance_payment) payments,
    (SELECT count(*) FROM finance_receipt) receipts,
    (SELECT count(*) FROM inventory_stock) stock_rows,
    (SELECT sum(quantity::numeric) FROM inventory_stock) total_stock_qty,
    (SELECT count(*) FROM member_point) member_points,
    (SELECT sum(points) FROM member) total_member_points
  `);
  R.snapshot = snap[0];

  const fs = require('fs');
  fs.writeFileSync('/tmp/sim-result.json', JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  await client.end();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
