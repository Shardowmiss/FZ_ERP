/**
 * MRP 净需求精修回归 sim
 *
 * 验证重盘报告缺陷#4（MRP 净需求硬伤）修复后，mrp.service.calculate 的净需求公式：
 *   net = max(0, gross + safetyStock - onHand - inTransitPO - inTransitMO)
 *   其中 inTransitPO = 已审/记账/验收采购订单的 (quantity - receivedQty)
 *        inTransitMO = 已发料(approved)生产工单占用的物料量
 *   并验证 MOQ 向上取整与安全库存缓冲。
 *
 * 方法：在真实数据库播种一个完全受控的场景（新 物料/款号/BOM/库存/采购单/生产发料），
 * 用编译后的真实 MrpService.calculate 跑黑盒断言，结束后清理播种行。
 *
 * 运行：node sim-mrp-netting.cjs   （需 dev/postgres 在 localhost:5434 运行）
 */
const crypto = require('crypto');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq } = require('drizzle-orm');
const S = require('./dist/server/database/schema.js');
const { MrpService } = require('./dist/server/modules/production/mrp/mrp.service.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });
const svc = new MrpService(db);

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713', name); }
  else { fail++; console.log('  \u2717 FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// 受控场景的 uuid（显式生成，便于清理）
const M = crypto.randomUUID();   // 物料
const ST = crypto.randomUUID();  // 款号
const BOM = crypto.randomUUID(); // BOM
const BI = crypto.randomUUID();  // BOM 明细
const MS = crypto.randomUUID();  // 库存（WH-MAIN）
const MS2 = crypto.randomUUID(); // 库存（WH2，用于逐仓测试）
const PO = crypto.randomUUID();  // 采购单
const POI = crypto.randomUUID(); // 采购单明细
const PMI = crypto.randomUUID(); // 生产发料
const PMII = crypto.randomUUID();// 生产发料明细

// 复用现有 FK 目标（NOT NULL 约束）
const WH = 'bb547b9b-6151-4d41-85ef-f7bb27081593';   // WH-MAIN 中央总仓
const WH2 = 'c4d74dd9-cfd5-4ab1-bfec-e418ba73ad4c';  // ST-D01-WH 杭州湖滨直营店仓（逐仓测试第二仓）
const SUP = 'cf53fd0e-b535-4683-b9c8-fc098635e851';
const WO = '43f5bde7-5b4b-4319-a593-259093e04a15';
const CG = '477db48e-9a3c-4d63-b9d2-7246762bc44a';
const SG = 'f0745a6f-f5b6-47fb-aa8e-a7829fddf20c';

const MAT_CODE = 'MAT-SIM-01';
const MAT_NAME = 'SimMaterial';
const STYLE_NO = 'SIM-STYLE-01';

async function seed() {
  await db.insert(S.material).values({ id: M, code: MAT_CODE, name: MAT_NAME, unit: 'm', status: 'active' });
  await db.insert(S.style).values({ id: ST, styleNo: STYLE_NO, name: 'SimStyle', colorGroupId: CG, sizeGroupId: SG, status: 'active' });
  await db.insert(S.bom).values({ id: BOM, styleId: ST, styleNo: STYLE_NO, version: 'V1', status: 'active' });
  await db.insert(S.bomItem).values({
    id: BI, bomId: BOM, materialId: M, materialCode: MAT_CODE, materialName: MAT_NAME,
    unit: 'm', usagePerPiece: '2', lossRate: '10', bomType: 'main',
  });
  // 在库 50（WH-MAIN）；另在 WH2 放 20，用于逐仓/分仓分布验证。采购在途 30-10=20；生产占用 5
  await db.insert(S.materialStock).values({ id: MS, materialId: M, materialCode: MAT_CODE, materialName: MAT_NAME, warehouseId: WH, warehouseName: 'SIM-WH', quantity: '50' });
  await db.insert(S.materialStock).values({ id: MS2, materialId: M, materialCode: MAT_CODE, materialName: MAT_NAME, warehouseId: WH2, warehouseName: 'SIM-WH2', quantity: '20' });
  await db.insert(S.purchaseOrder).values({ id: PO, orderNo: 'SIM-PO-01', supplierId: SUP, supplierName: 'SIM-SUP', orderDate: '2026-09-22', status: 'booked' });
  await db.insert(S.purchaseOrderItem).values({ id: POI, orderId: PO, materialId: M, materialCode: MAT_CODE, materialName: MAT_NAME, unit: 'm', quantity: '30', price: '1', amount: '30', receivedQty: '10' });
  await db.insert(S.productionMaterialIssue).values({ id: PMI, issueNo: 'SIM-MI-01', workOrderId: WO, warehouseId: WH, issueDate: '2026-09-22', status: 'approved' });
  await db.insert(S.productionMaterialIssueItem).values({ id: PMII, issueId: PMI, materialId: M, materialCode: MAT_CODE, materialName: MAT_NAME, unit: 'm', planQty: '5', actualQty: '5' });
}

async function cleanup() {
  for (const [tbl, id] of [
    [S.productionMaterialIssueItem, PMII], [S.productionMaterialIssue, PMI],
    [S.purchaseOrderItem, POI], [S.purchaseOrder, PO],
    [S.materialStock, MS2], [S.materialStock, MS], [S.bomItem, BI], [S.bom, BOM],
    [S.style, ST], [S.material, M],
  ]) {
    await db.delete(tbl).where(eq(tbl.id, id));
  }
}

async function run() {
  console.log('\n[MRP] 净需求精修回归');
  await seed();

  // 场景：生产 100 件，安全库存 10%，MOQ=25
  const r = await svc.calculate({ styleId: ST, quantity: 100, safetyStockPct: 0.1, moq: 25 });
  const it = r.items[0];
  // 聚合在库 = WH-MAIN(50) + WH2(20) = 70；gross = 2*100*1.1 = 220；safety = 22；poInTransit=20；moCommitted=5
  // available = 70+20+5 = 95；netRaw = 220+22-95 = 147；moq=25 -> ceil(147/25)*25 = 150
  console.log('  [debug] item=', JSON.stringify(it));
  assert('毛需求 = 220', Math.abs(it.grossDemand - 220) < 1e-6, it.grossDemand);
  assert('聚合在库 = 70 (50+20)', Math.abs(it.stockQty - 70) < 1e-6, it.stockQty);
  assert('在途采购 = 20 (30-10)', Math.abs(it.inTransitPoQty - 20) < 1e-6, it.inTransitPoQty);
  assert('生产占用 = 5', Math.abs(it.inTransitMoQty - 5) < 1e-6, it.inTransitMoQty);
  assert('安全库存 = 22 (10%毛需求)', Math.abs(it.safetyStockQty - 22) < 1e-6, it.safetyStockQty);
  assert('净需求 = 147 (220+22-70-20-5)', Math.abs(it.netDemand - 147) < 1e-6, it.netDemand);
  assert('建议采购 = 150 (MOQ=25 向上取整)', Math.abs(it.suggestedPurchaseQty - 150) < 1e-6, it.suggestedPurchaseQty);
  assert('结果未指定仓库 -> warehouseId=null', r.warehouseId === null, r.warehouseId);

  // 向后兼容：不传 safetyStockPct/moq -> 净需求 = 220-95 = 125，建议 = 125
  const r2 = await svc.calculate({ styleId: ST, quantity: 100 });
  const it2 = r2.items[0];
  assert('兼容态 安全库存=0', Math.abs(it2.safetyStockQty) < 1e-6, it2.safetyStockQty);
  assert('兼容态 净需求=125 (220-70-20-5)', Math.abs(it2.netDemand - 125) < 1e-6, it2.netDemand);
  assert('兼容态 建议=125 (无MOQ)', Math.abs(it2.suggestedPurchaseQty - 125) < 1e-6, it2.suggestedPurchaseQty);

  // 小批量：可用 75 已覆盖毛需求 22 -> 净需求地板为 0
  const r3 = await svc.calculate({ styleId: ST, quantity: 10 });
  const it3 = r3.items[0]; // gross = 2*10*1.1 = 22
  assert('小批量 毛需求=22', Math.abs(it3.grossDemand - 22) < 1e-6, it3.grossDemand);
  assert('小批量 净需求地板=0 (22 < 可用95)', Math.abs(it3.netDemand) < 1e-6, it3.netDemand);
  assert('小批量 建议=0', Math.abs(it3.suggestedPurchaseQty) < 1e-6, it3.suggestedPurchaseQty);

  // ===== 逐仓 MRP：指定仓库时仅用该仓在库 + 该仓已发料占用（采购在途为全局供给，因采购单无仓库维度）=====
  const rWh1 = await svc.calculate({ styleId: ST, quantity: 100, warehouseId: WH });
  const itWh1 = rWh1.items[0];
  // WH-MAIN onHand=50；poInTransit(全局)=20；moCommitted(WH-MAIN 发料)=5 -> available=75 -> net=220-75=145
  assert('逐仓[WH-MAIN] 在库=50', Math.abs(itWh1.stockQty - 50) < 1e-6, itWh1.stockQty);
  assert('逐仓[WH-MAIN] 净需求=145 (220-50-20-5)', Math.abs(itWh1.netDemand - 145) < 1e-6, itWh1.netDemand);
  assert('逐仓[WH-MAIN] 结果.warehouseId=WH', rWh1.warehouseId === WH, rWh1.warehouseId);
  assert('逐仓[WH-MAIN] 不返回分仓分布', rWh1.warehouseBreakdown === undefined, rWh1.warehouseBreakdown);

  const rWh2 = await svc.calculate({ styleId: ST, quantity: 100, warehouseId: WH2 });
  const itWh2 = rWh2.items[0];
  // WH2 onHand=20；poInTransit(全局)=20；moCommitted(WH2 无发料)=0 -> available=40 -> net=220-40=180
  assert('逐仓[WH2] 在库=20', Math.abs(itWh2.stockQty - 20) < 1e-6, itWh2.stockQty);
  assert('逐仓[WH2] 净需求=180 (220-20-20-0)', Math.abs(itWh2.netDemand - 180) < 1e-6, itWh2.netDemand);
  assert('逐仓[WH2] 结果.warehouseId=WH2', rWh2.warehouseId === WH2, rWh2.warehouseId);

  // ===== 分仓在库分布：汇总测算应列出各仓 onHand =====
  const rAgg = await svc.calculate({ styleId: ST, quantity: 100 });
  assert('汇总 分仓分布含 2 个仓库', !!(rAgg.warehouseBreakdown && rAgg.warehouseBreakdown.length === 2), rAgg.warehouseBreakdown && rAgg.warehouseBreakdown.length);
  const whMainB = rAgg.warehouseBreakdown && rAgg.warehouseBreakdown.find((b) => b.warehouseId === WH);
  const wh2B = rAgg.warehouseBreakdown && rAgg.warehouseBreakdown.find((b) => b.warehouseId === WH2);
  {
    const onHandMain = whMainB && whMainB.items.find((i) => i.materialId === M);
    const onHandWh2 = wh2B && wh2B.items.find((i) => i.materialId === M);
    assert('分仓[WH-MAIN] onHand=50', onHandMain ? Math.abs(onHandMain.onHand - 50) < 1e-6 : false, onHandMain && onHandMain.onHand);
    assert('分仓[WH2] onHand=20', onHandWh2 ? Math.abs(onHandWh2.onHand - 20) < 1e-6 : false, onHandWh2 && onHandWh2.onHand);
  }

  // ===== 物料主数据默认值回退：未传 DTO 时读取 material.safety_stock_pct / moq =====
  await db.update(S.material).set({ safetyStockPct: '0.1', moq: '25' }).where(eq(S.material.id, M));
  const rDef = await svc.calculate({ styleId: ST, quantity: 100 });
  const itDef = rDef.items[0];
  // gross=220, safety=22 (10%), onHand=70, poInTransit=20, moCommitted=5 -> net=147; moq=25 -> 150
  assert('物料默认值生效 safetyStockPctUsed=0.1', Math.abs(itDef.safetyStockPctUsed - 0.1) < 1e-6, itDef.safetyStockPctUsed);
  assert('物料默认值生效 moq=25', Math.abs(itDef.moq - 25) < 1e-6, itDef.moq);
  assert('物料默认值 净需求=147', Math.abs(itDef.netDemand - 147) < 1e-6, itDef.netDemand);
  assert('物料默认值 建议=150', Math.abs(itDef.suggestedPurchaseQty - 150) < 1e-6, itDef.suggestedPurchaseQty);
  await db.update(S.material).set({ safetyStockPct: '0', moq: '0' }).where(eq(S.material.id, M)); // 复位

  await cleanup();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => {
  console.error('sim 异常:', e);
  try { await cleanup(); } catch (_) {}
  await client.end();
  process.exit(2);
});
