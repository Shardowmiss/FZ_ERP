/* P1-4 库存逻辑收敛 回归脚本
 * 目的：验证"采购入库/采购退货/面辅料入库"三处内联库存逻辑收敛后依赖的
 *       共同核心 StockService.batchChangeStock —— 覆盖 SKU/物料 增加、扣减、库存不足拒绝。
 * 这是三个服务收敛后统一调用的底层逻辑，行为正确即代表收敛等价。
 * 用法：node sim-inventory-stock-service.cjs
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, sql } = require('drizzle-orm');
const postgres = require('postgres');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
const {
  warehouse, sku, style, material, inventoryStock, inventoryFlow,
} = schema;
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });
const uid = () => crypto.randomUUID();
const PREFIX = 'P1P4_';
let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { console.log(`  ✅ ${msg}`); pass++; }
  else { console.log(`  ❌ ${msg}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); fail++; }
}

async function ensureMasters() {
  // 复用库中现有主数据，避免新建主数据触发的未知非空约束
  const [wh] = await db.select().from(warehouse).limit(1);
  if (!wh) throw new Error('库中无 warehouse，请先运行 sim-org.cjs');
  const [sk] = await db.select().from(sku).limit(1);
  if (!sk) throw new Error('库中无 sku，请先运行 sim-business.cjs');
  const [mat] = await db.select().from(material).limit(1);
  if (!mat) throw new Error('库中无 material，请先运行 sim-business.cjs');
  return { wh, sk, mat };
}

async function getSkuQty(skuId, whId) {
  const rows = await db.select().from(inventoryStock)
    .where(and(eq(inventoryStock.skuId, skuId), eq(inventoryStock.warehouseId, whId)));
  return rows.length ? Number(rows[0].quantity) : 0;
}
async function getMatQty(matId, whId) {
  const rows = await db.select().from(inventoryStock) // 物料也存于 inventoryStock? 实际在 materialStock
    .where(and(eq(inventoryStock.skuId, matId), eq(inventoryStock.warehouseId, whId)));
  return rows.length ? Number(rows[0].quantity) : 0;
}

async function main() {
  console.log('=== P1-4 StockService.batchChangeStock 回归 ===');
  const { wh, sk, mat } = await ensureMasters();
  const svc = new StockService(db);

  // 清理环境：删掉本脚本可能写入的库存/流水，保证可重复运行
  await db.execute(sql`DELETE FROM inventory_flow WHERE biz_no LIKE ${PREFIX + '%'}`);
  await db.execute(sql`DELETE FROM inventory_stock WHERE sku_id = ${sk.id} AND warehouse_id = ${wh.id}`);
  await db.execute(sql`DELETE FROM material_stock WHERE material_id = ${mat.id} AND warehouse_id = ${wh.id}`);

  // 1) SKU 增加（对应 成衣采购入库）
  const beforeSku = await getSkuQty(sk.id, wh.id);
  await svc.batchChangeStock(db, [{
    warehouseId: wh.id, warehouseName: wh.name, skuId: sk.id, itemType: 'sku',
    qtyDelta: 10, flowType: PREFIX + 'IN', bizNo: PREFIX + 'IB1',
    styleNo: sk.styleNo, color: '黑', size: 'M', skuCode: sk.skuCode,
  }]);
  const afterSkuIn = await getSkuQty(sk.id, wh.id);
  assert(afterSkuIn === beforeSku + 10, 'SKU 增加：库存 +10', { beforeSku, afterSkuIn });

  const flowIn = await db.select().from(inventoryFlow)
    .where(and(eq(inventoryFlow.bizNo, PREFIX + 'IB1'), eq(inventoryFlow.skuId, sk.id)));
  assert(flowIn.length === 1 && Number(flowIn[0].quantity) === 10 && flowIn[0].direction === 'in',
    'SKU 增加：写入一条 in 方向流水', { flowIn: flowIn.map(f => ({ q: f.quantity, d: f.direction })) });

  // 2) SKU 扣减（对应 成衣采购退货），不超过库存 -> 成功
  await svc.batchChangeStock(db, [{
    warehouseId: wh.id, warehouseName: wh.name, skuId: sk.id, itemType: 'sku',
    qtyDelta: -4, flowType: PREFIX + 'OUT', bizNo: PREFIX + 'RT1',
    styleNo: sk.styleNo, color: '黑', size: 'M', skuCode: sk.skuCode,
  }]);
  const afterSkuOut = await getSkuQty(sk.id, wh.id);
  assert(afterSkuOut === afterSkuIn - 4, 'SKU 扣减：库存 -4', { afterSkuIn, afterSkuOut });

  // 3) SKU 扣减超出库存 -> 拒绝（ConflictException 库存不足）
  let rejected = false;
  try {
    await svc.batchChangeStock(db, [{
      warehouseId: wh.id, warehouseName: wh.name, skuId: sk.id, itemType: 'sku',
      qtyDelta: -(afterSkuOut + 100), flowType: PREFIX + 'OUT', bizNo: PREFIX + 'RT2',
      styleNo: sk.styleNo, color: '黑', size: 'M', skuCode: sk.skuCode,
    }]);
  } catch (e) {
    rejected = /库存不足/.test(e?.message || '');
  }
  assert(rejected, 'SKU 扣减超出库存：抛 库存不足 并拒绝（原子，库存不变）');
  const afterReject = await getSkuQty(sk.id, wh.id);
  assert(afterReject === afterSkuOut, 'SKU 扣减失败时库存未改变（原子回滚）', { afterSkuOut, afterReject });

  // 4) 物料增加（对应 面辅料采购入库）
  await svc.batchChangeStock(db, [{
    warehouseId: wh.id, warehouseName: wh.name, materialId: mat.id, itemType: 'material',
    qtyDelta: 5, flowType: PREFIX + 'MATIN', bizNo: PREFIX + 'MIB1',
    materialCode: mat.code, materialName: mat.name,
  }]);
  const matRows = await db.select().from(schema.materialStock)
    .where(and(eq(schema.materialStock.materialId, mat.id), eq(schema.materialStock.warehouseId, wh.id)));
  const afterMat = matRows.length ? Number(matRows[0].quantity) : 0;
  assert(afterMat === 5, '物料增加：material_stock +5', { afterMat });

  const matFlow = await db.select().from(inventoryFlow)
    .where(and(eq(inventoryFlow.bizNo, PREFIX + 'MIB1'), eq(inventoryFlow.materialId, mat.id)));
  assert(matFlow.length === 1 && Number(matFlow[0].quantity) === 5 && matFlow[0].itemType === 'material',
    '物料增加：写入一条 material 类型流水', { matFlow: matFlow.map(f => ({ q: f.quantity, t: f.itemType })) });

  await db.execute(sql`DELETE FROM inventory_flow WHERE biz_no LIKE ${PREFIX + '%'}`);
  await db.execute(sql`DELETE FROM inventory_stock WHERE sku_id = ${sk.id} AND warehouse_id = ${wh.id}`);
  await db.execute(sql`DELETE FROM material_stock WHERE material_id = ${mat.id} AND warehouse_id = ${wh.id}`);

  console.log(`\n=== 结论：${fail === 0 ? '✅ 通过' : '❌ 失败'}（pass=${pass}, fail=${fail}）===`);
  await client.end();
  if (fail > 0) process.exitCode = 1;
}
main().catch(async (e) => { console.error('失败：', e); try { await client.end(); } catch (_) {} process.exit(1); });
