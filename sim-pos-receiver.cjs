/**
 * POS 上行接收端（ERP）黑盒验证：直构 PosReceiverService，模拟云裁POS 推送 5 类单据，
 * 断言 ERP 侧正确落库 + 幂等。运行：node sim-pos-receiver.cjs（需 dev PG@5434）
 */
const { randomUUID } = require('crypto');
const postgres = require('postgres');
const { eq, and, count, sql } = require('drizzle-orm');
const { PosReceiverService } = require('./dist/server/modules/pos-receiver/pos-receiver.service.js');
const S = require('./dist/server/database/schema.js');
const { drizzle } = require('drizzle-orm/postgres-js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function main() {
  const ts = Date.now();
  const wh = randomUUID();
  const storeId = randomUUID();
  const STORE_CODE = 'ST' + ts;      // ERP store.code
  const POS_CODE = 'POS' + ts;       // POS storeCode（经映射）
  const STORE_NAME = '落库验证门店' + ts;

  // ---- 种子：仓库 + 门店（带 warehouseId）+ 映射 + SKU 主数据 ----
  const CG = randomUUID(), SG = randomUUID(), STY = randomUUID();
  await db.insert(S.colorGroup).values({ id: CG, code: 'CG' + ts, name: '色组' });
  await db.insert(S.sizeGroup).values({ id: SG, code: 'SG' + ts, name: '尺组' });
  await db.insert(S.style).values({ id: STY, styleNo: 'STYLE' + ts, name: '测试款', colorGroupId: CG, sizeGroupId: SG });
  await db.insert(S.warehouse).values({ id: wh, code: 'WH' + ts, name: '落库仓', type: 'store', status: 'active' });
  await db.insert(S.store).values({ id: storeId, code: STORE_CODE, name: STORE_NAME, warehouseId: wh, status: 'active' });
  await db.insert(S.posStoreMap).values({ storeCode: POS_CODE, storeId, storeName: STORE_NAME });
  const skuDim = { ['SKU-A-' + ts]: ['红', 'M'], ['SKU-B-' + ts]: ['蓝', 'L'], ['SKU-C-' + ts]: ['黑', 'XL'] };
  for (const code of Object.keys(skuDim)) {
    await db.insert(S.sku).values({
      id: randomUUID(), skuCode: code, styleId: STY, styleNo: 'STYLE' + ts,
      color: skuDim[code][0], size: skuDim[code][1], barcode: 'BC' + code,
    });
  }
  const SKU_A = 'SKU-A-' + ts, SKU_B = 'SKU-B-' + ts, SKU_C = 'SKU-C-' + ts;

  const svc = new PosReceiverService(db);

  // ============ ① 销售 → retailOrder ============
  console.log('【1】销售单接收 → retailOrder');
  const saleRes = await svc.receiveSales({
    storeCode: POS_CODE, orderNo: 'PO-' + ts + '-1', saleDate: '2026-09-23',
    cashierName: '小王', memberId: 'M001',
    totalAmount: 580, discountAmount: 80, receivableAmount: 500, receivedAmount: 500, changeAmount: 0,
    payMethods: [{ method: 'wechat', amount: 500 }],
    items: [
      { skuCode: SKU_A, styleNo: 'ST-A', color: '红', size: 'M', quantity: 1, tagPrice: 300, dealPrice: 250, lineAmount: 250 },
      { skuCode: SKU_B, styleNo: 'ST-B', color: '蓝', size: 'L', quantity: 2, tagPrice: 165, dealPrice: 165, lineAmount: 330 },
    ],
  });
  assert('销售返回 success', saleRes.success === true, saleRes);
  assert('销售返回 ERP 单号 RT 前缀', /^RT\d{8}\d{5}$/.test(saleRes.erpNo || ''), saleRes.erpNo);
  const ro = await db.select().from(S.retailOrder).where(eq(S.retailOrder.retailNo, saleRes.erpNo)).limit(1);
  assert('retailOrder 落库 1 行', ro.length === 1);
  assert('storeId 正确解析为 ERP store.id', ro[0] && ro[0].storeId === storeId, ro[0]?.storeId);
  assert('source=store_pos（落 CHECK 白名单）', ro[0] && ro[0].source === 'store_pos', ro[0]?.source);
  assert('status=completed（落 CHECK 白名单）', ro[0] && ro[0].status === 'completed', ro[0]?.status);
  assert('itemCount=2', ro[0] && ro[0].itemCount === 2, ro[0]?.itemCount);
  const roItems = await db.select().from(S.retailOrderItem).where(eq(S.retailOrderItem.retailId, ro[0].id));
  assert('retailOrderItem 落库 2 行', roItems.length === 2, roItems.length);

  // ============ ② 幂等：同单号重推 ============
  console.log('【2】销售单幂等重推');
  const saleRes2 = await svc.receiveSales({
    storeCode: POS_CODE, orderNo: 'PO-' + ts + '-1', saleDate: '2026-09-23',
    totalAmount: 999, items: [{ skuCode: 'SKU-Z', quantity: 1 }],
  });
  assert('重推 duplicated=true', saleRes2.duplicated === true, saleRes2);
  assert('重推返回相同 erpNo', saleRes2.erpNo === saleRes.erpNo, saleRes2.erpNo);
  const roCnt = (await db.select({ c: count() }).from(S.retailOrder).where(eq(S.retailOrder.retailNo, saleRes.erpNo)))[0].c;
  assert('重推未产生重复 retailOrder', roCnt === 1, roCnt);

  // ============ ③ 盘点 → inventoryStocktake ============
  console.log('【3】盘点单接收 → inventoryStocktake');
  const stkRes = await svc.receiveStocktake({
    storeCode: POS_CODE, stocktakeNo: 'STK-' + ts, stocktakeDate: '2026-09-23',
    items: [
      { skuCode: SKU_A, skuName: 'A款', bookQty: 10, actualQty: 8 },   // diff=-2
      { skuCode: SKU_B, skuName: 'B款', bookQty: 5, actualQty: 5 },     // diff=0
    ],
  });
  assert('盘点返回 ERP 单号 STK 前缀', /^STK\d{8}\d{5}$/.test(stkRes.erpNo || ''), stkRes.erpNo);
  const stk = await db.select().from(S.inventoryStocktake).where(eq(S.inventoryStocktake.stocktakeNo, stkRes.erpNo)).limit(1);
  assert('inventoryStocktake 落库', stk.length === 1);
  assert('warehouseId 由 store→warehouse 解析', stk[0] && stk[0].warehouseId === wh, stk[0]?.warehouseId);
  assert('itemType=sku（落 CHECK 白名单）', stk[0] && stk[0].itemType === 'sku', stk[0]?.itemType);
  const stkItems = await db.select().from(S.inventoryStocktakeItem).where(eq(S.inventoryStocktakeItem.stocktakeId, stk[0].id));
  assert('盘点明细 2 行', stkItems.length === 2, stkItems.length);
  assert('差异量计算正确 (-2)', stkItems[0] && stkItems[0].diffQty === '-2', stkItems[0]?.diffQty);

  // ============ ④ 退货 → pos_return ============
  console.log('【4】退货单接收 → pos_return（解耦落地表）');
  const retRes = await svc.receiveReturns({
    storeCode: POS_CODE, returnNo: 'RET-' + ts, posOrderNo: 'PO-' + ts + '-1', returnDate: '2026-09-23',
    totalAmount: 250, reason: '尺码不符',
    items: [{ skuCode: SKU_A, styleNo: 'ST-A', color: '红', size: 'M', quantity: 1, price: 250, amount: 250, batchNo: 'B1' }],
  });
  assert('退货返回 ERP 单号 PR 前缀', /^PR\d{8}\d{5}$/.test(retRes.erpNo || ''), retRes.erpNo);
  const ret = await db.select().from(S.posReturn).where(eq(S.posReturn.returnNo, retRes.erpNo)).limit(1);
  assert('pos_return 落库', ret.length === 1);
  assert('pos_return.storeId 解析正确', ret[0] && ret[0].storeId === storeId, ret[0]?.storeId);
  const retItems = await db.select().from(S.posReturnItem).where(eq(S.posReturnItem.returnId, ret[0].id));
  assert('pos_return_item 1 行', retItems.length === 1, retItems.length);

  // ============ ⑤ 要货 → pos_requisition ============
  console.log('【5】要货申请接收 → pos_requisition');
  const reqRes = await svc.receiveTransferRequest({
    storeCode: POS_CODE, reqNo: 'REQ-' + ts, reqDate: '2026-09-23',
    items: [{ skuCode: SKU_C, styleNo: 'ST-C', color: '黑', size: 'XL', qty: 20 }],
  });
  assert('要货返回 ERP 单号 PRQ 前缀', /^PRQ\d{8}\d{5}$/.test(reqRes.erpNo || ''), reqRes.erpNo);
  const req = await db.select().from(S.posRequisition).where(eq(S.posRequisition.reqNo, reqRes.erpNo)).limit(1);
  assert('pos_requisition 落库', req.length === 1);
  const reqItems = await db.select().from(S.posRequisitionItem).where(eq(S.posRequisitionItem.requisitionId, req[0].id));
  assert('pos_requisition_item 1 行', reqItems.length === 1, reqItems.length);

  // ============ ⑥ 日结 → pos_daily_settle ============
  console.log('【6】日结单接收 → pos_daily_settle');
  const eodRes = await svc.receiveEod({
    storeCode: POS_CODE, eodNo: 'EOD-' + ts, settleDate: '2026-09-23', sessionId: 'S-1', cashierName: '小王',
    cashAmount: 300, cardAmount: 100, wechatAmount: 80, alipayAmount: 20, otherAmount: 0,
    totalAmount: 500, depositAmount: 500, diffAmount: 0,
  });
  assert('日结返回 ERP 单号 PDS 前缀', /^PDS\d{8}\d{5}$/.test(eodRes.erpNo || ''), eodRes.erpNo);
  const eod = await db.select().from(S.posDailySettle).where(eq(S.posDailySettle.settleNo, eodRes.erpNo)).limit(1);
  assert('pos_daily_settle 落库', eod.length === 1);
  assert('日结金额聚合正确 total=500', eod[0] && Number(eod[0].totalAmount) === 500, eod[0]?.totalAmount);

  // ============ ⑦ 门店解析回退：store.code 直匹配（无映射） ============
  console.log('【7】门店解析回退（store.code 直匹配）');
  const fbStore = randomUUID(); const FB_CODE = 'FB' + ts;
  await db.insert(S.store).values({ id: fbStore, code: FB_CODE, name: '回退门店', warehouseId: wh, status: 'active' });
  const fbRes = await svc.receiveEod({
    storeCode: FB_CODE, eodNo: 'EODFB-' + ts, settleDate: '2026-09-23', totalAmount: 10,
  });
  assert('无映射时回退 store.code 命中', fbRes.success === true, fbRes);
  const fbEod = await db.select().from(S.posDailySettle).where(eq(S.posDailySettle.settleNo, fbRes.erpNo)).limit(1);
  assert('回退门店 storeId 正确', fbEod[0] && fbEod[0].storeId === fbStore, fbEod[0]?.storeId);

  // ============ ⑧ 幂等日志覆盖 ============
  console.log('【8】pos_receive_log 幂等记录');
  const logCnt = (await db.select({ c: count() }).from(S.posReceiveLog)
    .where(and(eq(S.posReceiveLog.bizType, 'sales'), eq(S.posReceiveLog.posDocNo, 'PO-' + ts + '-1'))))[0].c;
  assert('同单号仅 1 条幂等日志', logCnt === 1, logCnt);

  // ============ 清理 ============
  console.log('【cleanup】清理测试数据');
  await db.delete(S.posDailySettle).where(sql`store_id IN (${storeId}, ${fbStore})`);
  await db.delete(S.posRequisitionItem).where(sql`requisition_id IN (select id from pos_requisition where store_id IN (${storeId}, ${fbStore}))`);
  await db.delete(S.posRequisition).where(sql`store_id IN (${storeId}, ${fbStore})`);
  await db.delete(S.posReturnItem).where(sql`return_id IN (select id from pos_return where store_id IN (${storeId}, ${fbStore}))`);
  await db.delete(S.posReturn).where(sql`store_id IN (${storeId}, ${fbStore})`);
  await db.delete(S.retailOrderItem).where(sql`retail_id IN (select id from retail_order where store_id = ${storeId})`);
  await db.delete(S.retailOrder).where(eq(S.retailOrder.storeId, storeId));
  await db.delete(S.inventoryStocktakeItem).where(sql`stocktake_id IN (select id from inventory_stocktake where warehouse_id = ${wh})`);
  await db.delete(S.inventoryStocktake).where(eq(S.inventoryStocktake.warehouseId, wh));
  await db.delete(S.posStoreMap).where(eq(S.posStoreMap.storeCode, POS_CODE));
  await db.delete(S.store).where(sql`id IN (${storeId}, ${fbStore})`);
  await db.delete(S.warehouse).where(eq(S.warehouse.id, wh));
  await db.delete(S.sku).where(eq(S.sku.styleId, STY));
  await db.delete(S.style).where(eq(S.style.id, STY));
  await db.delete(S.colorGroup).where(eq(S.colorGroup.id, CG));
  await db.delete(S.sizeGroup).where(eq(S.sizeGroup.id, SG));
  await db.delete(S.posReceiveLog).where(eq(S.posReceiveLog.posDocNo, 'PO-' + ts + '-1'));
  await db.delete(S.posReceiveLog).where(eq(S.posReceiveLog.posDocNo, 'STK-' + ts));
  await db.delete(S.posReceiveLog).where(eq(S.posReceiveLog.posDocNo, 'RET-' + ts));
  await db.delete(S.posReceiveLog).where(eq(S.posReceiveLog.posDocNo, 'REQ-' + ts));
  await db.delete(S.posReceiveLog).where(eq(S.posReceiveLog.posDocNo, 'EOD-' + ts));
  await db.delete(S.posReceiveLog).where(eq(S.posReceiveLog.posDocNo, 'EODFB-' + ts));

  console.log(`\n========== 结果: pass=${pass} fail=${fail} ==========`);
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('SIM ERROR:', e);
  await client.end();
  process.exit(1);
});
