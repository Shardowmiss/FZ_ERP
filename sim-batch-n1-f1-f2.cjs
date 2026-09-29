/**
 * N+1 消除第二批回归：验证 F1（移动盘点 submit 批量预取+多值 upsert）与
 * F2（配货审核 approve 批量：deliveredQty CASE / 调出 batchChangeStock /
 * 在途 bulkUpsert / 流水批量 INSERT / allocation_item CASE）。
 *
 * 直构 service（依赖用真实/桩对象），drizzle 参数化 seed 外键链，真实落地后断言。
 * 运行：node sim-batch-n1-f1-f2.cjs   （需 dev/postgres 在 localhost:5434）
 */
const { randomUUID } = require('crypto');
const postgres = require('postgres');
const { eq, and, inArray, sql } = require('drizzle-orm');
const { InventoryMobileService } = require('./dist/server/modules/inventory/mobile/inventory-mobile.service.js');
const { AllocationService } = require('./dist/server/modules/trade-show/allocation.service.js');
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service.js');
const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service.js');
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
  // ===================== F1：移动盘点 submit =====================
  console.log('【F1】InventoryMobileService.submit 批量预取 + 多值 upsert');
  const ts = Date.now();
  const CG = randomUUID(), SG = randomUUID(), ST = randomUUID();
  const whP = randomUUID();
  const s1 = randomUUID(), s2 = randomUUID(), s3 = randomUUID(), s4 = randomUUID();
  await db.insert(S.colorGroup).values({ id: CG, code: 'CG_' + ts, name: '色组' });
  await db.insert(S.sizeGroup).values({ id: SG, code: 'SG_' + ts, name: '尺组' });
  await db.insert(S.style).values({ id: ST, styleNo: 'ST_' + ts, name: '款', colorGroupId: CG, sizeGroupId: SG });
  await db.insert(S.warehouse).values({ id: whP, code: 'WHP_' + ts, name: '盘测仓', type: 'main', status: 'active' });
  await db.insert(S.sku).values([
    { id: s1, skuCode: 'F1_' + ts + '_1', styleId: ST, styleNo: 'ST_' + ts, color: 'C1', size: 'S1', barcode: 'BC' + ts + '1' },
    { id: s2, skuCode: 'F1_' + ts + '_2', styleId: ST, styleNo: 'ST_' + ts, color: 'C2', size: 'S2', barcode: 'BC' + ts + '2' },
    { id: s3, skuCode: 'F1_' + ts + '_3', styleId: ST, styleNo: 'ST_' + ts, color: 'C3', size: 'S3', barcode: 'BC' + ts + '3' },
    { id: s4, skuCode: 'F1_' + ts + '_4', styleId: ST, styleNo: 'ST_' + ts, color: 'C4', size: 'S4', barcode: 'BC' + ts + '4' },
  ]);
  // 预置一条已存在的批次库存（sku1/B1），用于验证 upsert 覆盖（quantity 由 5 → 最终值）
  await db.insert(S.inventoryStock).values({ skuId: s1, skuCode: 'F1_' + ts + '_1', styleNo: 'ST_' + ts, color: 'C1', size: 'S1', warehouseId: whP, warehouseName: '盘测仓', quantity: '20' });
  await db.insert(S.inventoryBatch).values({ skuId: s1, skuCode: 'F1_' + ts + '_1', styleNo: 'ST_' + ts, color: 'C1', size: 'S1', warehouseId: whP, warehouseName: '盘测仓', batchNo: 'B1', quantity: '5', status: 'active' });

  const mobile = new InventoryMobileService(db, new NumberGeneratorService());
  await mobile.submit({
    warehouseId: whP,
    stocktakeDate: '2026-09-23',
    items: [
      { barcode: 'BC' + ts + '1', actualQty: 10, batchNo: 'B1' }, // 已有批次 → upsert 覆盖=10
      { barcode: 'BC' + ts + '2', actualQty: 7, batchNo: 'B2' },  // 新批次 → 插入=7
      { barcode: 'BC' + ts + '3', actualQty: 3, batchNo: 'B3' },  // 新批次 → 插入=3
      { barcode: 'BC' + ts + '4', actualQty: 5, batchNo: 'B4' },  // 新批次 → 插入=5
      { barcode: 'BC' + ts + '1', actualQty: 4, batchNo: 'B1' },  // 与第1项同 (sku,wh,batch) → 同键合并，末值=4
    ],
  });

  const stRows = await db.select().from(S.inventoryStocktake).where(eq(S.inventoryStocktake.warehouseId, whP));
  assert('生成 1 张盘点单', stRows.length === 1, { len: stRows.length });
  const stId = stRows[0].id;
  const itemRows = await db.select().from(S.inventoryStocktakeItem).where(eq(S.inventoryStocktakeItem.stocktakeId, stId));
  assert('盘点明细 = 5 行', itemRows.length === 5, { len: itemRows.length });
  const batchRows = await db.select().from(S.inventoryBatch).where(and(eq(S.inventoryBatch.warehouseId, whP), inArray(S.inventoryBatch.batchNo, ['B1', 'B2', 'B3', 'B4'])));
  assert('批次库存 distinct = 4 行（同键合并未重复插入）', batchRows.length === 4, { len: batchRows.length });
  const b1 = batchRows.find((r) => r.batchNo === 'B1');
  assert('B1 批次 quantity = 4（同键末值覆盖，非 10）', Number(b1.quantity) === 4, Number(b1 && b1.quantity));
  const b2 = batchRows.find((r) => r.batchNo === 'B2');
  assert('B2 批次 quantity = 7（新增）', Number(b2.quantity) === 7, Number(b2 && b2.quantity));

  // 清理 F1
  await db.delete(S.inventoryStocktakeItem).where(eq(S.inventoryStocktakeItem.stocktakeId, stId));
  await db.delete(S.inventoryStocktake).where(eq(S.inventoryStocktake.id, stId));
  await db.delete(S.inventoryBatch).where(eq(S.inventoryBatch.warehouseId, whP));
  await db.delete(S.inventoryStock).where(eq(S.inventoryStock.warehouseId, whP));
  await db.delete(S.sku).where(inArray(S.sku.id, [s1, s2, s3, s4]));
  await db.delete(S.warehouse).where(eq(S.warehouse.id, whP));
  await db.delete(S.style).where(eq(S.style.id, ST));
  await db.delete(S.colorGroup).where(eq(S.colorGroup.id, CG));
  await db.delete(S.sizeGroup).where(eq(S.sizeGroup.id, SG));

  // ===================== F2：配货审核 approve =====================
  console.log('【F2】AllocationService.approve 批量（dealer 分支 + store 分支）');
  const ts2 = Date.now();
  const CG2 = randomUUID(), SG2 = randomUUID(), ST2 = randomUUID();
  const storeWh = randomUUID(), storeId = randomUUID(), dealerId = randomUUID();
  const skuD = randomUUID(), skuS = randomUUID();
  const showId = randomUUID(), allocId = randomUUID();
  const allocItemD = randomUUID(), allocItemS = randomUUID();
  await db.insert(S.colorGroup).values({ id: CG2, code: 'CG2_' + ts2, name: '色组' });
  await db.insert(S.sizeGroup).values({ id: SG2, code: 'SG2_' + ts2, name: '尺组' });
  await db.insert(S.style).values({ id: ST2, styleNo: 'ST2_' + ts2, name: '款2', colorGroupId: CG2, sizeGroupId: SG2 });
  await db.insert(S.warehouse).values({ id: storeWh, code: 'SW_' + ts2, name: '门店仓', type: 'main', status: 'active' });
  await db.insert(S.store).values({ id: storeId, code: 'STO_' + ts2, name: '直营店', warehouseId: storeWh, status: 'active' });
  await db.insert(S.dealer).values({ id: dealerId, code: 'DL_' + ts2, name: '经销商', status: 'active' });
  await db.insert(S.sku).values([
    { id: skuD, skuCode: 'FD_' + ts2, styleId: ST2, styleNo: 'ST2_' + ts2, color: 'X', size: 'Y' },
    { id: skuS, skuCode: 'FS_' + ts2, styleId: ST2, styleNo: 'ST2_' + ts2, color: 'X', size: 'Z' },
  ]);
  // 复用 approve 的同一查询抓取总部成品仓（dev 库已有多个 finished/active 仓，避免新建与之冲突）
  const hqRow = await db.select().from(S.warehouse).where(and(eq(S.warehouse.type, 'finished'), eq(S.warehouse.status, 'active'))).limit(1);
  const hq = hqRow[0].id;
  // 总部成品仓预置充足库存（dealer 扣 5 + store 扣 3）；先清残留，保证幂等
  await db.delete(S.inventoryStock).where(and(eq(S.inventoryStock.warehouseId, hq), inArray(S.inventoryStock.skuId, [skuD, skuS])));
  await db.insert(S.inventoryStock).values([
    { skuId: skuD, skuCode: 'FD_' + ts2, styleNo: 'ST2_' + ts2, color: 'X', size: 'Y', warehouseId: hq, warehouseName: '总部成品仓', quantity: '100' },
    { skuId: skuS, skuCode: 'FS_' + ts2, styleNo: 'ST2_' + ts2, color: 'X', size: 'Z', warehouseId: hq, warehouseName: '总部成品仓', quantity: '100' },
  ]);
  await db.insert(S.tradeShow).values({ id: showId, showNo: 'SH_' + ts2, name: '订货会', year: '2026', season: 'SS', status: 'active' });
  await db.insert(S.allocationOrder).values({
    id: allocId, allocationNo: 'AL' + ts2, tradeShowId: showId, tradeShowName: '订货会',
    styleId: ST2, styleNo: 'ST2_' + ts2, styleName: '款2', totalArrivedQty: '50', totalAllocatedQty: '8', status: 'draft',
  });
  await db.insert(S.allocationItem).values([
    { id: allocItemD, allocationId: allocId, preOrderId: null, submitterType: 'dealer', dealerId, dealerName: '经销商', skuId: skuD, skuCode: 'FD_' + ts2, color: 'X', size: 'Y', preQty: '5', allocatedQty: '5' },
    { id: allocItemS, allocationId: allocId, preOrderId: null, submitterType: 'direct', storeId, storeName: '直营店', skuId: skuS, skuCode: 'FS_' + ts2, color: 'X', size: 'Z', preQty: '3', allocatedQty: '3' },
  ]);

  const alloc = new AllocationService(db, new StockService(db), new NumberGeneratorService());
  await alloc.approve(allocId, 'test-user');

  const ao = await db.select().from(S.allocationOrder).where(eq(S.allocationOrder.id, allocId));
  assert('配货单状态 = approved', ao[0].status === 'approved', ao[0].status);

  const so = await db.select().from(S.salesOrder).where(sql`1=1`);
  const soFor = so.filter((r) => r.remark && r.remark.includes('AL' + ts2));
  assert('经销商分支生成销售订单', soFor.length === 1, { len: soFor.length });
  const soOut = await db.select().from(S.salesOutbound).where(sql`1=1`);
  const soOutFor = soOut.filter((r) => r.remark && r.remark.includes('AL' + ts2));
  assert('经销商分支生成销售出库', soOutFor.length === 1, { len: soOutFor.length });
  const obNo = soOutFor[0].outboundNo;
  const recFor = await db.select().from(S.receivable).where(eq(S.receivable.bizNo, obNo));
  assert('经销商分支生成应收单', recFor.length === 1, { len: recFor.length });
  const trAll = await db.select().from(S.inventoryTransfer).where(sql`1=1`);
  const trFor = trAll.filter((r) => r.remark && r.remark.includes('AL' + ts2));
  assert('门店分支生成调拨单', trFor.length === 1, { len: trFor.length });
  const trNo = trFor[0].transferNo;

  // 库存校验
  const hqD = await db.select().from(S.inventoryStock).where(and(eq(S.inventoryStock.skuId, skuD), eq(S.inventoryStock.warehouseId, hq)));
  assert('总部仓 skuD 扣减 5 → 95', hqD.length === 1 && Number(hqD[0].quantity) === 95, Number(hqD[0] && hqD[0].quantity));
  const hqS = await db.select().from(S.inventoryStock).where(and(eq(S.inventoryStock.skuId, skuS), eq(S.inventoryStock.warehouseId, hq)));
  assert('总部仓 skuS 扣减 3 → 97', hqS.length === 1 && Number(hqS[0].quantity) === 97, Number(hqS[0] && hqS[0].quantity));
  const inTransit = await db.select().from(S.inventoryStock).where(and(eq(S.inventoryStock.skuId, skuS), eq(S.inventoryStock.warehouseId, storeWh)));
  assert('门店仓 skuS 在途 +3（新建行 inTransitQty=3）', inTransit.length === 1 && Number(inTransit[0].inTransitQty) === 3, Number(inTransit[0] && inTransit[0].inTransitQty));

  // 流水校验（流水 biz_no 为出库单号/调拨单号，非配货单号）
  // 语义：经销商分支=销售出库（flowType sales_outbound）；门店分支=内部调拨（transfer_out + transfer_in_transit）
  const flow = await db.select().from(S.inventoryFlow).where(sql`1=1`);
  const salesOutCnt = flow.filter((f) => f.flowType === 'sales_outbound' && f.bizNo === obNo).length;
  const transferOutCnt = flow.filter((f) => f.flowType === 'transfer_out' && f.bizNo === trNo).length;
  const inTransitCnt = flow.filter((f) => f.flowType === 'transfer_in_transit' && f.bizNo === trNo).length;
  assert('经销商分支生成销售出库流水 sales_outbound = 1', salesOutCnt === 1, { salesOutCnt });
  assert('门店分支调出流水 transfer_out = 1', transferOutCnt === 1, { transferOutCnt });
  assert('在途调入流水 = 1（store）', inTransitCnt === 1, { inTransitCnt });

  // allocation_item 回写校验
  const aiRows = await db.select().from(S.allocationItem).where(inArray(S.allocationItem.id, [allocItemD, allocItemS]));
  const aiMap = {}; aiRows.forEach((r) => (aiMap[r.id] = r));
  assert('dealer 项回写 generatedDocType=sales', aiMap[allocItemD].generatedDocType === 'sales', aiMap[allocItemD] && aiMap[allocItemD].generatedDocType);
  assert('store 项回写 generatedDocType=transfer', aiMap[allocItemS].generatedDocType === 'transfer', aiMap[allocItemS] && aiMap[allocItemS].generatedDocType);

  console.log('  · F2 approve 完成（dealer+store 双分支批量路径）');

  // 清理 F2（按父表 ID 精确删除，避免依赖 remark 列是否存在）
  await db.delete(S.inventoryFlow).where(inArray(S.inventoryFlow.bizNo, [obNo, trNo]));
  await db.delete(S.receivable).where(eq(S.receivable.bizNo, obNo));
  await db.delete(S.salesOutboundItem).where(eq(S.salesOutboundItem.outboundId, soOutFor[0].id));
  await db.delete(S.salesOutbound).where(eq(S.salesOutbound.id, soOutFor[0].id));
  await db.delete(S.salesOrderItem).where(eq(S.salesOrderItem.orderId, soFor[0].id));
  await db.delete(S.salesOrder).where(eq(S.salesOrder.id, soFor[0].id));
  await db.delete(S.inventoryTransferItem).where(eq(S.inventoryTransferItem.transferId, trFor[0].id));
  await db.delete(S.inventoryTransfer).where(eq(S.inventoryTransfer.id, trFor[0].id));
  await db.delete(S.inventoryStock).where(eq(S.inventoryStock.warehouseId, storeWh));
  await db.delete(S.inventoryStock).where(and(eq(S.inventoryStock.warehouseId, hq), inArray(S.inventoryStock.skuId, [skuD, skuS])));
  await db.delete(S.allocationItem).where(eq(S.allocationItem.allocationId, allocId));
  await db.delete(S.allocationOrder).where(eq(S.allocationOrder.id, allocId));
  await db.delete(S.customer).where(eq(S.customer.partnerId, dealerId));
  await db.delete(S.sku).where(inArray(S.sku.id, [skuD, skuS]));
  await db.delete(S.store).where(eq(S.store.id, storeId));
  await db.delete(S.dealer).where(eq(S.dealer.id, dealerId));
  await db.delete(S.warehouse).where(eq(S.warehouse.id, storeWh));
  await db.delete(S.tradeShow).where(eq(S.tradeShow.id, showId));
  await db.delete(S.style).where(eq(S.style.id, ST2));
  await db.delete(S.colorGroup).where(eq(S.colorGroup.id, CG2));
  await db.delete(S.sizeGroup).where(eq(S.sizeGroup.id, SG2));

  console.log(`\n结果：pass=${pass} fail=${fail}`);
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('运行异常', e); process.exit(2); });
