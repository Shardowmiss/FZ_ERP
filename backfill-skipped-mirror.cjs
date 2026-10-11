/* 补跑 12 张 mirror_status='skipped' 销售单的正向镜像（真实落库，非回滚）
 * ------------------------------------------------------------------
 * 背景：迭代一(#778)回填了 39 个缺供应商身份的经销节点后，这 12 张单当初
 * 因「上级无供应商主数据」被安全跳过。如今其上级(838cde0a)已具备 active
 * 供应商身份(baf11e81)，resolveMirrorContext 可解析成功，逐张重跑即生成
 * 下游成衣采购单(状态 wait_confirm)。
 *
 * 入口：DistributionMirrorService.mirrorFromSalesOrder(id)（幂等重跑入口）
 * 每张单在自身事务内提交；任一张失败仅标记 failed 并被记录，不影响其余。
 *
 * 用法：node backfill-skipped-mirror.cjs
 */
const path = require('path');
const fs = require('fs');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, inArray } = require('drizzle-orm');

function loadEnv() {
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
}
loadEnv();

const schema = require('./dist/server/database/schema');
const { salesOrder, garmentPurchaseOrder } = schema;
const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { GarmentPurchaseOrderService } = require('./dist/server/modules/purchase/garment-order/garment-purchase-order.service');
const { GarmentPurchaseReturnService } = require('./dist/server/modules/purchase/garment-return/garment-purchase-return.service');
const { DistributionMirrorService } = require('./dist/server/modules/distribution/distribution-mirror.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });

async function main() {
  console.log('=== 补跑 skipped 销售单正向镜像（真实落库）===\n');

  const ng = new NumberGeneratorService();
  const garmentOrder = new GarmentPurchaseOrderService(db, ng);
  const garmentReturn = new GarmentPurchaseReturnService(db, ng);
  const mirror = new DistributionMirrorService(db, garmentOrder, garmentReturn);

  // 取当前全部 skipped 销售单
  const skipped = await db
    .select({ id: salesOrder.id, orderNo: salesOrder.orderNo })
    .from(salesOrder)
    .where(eq(salesOrder.mirrorStatus, 'skipped'));

  console.log(`待补跑销售单数量: ${skipped.length}\n`);

  const results = [];
  for (const so of skipped) {
    try {
      await mirror.mirrorFromSalesOrder(so.id);
      results.push({ orderNo: so.orderNo, id: so.id, ok: true });
      console.log(`  [RUN] ${so.orderNo} (${so.id}) 已触发`);
    } catch (e) {
      results.push({ orderNo: so.orderNo, id: so.id, ok: false, err: e.message });
      console.log(`  [ERR] ${so.orderNo} (${so.id}): ${e.message}`);
    }
  }

  // 复核：重查这些单的镜像结果与生成的采购单
  const ids = results.map((r) => r.id);
  const after = await db
    .select({ id: salesOrder.id, orderNo: salesOrder.orderNo, mirrorStatus: salesOrder.mirrorStatus, mirrorOrderId: salesOrder.mirrorOrderId, mirrorError: salesOrder.mirrorError })
    .from(salesOrder)
    .where(inArray(salesOrder.id, ids));

  const pos = await db
    .select({
      id: garmentPurchaseOrder.id,
      orderNo: garmentPurchaseOrder.orderNo,
      sourceDocId: garmentPurchaseOrder.sourceDocId,
      sourceDocType: garmentPurchaseOrder.sourceDocType,
      downstreamOrgId: garmentPurchaseOrder.downstreamOrgId,
      supplierName: garmentPurchaseOrder.supplierName,
      status: garmentPurchaseOrder.status,
    })
    .from(garmentPurchaseOrder)
    .where(
      and(
        inArray(garmentPurchaseOrder.sourceDocId, ids),
        eq(garmentPurchaseOrder.sourceDocType, 'SALES_ORDER'),
      ),
    );

  console.log('\n--- 销售单镜像结果 ---');
  let success = 0, failed = 0, stillSkipped = 0;
  for (const a of after) {
    const flag = a.mirrorStatus === 'success' ? 'SUCCESS' : (a.mirrorStatus === 'failed' ? 'FAILED' : 'SKIPPED');
    if (a.mirrorStatus === 'success') success++;
    else if (a.mirrorStatus === 'failed') failed++;
    else stillSkipped++;
    console.log(`  [${flag}] ${a.orderNo} status=${a.mirrorStatus}${a.mirrorError ? ' err=' + a.mirrorError : ''} po=${a.mirrorOrderId || '-'}`);
  }

  console.log('\n--- 生成的下游采购单 ---');
  for (const p of pos) {
    console.log(`  ${p.orderNo} | supplier=${p.supplierName} | downstream=${p.downstreamOrgId} | status=${p.status} | src=${p.sourceDocId}`);
  }

  console.log(`\n=== 汇总: 生成采购单 ${pos.length} 张 / success=${success} failed=${failed} stillSkipped=${stillSkipped} ===`);

  await client.end();
  process.exit(failed > 0 || stillSkipped > 0 ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
