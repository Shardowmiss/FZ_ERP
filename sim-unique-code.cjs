/* 唯一码扫码录入 + 出库校验 联调脚本
 * ---------------------------------------------------------------------------
 * 直连数据库 + 实例化 HangtagService / UniqueCodeService，验证：
 *   1) 未启用唯一码时 scanOutbound 返回 disabled
 *   2) 扫码解析 parseTagCode（启用后识别款色码 + 唯一码，反查 sku）
 *   3) 采购入库登记 registerInbound（写入 unique_code_stock）
 *   4) 出库扫码正常通过（状态 in_stock→out，记 doc_unique_code）
 *   5) 三拒绝：not_in_stock(未入库) / wrong_warehouse(非本仓) / not_available(已出)
 *   6) 款色码不符 style_mismatch
 *   7) 同单据已扫去重 already_scanned
 *   8) 唯一码自增连续性（printTags 从 1 起步、续增）+ 并发打印不重叠（事务行锁）
 *   9) 状态查询 getUniqueCodeStock
 *
 * 用法：
 *   npm run build:server && node sim-unique-code.cjs
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
// 唯一码引擎已拆成 6 个职责域服务，门面只做委托；脚本仍从门面拿全量能力，
// 用 createUniqueCodeService(db) 一行完成装配（与 Nest 内部装配顺序一致）。
const { createUniqueCodeService } = require('./dist/server/modules/unique-code/unique-code.service.js');
const { OpsService } = require('./dist/server/modules/ops/ops.service.js');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });

const R = { errors: [], checks: [] };
function assert(cond, issue, detail) {
  if (cond) { R.checks.push({ ok: true, issue }); return true; }
  R.checks.push({ ok: false, issue, detail: detail || '' });
  R.errors.push(issue);
  return false;
}
const PREFIX = 'FF_UC_';
const createdWarehouseIds = [];

async function ensureTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS unique_code_stock (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      unique_code varchar(64) NOT NULL,
      numeric_value bigint,
      sku_id uuid NOT NULL,
      style_no varchar(50) NOT NULL,
      color varchar(50) NOT NULL,
      size varchar(50) NOT NULL,
      warehouse_id uuid NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'in_stock',
      inbound_doc_type varchar(40),
      inbound_doc_id varchar(64),
      inbound_at timestamptz(3),
      outbound_doc_type varchar(40),
      outbound_doc_id varchar(64),
      outbound_at timestamptz(3),
      remark text,
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by text,
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS unique_code_stock_unique_code_idx ON unique_code_stock(unique_code);

    CREATE TABLE IF NOT EXISTS doc_unique_code (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_type varchar(40) NOT NULL,
      doc_id varchar(64) NOT NULL,
      doc_item_id varchar(64),
      unique_code varchar(64) NOT NULL,
      sku_id uuid,
      style_no varchar(50),
      color varchar(50),
      size varchar(50),
      warehouse_id uuid,
      scan_type varchar(20) NOT NULL,
      scan_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by text,
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by text
    );
    -- 生命周期流水需支持同单据同码多条动作(outbound/sold/returned)，唯一键须含 scan_type
    DROP INDEX IF EXISTS uniq_doc_uc;
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_uc ON doc_unique_code(doc_type, doc_id, unique_code, scan_type);
    ALTER TABLE hangtag_print_item ADD COLUMN IF NOT EXISTS sku_id uuid;

    -- P2 归档表（冷热分离）：镜像 doc_unique_code + archived_at；无唯一约束（归档不再做幂等/去重）
    CREATE TABLE IF NOT EXISTS doc_unique_code_archive (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_type varchar(40) NOT NULL,
      doc_id varchar(64) NOT NULL,
      doc_item_id varchar(64),
      unique_code varchar(64) NOT NULL,
      sku_id uuid,
      style_no varchar(50),
      color varchar(50),
      size varchar(50),
      warehouse_id uuid,
      scan_type varchar(20) NOT NULL,
      operator_id varchar(64),
      scan_at timestamptz(3) NOT NULL,
      archived_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by text,
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by text
    );
    CREATE INDEX IF NOT EXISTS idx_duca_code ON doc_unique_code_archive(unique_code);
    CREATE INDEX IF NOT EXISTS idx_duca_code_time ON doc_unique_code_archive(unique_code, scan_at);
    CREATE INDEX IF NOT EXISTS idx_duca_sku_time ON doc_unique_code_archive(sku_id, scan_at);
    CREATE INDEX IF NOT EXISTS idx_duca_doc ON doc_unique_code_archive(doc_type, doc_id);
  `);
}

async function cleanup() {
  // 唯一码相关表（按前缀）
  await db.delete(schema.uniqueCodeStock).where(
    sql`unique_code LIKE ${PREFIX + '%'} OR inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`,
  );
  await db.delete(schema.docUniqueCode).where(
    sql`doc_id LIKE ${PREFIX + '%'} OR unique_code LIKE ${PREFIX + '%'}`,
  );
  await db.delete(schema.docUniqueCodeArchive).where(
    sql`doc_id LIKE ${PREFIX + '%'} OR unique_code LIKE ${PREFIX + '%'}`,
  );
  // 本次产生 hangtag 打印任务/明细/模板
  const ffTasks = await db.select({ id: schema.hangtagPrintTask.id })
    .from(schema.hangtagPrintTask).where(sql`source_ref LIKE ${PREFIX + '%'}`);
  if (ffTasks.length) {
    const ids = ffTasks.map((t) => t.id);
    await db.delete(schema.hangtagPrintItem).where(inArray(schema.hangtagPrintItem.taskId, ids));
    await db.delete(schema.hangtagPrintTask).where(inArray(schema.hangtagPrintTask.id, ids));
  }
  await db.delete(schema.hangtagTemplate).where(sql`code LIKE ${PREFIX + '%'}`);
  // 种子数据
  if (createdWarehouseIds.length) {
    await db.delete(schema.warehouse).where(inArray(schema.warehouse.id, createdWarehouseIds));
  }
  await db.delete(schema.sku).where(sql`style_no LIKE ${PREFIX + '%'}`);
  await db.delete(schema.style).where(sql`style_no LIKE ${PREFIX + '%'}`);
  await db.delete(schema.colorGroup).where(sql`code LIKE ${PREFIX + '%'}`);
  await db.delete(schema.sizeGroup).where(sql`code LIKE ${PREFIX + '%'}`);
  // 测试用 config 键（测试产物，硬删除保持开发库干净）
  for (const k of ['UNIQUE_CODE_ENABLED', 'UNIQUE_CODE_LENGTH', 'UNIQUE_CODE_MAX']) {
    await db.delete(schema.systemConfig).where(eq(schema.systemConfig.configKey, k));
  }
}

async function resetTestConfig() {
  for (const k of ['UNIQUE_CODE_ENABLED', 'UNIQUE_CODE_LENGTH', 'UNIQUE_CODE_MAX']) {
    await db.delete(schema.systemConfig).where(eq(schema.systemConfig.configKey, k));
  }
}

async function seedBase() {
  const [whA] = await db.insert(schema.warehouse).values({
    code: PREFIX + 'WHA', name: PREFIX + '仓A', type: 'storage', status: 'active',
  }).returning();
  const [whB] = await db.insert(schema.warehouse).values({
    code: PREFIX + 'WHB', name: PREFIX + '仓B', type: 'storage', status: 'active',
  }).returning();
  createdWarehouseIds.push(whA.id, whB.id);
  const [cg] = await db.insert(schema.colorGroup).values({
    code: PREFIX + 'CG', name: '测试色组', colors: [{ name: '红', value: '红' }, { name: '蓝', value: '蓝' }],
  }).returning();
  const [sg] = await db.insert(schema.sizeGroup).values({
    code: PREFIX + 'SG', name: '测试尺码组', sizes: ['M', 'L'],
  }).returning();
  const [st] = await db.insert(schema.style).values({
    styleNo: PREFIX + 'ST001', name: '测试款', tagPrice: '199',
    colorGroupId: cg.id, sizeGroupId: sg.id, status: 'active',
  }).returning();
  const [sku1] = await db.insert(schema.sku).values({
    skuCode: PREFIX + 'SKU1', styleId: st.id, styleNo: st.styleNo,
    color: '红', size: 'M', tagPrice: '199', status: 'active',
  }).returning();
  const [sku2] = await db.insert(schema.sku).values({
    skuCode: PREFIX + 'SKU2', styleId: st.id, styleNo: st.styleNo,
    color: '蓝', size: 'L', tagPrice: '199', status: 'active',
  }).returning();
  return { whA, whB, st, sku1, sku2 };
}

async function main() {
  await resetTestConfig();
  await ensureTables();

  const hangtag = new HangtagService(db);
  const uc = createUniqueCodeService(db);

  const UC1 = PREFIX + 'U00000001';
  const UC2 = PREFIX + 'U00000002';
  const UCX = PREFIX + 'U99999999';

  // 1) 未启用唯一码时 scanOutbound 应返回 disabled
  {
    const r = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT_X', warehouseId: '00000000-0000-0000-0000-000000000000',
      styleNo: PREFIX + 'ST001', color: '红', size: 'M', uniqueCode: UC1,
    });
    assert(r.ok === false && r.reason === 'disabled', '未启用唯一码时 scanOutbound 返回 disabled');
  }

  // 启用唯一码 + 长度
  await hangtag.setUniqueCodeConfig({ enabled: true, length: 8 });

  const base = await seedBase();

  // 2) 扫码解析（需 sku 已存在）
  {
    const p = await uc.parseTagCode(`${base.st.styleNo}|红|M|${UC1}`);
    assert(p.matched && p.skuId != null && p.uniqueCode === UC1,
      'parseTagCode 启用后识别款色码 + 唯一码并反查 sku', JSON.stringify(p));
    const bad = await uc.parseTagCode(`${base.st.styleNo}|红|M`);
    assert(bad.matched === false, 'parseTagCode 启用后缺唯一码段应失败');
    const noSku = await uc.parseTagCode(`${PREFIX}NOPE|红|M|${UCX}`);
    assert(noSku.matched === false, 'parseTagCode 款色码无效应失败');
  }

  // 3) 采购入库登记
  {
    const reg = await uc.registerInbound({
      docType: 'purchase_inbound', docId: PREFIX + 'IN1', warehouseId: base.whA.id,
      items: [
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: UC1 },
        { styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: UC2 },
      ],
    });
    assert(reg.enabled && reg.registered === 2, 'registerInbound 登记 2 个唯一码', JSON.stringify(reg));
    const rows = await db.select().from(schema.uniqueCodeStock)
      .where(sql`unique_code LIKE ${PREFIX + '%'}`);
    assert(rows.length === 2 && rows.every((r) => r.status === 'in_stock' && r.warehouseId === base.whA.id),
      'unique_code_stock 写入 2 条 in_stock@仓A');
  }

  // 4) 正常出库扫码
  {
    const r = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT1', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: UC1,
    });
    assert(r.ok === true && r.data.skuId === base.sku1.id, '正常出库扫码通过且返回正确 sku', JSON.stringify(r));
    const stock = await uc.getUniqueCodeStock(UC1);
    assert(stock && stock.status === 'out' && stock.outboundDocId === PREFIX + 'OUT1',
      '出库后 unique_code_stock 状态变 out 且记录出库单据');
    const doc = await db.select().from(schema.docUniqueCode)
      .where(sql`doc_id = ${PREFIX + 'OUT1'} AND unique_code = ${UC1}`);
    assert(doc.length === 1 && doc[0].scanType === 'outbound', 'doc_unique_code 记录 1 条 outbound 流水');
  }

  // 5) 三拒绝 + 款色码校验 + 去重
  {
    const r1 = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT2', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: UCX,
    });
    assert(r1.ok === false && r1.reason === 'not_in_stock', '拒绝：未入库唯一码（库存不存在）', JSON.stringify(r1));

    const r2 = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT3', warehouseId: base.whB.id,
      styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: UC2,
    });
    assert(r2.ok === false && r2.reason === 'wrong_warehouse', '拒绝：非本仓（在仓A，从仓B出）', JSON.stringify(r2));

    const r3 = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT4', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: UC1,
    });
    assert(r3.ok === false && r3.reason === 'not_available', '拒绝：已出库唯一码再次出库', JSON.stringify(r3));

    const r4 = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT5', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: UC2,
    });
    assert(r4.ok === false && r4.reason === 'style_mismatch', '拒绝：款色码不符（蓝L码传红M）', JSON.stringify(r4));

    // 去重：在同一新单据内对同一在库码扫两次（UC2 此时仍 in_stock@whA）
    const d1 = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT_DUP', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: UC2,
    });
    assert(d1.ok === true, '去重测试：首次扫描通过', JSON.stringify(d1));
    const d2 = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT_DUP', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: UC2,
    });
    assert(d2.ok === false && d2.reason === 'already_scanned', '拒绝：同单据重复扫码（去重）', JSON.stringify(d2));
  }

  // 9) 状态查询
  {
    const s = await uc.getUniqueCodeStock(UC2);
    assert(s && s.status === 'out' && s.warehouseId === base.whA.id,
      'getUniqueCodeStock 返回正确状态与仓库（OUT_DUP 后 UC2 已出）', JSON.stringify(s));
  }

  // 8) 唯一码自增连续性（printTags）
  {
    const [tpl] = await db.insert(schema.hangtagTemplate).values({
      code: PREFIX + 'TPL', name: '测试模板', contentConfig: { fields: [] }, styleConfig: {},
      isDefault: false, status: 'active',
    }).returning();
    const p1 = await hangtag.printTags({
      templateId: tpl.id, sourceType: 'manual', sourceRef: PREFIX + 'ST001',
      includeUniqueCode: true, items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', quantity: 3 }],
    });
    const p2 = await hangtag.printTags({
      templateId: tpl.id, sourceType: 'manual', sourceRef: PREFIX + 'ST001',
      includeUniqueCode: true, items: [{ styleNo: base.st.styleNo, color: '蓝', size: 'L', quantity: 2 }],
    });
    assert(p1.uniqueCodeStart === 1 && p1.uniqueCodeEnd === 3 && p2.uniqueCodeStart === 4 && p2.uniqueCodeEnd === 5,
      'printTags 唯一码从 1 起步并严格续增（1-3 / 4-5）', JSON.stringify([p1, p2]));
  }

  // 8b) 并发打印不重叠（验证事务行锁修复并发重复分配）
  {
    await hangtag.setUniqueCodeMax(0);
    const tplId = (await db.select({ id: schema.hangtagTemplate.id }).from(schema.hangtagTemplate).where(sql`code = ${PREFIX + 'TPL'}`))[0].id;
    const mkItems = (q) => ([{ styleNo: base.st.styleNo, color: '红', size: 'M', quantity: q }]);
    const a = hangtag.printTags({
      templateId: tplId, sourceType: 'manual', sourceRef: PREFIX + 'CONC', includeUniqueCode: true, items: mkItems(3),
    });
    const b = hangtag.printTags({
      templateId: tplId, sourceType: 'manual', sourceRef: PREFIX + 'CONC', includeUniqueCode: true, items: mkItems(2),
    });
    const [ra, rb] = await Promise.all([a, b]);
    const noOverlap = (ra.uniqueCodeEnd < rb.uniqueCodeStart) || (rb.uniqueCodeEnd < ra.uniqueCodeStart);
    const max = Math.max(ra.uniqueCodeEnd, rb.uniqueCodeEnd);
    assert(noOverlap && max === 5, '并发打印唯一码区间不重叠且合计 5（事务行锁生效）', JSON.stringify([ra, rb]));
  }

  // 10) 结算核销(sold) + 退货回滚(returned) 状态机
  {
    const v = await uc.verifySold({
      docType: 'retail', docId: PREFIX + 'RT1', uniqueCode: UC1,
    });
    assert(v.ok === true, 'verifySold 将 out→sold 成功', JSON.stringify(v));
    const sSold = await uc.getUniqueCodeStock(UC1);
    assert(sSold && sSold.status === 'sold', '核销后状态为 sold');
    const soldDoc = await db.select().from(schema.docUniqueCode)
      .where(sql`unique_code = ${UC1} AND scan_type = 'sold'`);
    assert(soldDoc.length === 1, '记录 sold 流水');

    const ret = await uc.returnUniqueCode({
      docType: 'sales_return', docId: PREFIX + 'SR1', warehouseId: base.whA.id, uniqueCode: UC1,
    });
    assert(ret.ok === true, 'returnUniqueCode 将 sold→in_stock 成功', JSON.stringify(ret));
    const sBack = await uc.getUniqueCodeStock(UC1);
    assert(sBack && sBack.status === 'in_stock' && sBack.outboundDocId === null,
      '退货后状态回 in_stock 且清空出库字段', JSON.stringify(sBack));
    const retDoc = await db.select().from(schema.docUniqueCode)
      .where(sql`unique_code = ${UC1} AND scan_type = 'returned'`);
    assert(retDoc.length === 1, '记录 returned 流水');

    // 非法回滚：对 in_stock 的码再退货应拒绝
    const badRet = await uc.returnUniqueCode({
      docType: 'sales_return', docId: PREFIX + 'SRX', warehouseId: base.whA.id, uniqueCode: UC1,
    });
    assert(badRet.ok === false && badRet.reason === 'invalid_state', '拒绝：对 in_stock 唯一码重复退货', JSON.stringify(badRet));
  }

  // 11) ops 唯一码对账校验器
  {
    const ops = new OpsService(db);
    // 构造一处不一致：库存行无入库登记
    await db.insert(schema.uniqueCodeStock).values({
      uniqueCode: PREFIX + 'ORPHAN', skuId: base.sku1.id, styleNo: base.st.styleNo,
      color: '红', size: 'M', warehouseId: base.whA.id, status: 'in_stock',
    });
    const rep = await ops.runValidation({ checks: ['UNIQUE_CODE_RECONCILE'] });
    const chk = rep.checks.find((c) => c.code === 'UNIQUE_CODE_RECONCILE');
    assert(chk && chk.issueCount >= 1, 'ops 对账校验器检出缺入库登记的不一致', JSON.stringify(chk && chk.issues));
    // 清理孤儿并复验
    await db.delete(schema.uniqueCodeStock).where(eq(schema.uniqueCodeStock.uniqueCode, PREFIX + 'ORPHAN'));
    const rep2 = await ops.runValidation({ checks: ['UNIQUE_CODE_RECONCILE'] });
    const chk2 = rep2.checks.find((c) => c.code === 'UNIQUE_CODE_RECONCILE');
    assert(chk2 && chk2.issueCount === 0, '清理孤儿后无不一致', JSON.stringify(chk2));
  }

  // 12) 配置变更保护
  {
    // 已有 max=5、length=8：改长度与既有不一致应拒绝（rule2）
    let threwLen = false;
    try { await hangtag.setUniqueCodeConfig({ enabled: true, length: 4 }); } catch (e) { threwLen = true; }
    assert(threwLen, '启用后改长度与既有(8)不一致应拒绝');
    // 关闭开关但存在已分配码，应拒绝（rule3，需 force）
    let threwOff = false;
    try { await hangtag.setUniqueCodeConfig({ enabled: false, length: 8 }); } catch (e) { threwOff = true; }
    assert(threwOff, '关闭开关且存在已分配码应拒绝（需 force）');
    const off = await hangtag.setUniqueCodeConfig({ enabled: false, length: 8, force: true });
    assert(off.enabled === false, 'force 后可关闭开关（历史码数据保留）');
  }
}

main()
  .then(async () => {
    await cleanup();
    const pass = R.checks.filter((c) => c.ok).length;
    console.log(`\n=== 联调结果：${pass}/${R.checks.length} 通过，失败 ${R.errors.length} ===`);
    for (const c of R.checks) {
      console.log(`${c.ok ? '✅' : '❌'} ${c.issue}${c.ok ? '' : '  -> ' + c.detail}`);
    }
    await client.end();
    process.exit(R.errors.length ? 1 : 0);
  })
  .catch(async (e) => {
    console.error('运行异常：', e);
    try { await cleanup(); } catch (_) {}
    await client.end();
    process.exit(1);
  });
