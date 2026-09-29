/**
 * N+1 消除回归：验证本轮批量改写后的三处逻辑正确性
 *   F5  SystemConfigService.updateConfig  —— 批量 upsert（替代逐条 select+update/insert）
 *   F6  StyleAttrDefService.reorder/reorderValues —— 单条 CASE 批量 UPDATE（替代逐条 update）
 *   F3  StockService.batchChangeStock —— 增加走批量多值 upsert（替代逐条 upsert），扣减保持原子 UPDATE
 * 另含批量压力子测试（50 项一次批量 upsert）佐证性能收益。
 *
 * 运行：node sim-batch-n1.cjs   （需 dev/postgres 在 localhost:5434）
 */
const { randomUUID } = require('crypto');
const postgres = require('postgres');
const { eq, inArray, sql } = require('drizzle-orm');
const { SystemConfigService } = require('./dist/server/modules/system/config/system-config.service.js');
const { StyleAttrDefService } = require('./dist/server/modules/base/style-attr-def/style-attr-def.service.js');
const { StockService } = require('./dist/server/modules/inventory/stock/stock.service.js');
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

const TS = Date.now();
let CG, SG, STYLE;
async function seedFkBase() {
  CG = randomUUID(); SG = randomUUID(); STYLE = randomUUID();
  await db.insert(S.colorGroup).values({ id: CG, code: 'CG_' + TS, name: '色组' });
  await db.insert(S.sizeGroup).values({ id: SG, code: 'SG_' + TS, name: '尺组' });
  await db.insert(S.style).values({ id: STYLE, styleNo: 'ST_' + TS, name: '款', colorGroupId: CG, sizeGroupId: SG });
}
async function cleanupFkBase() {
  await db.delete(S.style).where(eq(S.style.id, STYLE));
  await db.delete(S.colorGroup).where(eq(S.colorGroup.id, CG));
  await db.delete(S.sizeGroup).where(eq(S.sizeGroup.id, SG));
}

