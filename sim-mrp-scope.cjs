/**
 * MRP 经销商作用域（scope∩仓库/供应商）约束回归 sim
 *
 * 验证 P1「mrp/cost 动态聚合专项」中 MRP 的改造：受限账号调用 calculate 时，
 * 库存/生产占用仅统计 scope 内仓库（viaWarehouse），在途采购仅统计 scope 内供应商
 * （viaSupplier），跨经销商数据被隔离；指定仓库时校验归属（受限越权抛 403）。
 * 超管态（ALL_SCOPE）行为保持不变（向后兼容 sim-mrp-netting）。
 *
 * 方法：seed 全新可控数据（dealer D1/D2 + 各归属仓库/供应商 + 物料/BOM/库存/采购单/发料），
 * 用编译后的真实 MrpService 在受限/超管作用域下黑盒断言，结束后清理。
 *
 * 运行：node sim-mrp-scope.cjs   （需 dev/postgres 在 localhost:5434 运行）
 */
const crypto = require('crypto');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq } = require('drizzle-orm');
const { ForbiddenException } = require('@nestjs/common');
const S = require('./dist/server/database/schema.js');
const { MrpService } = require('./dist/server/modules/production/mrp/mrp.service.js');
const { RequestContext } = require('./dist/server/common/context/request-context.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });
const svc = new MrpService(db);

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713', name); }
  else { fail++; console.log('  \u2717 FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// ---- 全新可控 seed id ----
const D1 = crypto.randomUUID();   // 经销商 1
const D2 = crypto.randomUUID();   // 经销商 2（与 D1 隔离）
const W1 = crypto.randomUUID();   // 仓库 1（归属 D1）
const W2 = crypto.randomUUID();   // 仓库 2（归属 D2）
const S1 = crypto.randomUUID();   // 供应商 1（归属 D1）
const S2 = crypto.randomUUID();   // 供应商 2（归属 D2）
const M = crypto.randomUUID();    // 物料
const ST = crypto.randomUUID();   // 款号
const BOM = crypto.randomUUID();  // BOM
const BI = crypto.randomUUID();   // BOM 明细
const MS1 = crypto.randomUUID();  // 库存 W1
const MS2 = crypto.randomUUID();  // 库存 W2
const PO1 = crypto.randomUUID();  // 采购单 S1
const PO2 = crypto.randomUUID();  // 采购单 S2
const POI1 = crypto.randomUUID();
const POI2 = crypto.randomUUID();
const PMI1 = crypto.randomUUID(); // 发料 W1
const PMI2 = crypto.randomUUID(); // 发料 W2
const PMII1 = crypto.randomUUID();
const PMII2 = crypto.randomUUID();
const WO = '43f5bde7-5b4b-4319-a593-259093e04a15'; // 复用现有 work_order FK 目标
const CG = '477db48e-9a3c-4d63-b9d2-7246762bc44a'; // 复用现有 color_group
const SG = 'f0745a6f-f5b6-47fb-aa8e-a7829fddf20c'; // 复用现有 size_group
const MAT_CODE = 'MAT-SIM-SCOPE';
const STYLE_NO = 'SIM-SCOPE-01';

async function seed() {
  await db.insert(S.dealer).values({ id: D1, code: 'DL-SIM-01', name: 'SimDealer1', level: 0, partnerType: 'hq' });
  await db.insert(S.dealer).values({ id: D2, code: 'DL-SIM-02', name: 'SimDealer2', level: 0, partnerType: 'hq' });
  await db.insert(S.warehouse).values({ id: W1, code: 'WH-SIM-01', name: 'SimWH1', type: 'self', dealerId: D1 });
  await db.insert(S.warehouse).values({ id: W2, code: 'WH-SIM-02', name: 'SimWH2', type: 'self', dealerId: D2 });
  await db.insert(S.supplier).values({ id: S1, code: 'SUP-SIM-01', name: 'SimSup1', partnerId: D1 });
  await db.insert(S.supplier).values({ id: S2, code: 'SUP-SIM-02', name: 'SimSup2', partnerId: D2 });
  await db.insert(S.material).values({ id: M, code: MAT_CODE, name: 'SimMaterial', unit: 'm' });
  await db.insert(S.style).values({ id: ST, styleNo: STYLE_NO, name: 'SimStyle', colorGroupId: CG, sizeGroupId: SG });
  await db.insert(S.bom).values({ id: BOM, styleId: ST, styleNo: STYLE_NO, version: 'V1', status: 'active' });
  await db.insert(S.bomItem).values({
    id: BI, bomId: BOM, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial',
    unit: 'm', usagePerPiece: '2', lossRate: '10', bomType: 'main',
  });
  // W1 在库 50；W2(D2) 在库 999（应被 D1 scope 排除）
  await db.insert(S.materialStock).values({ id: MS1, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial', warehouseId: W1, warehouseName: 'SIM-W1', quantity: '50' });
  await db.insert(S.materialStock).values({ id: MS2, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial', warehouseId: W2, warehouseName: 'SIM-W2', quantity: '999' });
  // S1(D1) 在途 30-10=20；S2(D2) 在途 999（应被 D1 scope 排除）
  await db.insert(S.purchaseOrder).values({ id: PO1, orderNo: 'SIM-PO1', supplierId: S1, supplierName: 'SIM-S1', orderDate: '2026-09-23', status: 'booked' });
  await db.insert(S.purchaseOrderItem).values({ id: POI1, orderId: PO1, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial', unit: 'm', quantity: '30', price: '1', amount: '30', receivedQty: '10' });
  await db.insert(S.purchaseOrder).values({ id: PO2, orderNo: 'SIM-PO2', supplierId: S2, supplierName: 'SIM-S2', orderDate: '2026-09-23', status: 'booked' });
  await db.insert(S.purchaseOrderItem).values({ id: POI2, orderId: PO2, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial', unit: 'm', quantity: '999', price: '1', amount: '999', receivedQty: '0' });
  // W1 占用 5；W2(D2) 占用 999（应被排除）
  await db.insert(S.productionMaterialIssue).values({ id: PMI1, issueNo: 'SIM-MI1', workOrderId: WO, warehouseId: W1, issueDate: '2026-09-23', status: 'approved' });
  await db.insert(S.productionMaterialIssueItem).values({ id: PMII1, issueId: PMI1, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial', unit: 'm', planQty: '5', actualQty: '5' });
  await db.insert(S.productionMaterialIssue).values({ id: PMI2, issueNo: 'SIM-MI2', workOrderId: WO, warehouseId: W2, issueDate: '2026-09-23', status: 'approved' });
  await db.insert(S.productionMaterialIssueItem).values({ id: PMII2, issueId: PMI2, materialId: M, materialCode: MAT_CODE, materialName: 'SimMaterial', unit: 'm', planQty: '999', actualQty: '999' });
}

async function cleanup() {
  for (const [tbl, id] of [
    [S.productionMaterialIssueItem, PMII2], [S.productionMaterialIssueItem, PMII1],
    [S.productionMaterialIssue, PMI2], [S.productionMaterialIssue, PMI1],
    [S.purchaseOrderItem, POI2], [S.purchaseOrderItem, POI1],
    [S.purchaseOrder, PO2], [S.purchaseOrder, PO1],
    [S.materialStock, MS2], [S.materialStock, MS1],
    [S.bomItem, BI], [S.bom, BOM], [S.style, ST], [S.material, M],
    [S.supplier, S2], [S.supplier, S1], [S.warehouse, W2], [S.warehouse, W1],
    [S.dealer, D2], [S.dealer, D1],
  ]) {
    await db.delete(tbl).where(eq(tbl.id, id));
  }
}

async function run() {
  console.log('\n[MRP-SCOPE] 经销商作用域约束');
  await seed();

  const ctxD1 = { dealerScope: { type: 'dealer', dealerIds: [D1] } };

  // ===== 测试 A：受限 scope=D1 汇总（未指定仓库）=====
  console.log('\n[A] 受限 dealer D1 汇总：只算 D1 的仓库/供应商，跨经销商数据被隔离');
  const rA = await RequestContext.run(ctxD1, () => svc.calculate({ styleId: ST, quantity: 100 }));
  const itA = rA.items[0];
  // gross = 2*100*1.1 = 220；stock=50(W1)；po=20(S1)；mo=5(W1) -> available=75 -> net=145
  assert('毛需求 = 220', Math.abs(itA.grossDemand - 220) < 1e-6, itA.grossDemand);
  assert('在库仅 W1 = 50（排除 W2 的 999）', Math.abs(itA.stockQty - 50) < 1e-6, itA.stockQty);
  assert('在途仅 S1 = 20（排除 S2 的 999）', Math.abs(itA.inTransitPoQty - 20) < 1e-6, itA.inTransitPoQty);
  assert('占用仅 W1 = 5（排除 W2 的 999）', Math.abs(itA.inTransitMoQty - 5) < 1e-6, itA.inTransitMoQty);
  assert('净需求 = 145 (220-50-20-5)', Math.abs(itA.netDemand - 145) < 1e-6, itA.netDemand);
  assert('分仓分布仅含 W1（不含 W2）', !!(rA.warehouseBreakdown && rA.warehouseBreakdown.length === 1 && rA.warehouseBreakdown[0].warehouseId === W1), rA.warehouseBreakdown && rA.warehouseBreakdown.map((b) => b.warehouseId));

  // ===== 测试 B：超管态（ALL_SCOPE）汇总，行为不变 =====
  console.log('\n[B] 超管态汇总：全量可见，与改造前一致');
  const rB = await svc.calculate({ styleId: ST, quantity: 100 }); // 无包裹 -> ALL_SCOPE
  const itB = rB.items[0];
  // stock=50+999=1049；po=20+999=1019；mo=5+999=1004 -> available 远超 gross -> net=0
  assert('在库全量 = 1049 (50+999)', Math.abs(itB.stockQty - 1049) < 1e-6, itB.stockQty);
  assert('在途全量 = 1019 (20+999)', Math.abs(itB.inTransitPoQty - 1019) < 1e-6, itB.inTransitPoQty);
  assert('占用全量 = 1004 (5+999)', Math.abs(itB.inTransitMoQty - 1004) < 1e-6, itB.inTransitMoQty);
  assert('净需求地板 = 0（可用远超毛需求）', Math.abs(itB.netDemand) < 1e-6, itB.netDemand);

  // ===== 测试 C：受限 scope=D1 指定 W1（归属内），正常按单仓 + D1 供应商 =====
  console.log('\n[C] 受限 D1 指定 W1（归属内）：单仓在库 + 按 D1 供应商在途');
  const rC = await RequestContext.run(ctxD1, () => svc.calculate({ styleId: ST, quantity: 100, warehouseId: W1 }));
  const itC = rC.items[0];
  assert('指定仓在库 = 50', Math.abs(itC.stockQty - 50) < 1e-6, itC.stockQty);
  assert('在途仅 D1 供应商 = 20', Math.abs(itC.inTransitPoQty - 20) < 1e-6, itC.inTransitPoQty);
  assert('占用仅 W1 = 5', Math.abs(itC.inTransitMoQty - 5) < 1e-6, itC.inTransitMoQty);
  assert('净需求 = 145 (220-50-20-5)', Math.abs(itC.netDemand - 145) < 1e-6, itC.netDemand);
  assert('结果.warehouseId = W1', rC.warehouseId === W1, rC.warehouseId);

  // ===== 测试 D：受限 scope=D1 指定 W2（跨经销商）应抛 403 =====
  console.log('\n[D] 受限 D1 指定 W2（归属 D2）越权：应抛 ForbiddenException');
  let threw = false;
  try {
    await RequestContext.run(ctxD1, () => svc.calculate({ styleId: ST, quantity: 100, warehouseId: W2 }));
  } catch (e) {
    threw = e instanceof ForbiddenException || (e && e.constructor && e.constructor.name === 'ForbiddenException');
  }
  assert('指定他人仓库抛 403 Forbidden', threw);

  // ===== 测试 E：静态守卫 =====
  console.log('\n[E] 静态守卫：mrp.service.ts 注入 scope 约束');
  const fs = require('fs');
  const path = require('path');
  const txt = fs.readFileSync(path.join(__dirname, 'server/modules/production/mrp/mrp.service.ts'), 'utf8');
  assert('import RequestContext/ALL_SCOPE', /from '@server\/common\/context\/request-context'/.test(txt));
  assert('import buildDealerScopeCondition', /from '@server\/common\/data-scope\/dealer-scope'/.test(txt));
  assert('import assertWriteWithinScope', /from '@server\/common\/data-scope\/write-scope'/.test(txt));
  assert('调用 getDealerScope', /RequestContext\.getDealerScope\(\)/.test(txt));
  assert('调用 buildDealerScopeCondition (库存/占用)', (txt.match(/buildDealerScopeCondition\(/g) || []).length >= 2);
  assert('调用 assertWriteWithinScope (指定仓库归属校验)', /assertWriteWithinScope\(/.test(txt));

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
