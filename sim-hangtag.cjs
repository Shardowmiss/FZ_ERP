/* 吊牌打印 + 唯一码 联调脚本
 * ---------------------------------------------------------------------------
 * 直连数据库 + 实例化 HangtagService，验证：
 *   1) 唯一码参数配置（启用/长度校验、必须配置长度）
 *   2) 吊牌模板 CRUD
 *   3) 按采购单生成二维表（自动带数量）/ 按款号生成二维表（数量 0）
 *   4) 批量打印（生成任务+明细+日志），不打印唯一码
 *   5) 唯一码自增连续性：两次打印从最大码续增、从 1 起步、不重不漏
 *   6) 打印日志字段 + CSV 导出
 *
 * 用法：
 *   npm run build:server && node sim-hangtag.cjs
 * ---------------------------------------------------------------------------
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, inArray, sql } = require('drizzle-orm');
const postgres = require('postgres');
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

const distSchema = path.join(__dirname, 'dist', 'server', 'database', 'schema.js');
if (!fs.existsSync(distSchema)) {
  console.error('未找到 dist/server/database/schema.js，请先运行：npm run build:server');
  process.exit(1);
}
const schema = require(distSchema);
const { HangtagService } = require('./dist/server/modules/hangtag/hangtag.service.js');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });

const R = { errors: [], checks: [] };
function assert(cond, issue, detail) {
  if (cond) { R.checks.push({ ok: true, issue }); return true; }
  R.checks.push({ ok: false, issue, detail: detail || '' });
  R.errors.push(issue);
  return false;
}
const PREFIX = 'FF_HANGTAG_';
const createdTaskIds = [];
const createdTemplateIds = [];

async function ensureTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS hangtag_template (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(50) NOT NULL UNIQUE,
      name varchar(200) NOT NULL,
      content_config jsonb NOT NULL DEFAULT '{}',
      style_config jsonb NOT NULL DEFAULT '{}',
      is_default boolean NOT NULL DEFAULT false,
      status varchar(20) NOT NULL DEFAULT 'active',
      remark text,
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by text,
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by text
    );
    CREATE TABLE IF NOT EXISTS hangtag_print_task (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_no varchar(50) NOT NULL UNIQUE,
      template_id uuid NOT NULL,
      template_name varchar(200) NOT NULL,
      source_type varchar(20) NOT NULL,
      source_ref varchar(100) NOT NULL,
      include_unique_code boolean NOT NULL DEFAULT false,
      print_date date NOT NULL,
      total_qty numeric NOT NULL DEFAULT '0',
      unique_code_start bigint,
      unique_code_end bigint,
      content_snapshot jsonb NOT NULL DEFAULT '{}',
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by text,
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by text
    );
    CREATE TABLE IF NOT EXISTS hangtag_print_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL,
      style_no varchar(50) NOT NULL,
      style_name varchar(200),
      color varchar(50) NOT NULL,
      size varchar(50) NOT NULL,
      quantity numeric NOT NULL DEFAULT '0',
      unique_code_start bigint,
      unique_code_end bigint,
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT hangtag_print_item_task_id_fkey FOREIGN KEY (task_id)
        REFERENCES hangtag_print_task(id) ON DELETE CASCADE
    );
    ALTER TABLE hangtag_print_item ADD COLUMN IF NOT EXISTS sku_id uuid;
  `);
}

async function cleanup() {
  // 删除历史遗留（前次异常退出）的 FF_ 打印任务/明细（按来源前缀）
  const ffTasks = await db.select({ id: schema.hangtagPrintTask.id })
    .from(schema.hangtagPrintTask).where(sql`source_ref LIKE ${PREFIX + '%'}`);
  if (ffTasks.length) {
    const ids = ffTasks.map((t) => t.id);
    await db.delete(schema.hangtagPrintItem).where(inArray(schema.hangtagPrintItem.taskId, ids));
    await db.delete(schema.hangtagPrintTask).where(inArray(schema.hangtagPrintTask.id, ids));
  }
  // 删除本次产生的打印任务/明细
  if (createdTaskIds.length) {
    await db.delete(schema.hangtagPrintItem).where(inArray(schema.hangtagPrintItem.taskId, createdTaskIds));
    await db.delete(schema.hangtagPrintTask).where(inArray(schema.hangtagPrintTask.id, createdTaskIds));
  }
  // 删除本次创建的模板
  if (createdTemplateIds.length) {
    await db.delete(schema.hangtagTemplate).where(inArray(schema.hangtagTemplate.id, createdTemplateIds));
  }
  await db.delete(schema.hangtagTemplate).where(sql`code LIKE ${PREFIX + '%'}`);
  // 删除种子 PO 与 SKU、款式、色号尺码组
  const po = await db.select({ id: schema.garmentPurchaseOrder.id })
    .from(schema.garmentPurchaseOrder).where(sql`order_no LIKE ${PREFIX + '%'}`);
  if (po.length) {
    const poIds = po.map((p) => p.id);
    await db.delete(schema.garmentPurchaseOrderSku).where(inArray(schema.garmentPurchaseOrderSku.orderId, poIds));
    await db.delete(schema.garmentPurchaseOrder).where(inArray(schema.garmentPurchaseOrder.id, poIds));
  }
  await db.delete(schema.sku).where(sql`style_no LIKE ${PREFIX + '%'}`);
  await db.delete(schema.style).where(sql`style_no LIKE ${PREFIX + '%'}`);
  await db.delete(schema.colorGroup).where(sql`code LIKE ${PREFIX + '%'}`);
  await db.delete(schema.sizeGroup).where(sql`code LIKE ${PREFIX + '%'}`);
}

async function snapshotCfg() {
  const rows = await db.select().from(schema.systemConfig)
    .where(sql`config_key IN ('UNIQUE_CODE_ENABLED','UNIQUE_CODE_LENGTH','UNIQUE_CODE_MAX')`);
  return new Map(rows.map((r) => [r.configKey, r.configValue]));
}
async function restoreCfg(snap) {
  // 测试用 config 键属于测试产物，统一在末尾硬删除，保证开发库干净
}

async function resetTestConfig() {
  for (const k of ['UNIQUE_CODE_ENABLED', 'UNIQUE_CODE_LENGTH', 'UNIQUE_CODE_MAX']) {
    await db.delete(schema.systemConfig).where(eq(schema.systemConfig.configKey, k));
  }
}

async function seedBase() {
  const [cg] = await db.insert(schema.colorGroup).values({
    code: PREFIX + 'CG01', name: '测试色组',
    colors: [{ name: '黑', value: '黑' }, { name: '白', value: '白' }],
  }).returning();
  const [sg] = await db.insert(schema.sizeGroup).values({
    code: PREFIX + 'SG01', name: '测试尺码组', sizes: ['S', 'M', 'L'],
  }).returning();
  const [st] = await db.insert(schema.style).values({
    styleNo: PREFIX + 'ST001', name: '测试款A',
    colorGroupId: cg.id, sizeGroupId: sg.id,
    tagPrice: '199', status: 'active',
  }).returning();
  const combos = [['黑', 'S'], ['黑', 'M'], ['白', 'M'], ['白', 'L']];
  let i = 0;
  for (const [c, s] of combos) {
    await db.insert(schema.sku).values({
      skuCode: PREFIX + 'SKU' + (++i), styleId: st.id, styleNo: st.styleNo,
      color: c, size: s, tagPrice: '199', status: 'active',
    });
  }
  return { cg, sg, st };
}

async function seedPO(styleId, styleNo) {
  const [po] = await db.insert(schema.garmentPurchaseOrder).values({
    orderNo: PREFIX + 'PO001', supplierId: '00000000-0000-0000-0000-000000000000',
    supplierName: '测试供应商', orderDate: '2026-09-20', status: 'confirmed',
  }).returning();
  const skus = await db.select().from(schema.sku).where(sql`style_id = ${styleId}`);
  const map = new Map(skus.map((s) => [`${s.color}|${s.size}`, s]));
  const rows = [['黑', 'S', 10], ['黑', 'M', 5], ['白', 'M', 8], ['白', 'L', 3]];
  for (const [c, s, q] of rows) {
    const sk = map.get(c + '|' + s);
    await db.insert(schema.garmentPurchaseOrderSku).values({
      orderId: po.id, styleId, styleNo, skuId: sk.id, color: c, size: s,
      quantity: String(q), price: '100', amount: String(q * 100),
    });
  }
  return po;
}

async function main() {
  const svc = new HangtagService(db);
  await ensureTables();
  await cleanup();

  const cfgSnap = await snapshotCfg();

  /* ---- 1) 唯一码参数配置校验 ---- */
  let threw = false;
  try { await svc.setUniqueCodeConfig({ enabled: true }); } catch (e) { threw = true; }
  assert(threw, '启用唯一码但未设长度时应报错');

  const cfg = await svc.setUniqueCodeConfig({ enabled: true, length: 8 });
  assert(cfg.enabled === true && cfg.length === 8, '设置启用+长度(8)成功', JSON.stringify(cfg));

  /* ---- 2) 模板 CRUD ---- */
  const tpl = await svc.createTemplate({
    code: PREFIX + 'T01', name: '标准吊牌', isDefault: true,
    contentConfig: {
      title: '品牌吊牌', footer: '谢谢惠顾',
      fields: [
        { key: 'styleNo', label: '款号', show: true },
        { key: 'tagPrice', label: '吊牌价', show: true },
        { key: 'colorSize', label: '颜色尺码', show: true },
      ],
    },
    styleConfig: { paper: 'A4', fontSize: 12, layout: 'vertical', columns: 2 },
  });
  createdTemplateIds.push(tpl.id);
  assert(!!tpl.id && tpl.code === PREFIX + 'T01', '创建模板成功');

  const tpl2 = await svc.createTemplate({ code: PREFIX + 'T02', name: '备用吊牌', isDefault: true });
  createdTemplateIds.push(tpl2.id);
  const list = await svc.listTemplates();
  const t1 = list.find((t) => t.id === tpl.id);
  assert(t1 && t1.isDefault === false, '新建第二个默认模板后，原默认自动取消', `t1.isDefault=${t1 && t1.isDefault}`);
  assert(list.length >= 2, '模板列表包含已建模板');

  const upd = await svc.updateTemplate(tpl.id, { name: '标准吊牌-改', remark: '测试' });
  assert(upd.name === '标准吊牌-改', '更新模板名称成功');

  /* ---- 3) 种子数据 ---- */
  const base = await seedBase();
  const po = await seedPO(base.st.id, base.st.styleNo);

  /* ---- 4) 按采购单生成二维表（自动带数量）---- */
  const gridPO = await svc.buildGridFromPurchaseOrder(po.orderNo);
  assert(gridPO.styles.length === 1, 'PO 二维表含 1 个款号');
  const g0 = gridPO.styles[0];
  const totalPO = g0.cells.reduce((a, b) => a + b.quantity, 0);
  assert(totalPO === 26, 'PO 自动导入数量合计=10+5+8+3=26', `实际 ${totalPO}`);
  assert(g0.cells.every((c) => c.quantity > 0), 'PO 每个单元格均带出数量');

  /* ---- 5) 按款号生成二维表（数量=0）---- */
  const gridStyle = await svc.buildGridFromStyle(base.st.styleNo);
  assert(gridStyle.colors.length === 2 && gridStyle.sizes.length === 3, '款号二维表 2色×3码');
  assert(gridStyle.cells.length === 6 && gridStyle.cells.every((c) => c.quantity === 0), '款号二维表数量为 0，待用户设置');

  /* ---- 6) 批量打印（不打印唯一码）---- */
  const printNoUc = await svc.printTags({
    templateId: tpl.id, sourceType: 'manual', sourceRef: base.st.styleNo,
    includeUniqueCode: false,
    items: [
      { styleNo: base.st.styleNo, styleName: base.st.name, color: '黑', size: 'S', quantity: 4 },
      { styleNo: base.st.styleNo, styleName: base.st.name, color: '白', size: 'M', quantity: 2 },
    ],
  });
  createdTaskIds.push(printNoUc.taskId);
  assert(printNoUc.totalQty === 6 && printNoUc.includeUniqueCode === false, '无唯一码打印：总数量=6');
  assert(printNoUc.uniqueCodeStart === null, '无唯一码时唯一码区间为 null');

  /* ---- 7) 唯一码自增连续性 ---- */
  await svc.setUniqueCodeMax(0); // 重置为从 1 起步
  const print1 = await svc.printTags({
    templateId: tpl.id, sourceType: 'purchase_order', sourceRef: po.orderNo,
    includeUniqueCode: true,
    items: [
      { styleNo: base.st.styleNo, color: '黑', size: 'S', quantity: 2 },
      { styleNo: base.st.styleNo, color: '白', size: 'L', quantity: 3 },
    ],
  });
  createdTaskIds.push(print1.taskId);
  assert(print1.totalQty === 5, '唯一码打印1 总数量=5');
  assert(print1.uniqueCodeStart === 1 && print1.uniqueCodeEnd === 5, '唯一码打印1 区间 1~5（从1起步）', `${print1.uniqueCodeStart}~${print1.uniqueCodeEnd}`);
  const cfgAfter1 = await svc.getUniqueCodeConfig();
  assert(cfgAfter1.max === 5, '打印1 后最大码=5', `max=${cfgAfter1.max}`);

  const print2 = await svc.printTags({
    templateId: tpl.id, sourceType: 'purchase_order', sourceRef: po.orderNo,
    includeUniqueCode: true,
    items: [
      { styleNo: base.st.styleNo, color: '黑', size: 'M', quantity: 4 },
      { styleNo: base.st.styleNo, color: '白', size: 'M', quantity: 1 },
    ],
  });
  createdTaskIds.push(print2.taskId);
  assert(print2.totalQty === 5, '唯一码打印2 总数量=5');
  assert(print2.uniqueCodeStart === 6 && print2.uniqueCodeEnd === 10, '唯一码打印2 区间 6~10（从最大码续增）', `${print2.uniqueCodeStart}~${print2.uniqueCodeEnd}`);
  const cfgAfter2 = await svc.getUniqueCodeConfig();
  assert(cfgAfter2.max === 10, '打印2 后最大码=10', `max=${cfgAfter2.max}`);

  // 严格连续性：两批不重叠、且严格递增
  assert(print1.uniqueCodeEnd + 1 === print2.uniqueCodeStart, '两批唯一码严格衔接（5+1=6）');
  // 明细级唯一码区间连续
  const items1 = await svc.getLogItems(print1.taskId);
  const ranges1 = items1.map((i) => [i.uniqueCodeStart, i.uniqueCodeEnd]).sort((a, b) => a[0] - b[0]);
  assert(ranges1[0][0] === 1 && ranges1[1][1] === 5 && ranges1[0][1] + 1 === ranges1[1][0], '明细级唯一码区间连续 1~2,3~5');
  // SKU 强绑定：打印即落 sku_id（不依赖出库时反查）
  assert(items1.length === 2 && items1.every((i) => i.skuId != null), '打印明细已强绑定 sku_id', JSON.stringify(items1.map((i) => i.skuId)));

  // 唯一码长度补零格式
  assert(svc.formatUniqueCode(1, 8) === '00000001' && svc.formatUniqueCode(10, 8) === '00000010', '唯一码按长度补零');

  /* ---- 8) 未启用时禁止打印唯一码（关闭需 force，因已有最大码=10）---- */
  await svc.setUniqueCodeConfig({ enabled: false, length: 8, force: true });
  let threw2 = false;
  try {
    await svc.printTags({
      templateId: tpl.id, sourceType: 'manual', sourceRef: 'x',
      includeUniqueCode: true, items: [{ styleNo: 'x', color: '黑', size: 'S', quantity: 1 }],
    });
  } catch (e) { threw2 = true; }
  assert(threw2, '未启用唯一码时打印唯一码应报错');

  /* ---- 9) 打印日志与 CSV ---- */
  const logs = await svc.listLogs();
  const myLogs = logs.filter((l) => createdTaskIds.includes(l.id));
  assert(myLogs.length >= 3, '日志列表包含本次打印任务');
  const l0 = myLogs[0];
  assert(!!l0.printDate && !!l0.templateName && !!l0.totalQty && 'contentSnapshot' in l0, '日志含打印日期/模板/数量/内容快照');
  const itemsLog = await svc.getLogItems(print1.taskId);
  assert(itemsLog.length === 2, '打印明细可回查');

  const csv = svc.toLogsCsv(myLogs);
  assert(csv.startsWith('﻿'), 'CSV 含 UTF-8 BOM');
  assert(csv.includes('打印日期') && csv.includes('唯一码区间') && csv.includes('打印数量'), 'CSV 表头完整');
  assert(csv.includes('1~5') && csv.includes('6~10'), 'CSV 包含唯一码区间');

  await cleanup();
  await resetTestConfig();

  await client.end();
  console.log('\n================ 联调结果 ================');
  console.log(`通过 ${R.checks.filter((c) => c.ok).length}/${R.checks.length}`);
  for (const c of R.checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.issue}${c.detail ? '  → ' + c.detail : ''}`);
  }
  if (R.errors.length) {
    console.log('\n存在失败项，退出码 1');
    process.exit(1);
  }
  console.log('\n全部通过 ✅');
}

main().catch((e) => {
  console.error('运行期错误：', e);
  process.exit(2);
});