async function main() {
  await seedFkBase();
  // ===== 测试1：SystemConfigService.updateConfig 批量 upsert =====
  console.log('【测试1】SystemConfigService.updateConfig 批量 upsert（F5）');
  const cfgSvc = new SystemConfigService(db);
  const KEYS = ['tablePageSize', 'maxTabs'];
  const before = await db.select().from(S.systemConfig).where(inArray(S.systemConfig.configKey, KEYS));
  const orig = {}; before.forEach((r) => (orig[r.configKey] = r.configValue));

  await cfgSvc.updateConfig({ tablePageSize: 50, maxTabs: 99 }, 'test-user');

  const after = await db.select().from(S.systemConfig).where(inArray(S.systemConfig.configKey, KEYS));
  const got = {}; after.forEach((r) => (got[r.configKey] = r.configValue));
  assert('tablePageSize 一次性写入=50', got['tablePageSize'] === '50', got);
  assert('maxTabs 一次性写入=99', got['maxTabs'] === '99', got);

  for (const k of KEYS) {
    if (orig[k] !== undefined) {
      await client`UPDATE system_config SET config_value=${orig[k]} WHERE config_key=${k}`;
    } else {
      await client`DELETE FROM system_config WHERE config_key=${k}`;
    }
  }
  const restored = await db.select().from(S.systemConfig).where(inArray(S.systemConfig.configKey, KEYS));
  const gotR = {}; restored.forEach((r) => (gotR[r.configKey] = r.configValue));
  assert('配置已还原', KEYS.every((k) => (orig[k] === undefined ? gotR[k] === undefined : gotR[k] === orig[k])), gotR);

  // ===== 测试2：StyleAttrDefService.reorder / reorderValues（CASE 批量 UPDATE）=====
  console.log('【测试2】StyleAttrDefService.reorder / reorderValues（F6 · CASE 批量 UPDATE）');
  const defSvc = new StyleAttrDefService(db);
  const ts = Date.now();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await client`INSERT INTO style_attr_def (id, attr_code, attr_name, sort_order, status) VALUES
    (${ids[0]}, ${'CODE_' + ts + '_1'}, ${'排序测试1'}, ${1}, ${'active'}),
    (${ids[1]}, ${'CODE_' + ts + '_2'}, ${'排序测试2'}, ${2}, ${'active'}),
    (${ids[2]}, ${'CODE_' + ts + '_3'}, ${'排序测试3'}, ${3}, ${'active'})`;
  await defSvc.reorder([{ id: ids[0], sortOrder: 10 }, { id: ids[1], sortOrder: 20 }]);
  const drows = await db.select().from(S.styleAttrDef).where(inArray(S.styleAttrDef.id, ids));
  const dmap = {}; drows.forEach((r) => (dmap[r.id] = Number(r.sortOrder)));
  assert('reorder id0=10', dmap[ids[0]] === 10, dmap);
  assert('reorder id1=20', dmap[ids[1]] === 20, dmap);
  assert('reorder id2 未变动=3', dmap[ids[2]] === 3, dmap);

  const vIds = [randomUUID(), randomUUID()];
  await client`INSERT INTO style_attr_value (id, attr_def_id, value_code, value_name, sort_order, status) VALUES
    (${vIds[0]}, ${ids[0]}, ${'V_' + ts + '_1'}, ${'值1'}, ${1}, ${'active'}),
    (${vIds[1]}, ${ids[0]}, ${'V_' + ts + '_2'}, ${'值2'}, ${2}, ${'active'})`;
  await defSvc.reorderValues([{ id: vIds[0], sortOrder: 30 }, { id: vIds[1], sortOrder: 40 }]);
  const vrows = await db.select().from(S.styleAttrValue).where(inArray(S.styleAttrValue.id, vIds));
  const vmap = {}; vrows.forEach((r) => (vmap[r.id] = Number(r.sortOrder)));
  assert('reorderValues v0=30', vmap[vIds[0]] === 30, vmap);
  assert('reorderValues v1=40', vmap[vIds[1]] === 40, vmap);

  await db.delete(S.styleAttrValue).where(inArray(S.styleAttrValue.id, vIds));
  await db.delete(S.styleAttrDef).where(inArray(S.styleAttrDef.id, ids));

  // ===== 测试3：StockService.batchChangeStock（F3 · 批量 upsert 增加 + 原子扣减 + 同键合并）=====
  console.log('【测试3】StockService.batchChangeStock（F3 · 批量 upsert 增加 + 原子扣减 + 同键合并）');
  const stockSvc = new StockService(db);
  const sku1 = randomUUID(), sku2 = randomUUID(), wh = randomUUID();
  const sts = Date.now();
  await db.insert(S.sku).values([
    { id: sku1, skuCode: 'SKU_' + sts + '_1', styleId: STYLE, styleNo: 'S1', color: '红', size: 'M' },
    { id: sku2, skuCode: 'SKU_' + sts + '_2', styleId: STYLE, styleNo: 'S2', color: '蓝', size: 'L' },
  ]);
  await db.insert(S.warehouse).values({ id: wh, code: 'WH_' + sts, name: '批测仓', type: 'main' });
  await db.insert(S.inventoryStock).values({
    skuId: sku1, warehouseId: wh, quantity: '10', skuCode: 'SKU_' + sts + '_1', styleNo: 'S1', color: '红', size: 'M', warehouseName: '批测仓',
  });

  const t0 = Date.now();
  await db.transaction(async (tx) => {
    await stockSvc.batchChangeStock(tx, [
      { skuId: sku1, itemType: 'sku', qtyDelta: +5, warehouseId: wh, warehouseName: '批测仓', flowType: 'test_in', bizNo: 'B1', skuCode: 'SKU_' + sts + '_1', styleNo: 'S1', color: '红', size: 'M' },
      { skuId: sku1, itemType: 'sku', qtyDelta: +3, warehouseId: wh, warehouseName: '批测仓', flowType: 'test_in', bizNo: 'B1', skuCode: 'SKU_' + sts + '_1', styleNo: 'S1', color: '红', size: 'M' }, // 同键合并 +3
      { skuId: sku2, itemType: 'sku', qtyDelta: +2, warehouseId: wh, warehouseName: '批测仓', flowType: 'test_in', bizNo: 'B1', skuCode: 'SKU_' + sts + '_2', styleNo: 'S2', color: '蓝', size: 'L' },
      { skuId: sku1, itemType: 'sku', qtyDelta: -1, warehouseId: wh, warehouseName: '批测仓', flowType: 'test_out', bizNo: 'B1', skuCode: 'SKU_' + sts + '_1', styleNo: 'S1', color: '红', size: 'M' }, // 扣减（原子）
    ]);
  });
  const t1 = Date.now();

  const srows = await db.select().from(S.inventoryStock).where(inArray(S.inventoryStock.skuId, [sku1, sku2]));
  const sm = {}; srows.forEach((r) => (sm[r.skuId] = Number(r.quantity)));
  assert('sku1 库存=10-1+5+3=17（同键合并累加）', sm[sku1] === 17, sm);
  assert('sku2 库存=2', sm[sku2] === 2, sm);
  const flowCnt = await db.select({ c: sql`count(*)` }).from(S.inventoryFlow).where(eq(S.inventoryFlow.bizNo, 'B1'));
  assert('流水=4 条（3增加+1扣减）', Number(flowCnt[0].c) === 4, Number(flowCnt[0].c));
  console.log('  · batchChangeStock 处理 4 项（含同键合并+原子扣减）耗时', t1 - t0, 'ms');

  await db.delete(S.inventoryFlow).where(eq(S.inventoryFlow.bizNo, 'B1'));
  await db.delete(S.inventoryStock).where(inArray(S.inventoryStock.skuId, [sku1, sku2]));
  await db.delete(S.sku).where(inArray(S.sku.id, [sku1, sku2]));
  await db.delete(S.warehouse).where(eq(S.warehouse.id, wh));

  // ===== 测试4：批量压力（50 项一次多值 upsert）佐证 N+1 消除收益 =====
  console.log('【测试4】批量 upsert 压力（50 项一次多值 upsert）');
  const whP = randomUUID();
  await db.insert(S.warehouse).values({ id: whP, code: 'WHP_' + TS, name: '压测仓', type: 'main' });
  const skus = [];
  for (let i = 0; i < 50; i++) skus.push(randomUUID());
  await db.insert(S.sku).values(
    skus.map((sid, i) => ({ id: sid, skuCode: 'PS_' + TS + '_' + i, styleId: STYLE, styleNo: 'P', color: 'C' + i, size: 'S' + i })),
  );
  const changes = skus.map((sid, i) => ({
    skuId: sid, itemType: 'sku', qtyDelta: +1, warehouseId: whP, warehouseName: '压测仓',
    flowType: 'stress_in', bizNo: 'BZ', skuCode: 'PS_' + i, styleNo: 'P', color: 'C' + i, size: 'S' + i,
  }));
  const tp0 = Date.now();
  await db.transaction(async (tx) => { await stockSvc.batchChangeStock(tx, changes); });
  const tp1 = Date.now();
  const pRows = await db.select().from(S.inventoryStock).where(inArray(S.inventoryStock.skuId, skus));
  assert('批量 upsert 50 项全部落地', pRows.length === 50, { len: pRows.length });
  assert('每项 quantity=1', pRows.every((r) => Number(r.quantity) === 1), pRows.length);
  console.log('  · batchChangeStock 一次处理 50 项（原需 50 次往返）耗时', tp1 - tp0, 'ms');
  await db.delete(S.inventoryFlow).where(eq(S.inventoryFlow.bizNo, 'BZ'));
  await db.delete(S.inventoryStock).where(inArray(S.inventoryStock.skuId, skus));
  await db.delete(S.sku).where(inArray(S.sku.id, skus));
  await db.delete(S.warehouse).where(eq(S.warehouse.id, whP));

  console.log(`\n结果：pass=${pass} fail=${fail}`);
  await cleanupFkBase();
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('运行异常', e); process.exit(2); });
