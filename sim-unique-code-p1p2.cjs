/* 唯一码 P1/P2 联调脚本（前缀/校验位 + 单据网关 + 盘点对账 + 生命周期报表 + ops 聚合对账）
 * ---------------------------------------------------------------------------
 * 直连数据库 + 实例化 HangtagService / UniqueCodeService / OpsService，验证：
 *  P2-1 前缀/校验位防伪：buildUniqueCode/validateChecksum/extractNumeric；开启后扫描校验位；改防伪需 force
 *  P1-1 单据网关：scanDocument(inbound/outbound/return/sold)、scanTransfer、reconcileStocktake
 *  P2-2 生命周期报表：getLifecycleReport 按状态/仓库/款号分布 + 异常概览
 *  P1-2 ops 聚合对账：UNIQUE_CODE_AGG_RECONCILE 检出件级↔聚合库存漂移
 *
 * 用法：
 *   npm run build:server && node sim-unique-code-p1p2.cjs
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
// 唯一码引擎已拆成 6 个职责域服务：门面 unique-code.service.ts 只做委托，
// 但对外仍导出全部契约（buildUniqueCode / validateChecksum / createUniqueCodeService），
// 因此本脚本的引用路径与调用方式保持不变。
const { createUniqueCodeService, buildUniqueCode, checksumDigit, extractNumeric, validateChecksum } =
  require('./dist/server/modules/unique-code/unique-code.service.js');
const { OpsService } = require('./dist/server/modules/ops/ops.service.js');
const { TracePublicController } = require('./dist/server/modules/unique-code/trace-public.controller.js');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });

const R = { errors: [], checks: [] };
function assert(cond, issue, detail) {
  if (cond) { R.checks.push({ ok: true, issue }); return true; }
  R.checks.push({ ok: false, issue, detail: detail || '' });
  R.errors.push(issue);
  return false;
}
const PREFIX = 'FF_P1_';
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
      operator_id varchar(64),
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by text,
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by text
    );
    -- 历史表可能缺 operator_id（早期建表），幂等补齐
    ALTER TABLE doc_unique_code ADD COLUMN IF NOT EXISTS operator_id varchar(64);
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

// 测试夹具前缀：本脚本 FF_P1_，其它历史联调脚本 FF_ / FF- / FF_UC_ / ST-SPRING 等
const DOC_PREFIXES = ['FF_P1_%', 'FF_%', 'FF-%', 'ST_%', 'ST-%'];
const CODE_PREFIXES = ['FF_P1_%', 'FF_%', 'FF-%', 'ST_%', 'ST-%', 'GM26%'];
const STYLE_PREFIXES = ['FF_P1_%', 'FF_%', 'FF-%', 'ST_%', 'ST-%'];

/**
 * 彻底清理测试残留。要点：
 *  - 唯一码本身是 GM26 前缀（或纯数字），不以 FF_ 开头，因此必须按单据号列(inbound/outbound/doc)清理，
 *    不能只按 unique_code 前缀匹配，否则历史码清不掉会污染后续断言。
 *  - 覆盖本脚本与历史脚本（sim-hangtag/sim-unique-code）的夹具前缀，保证 ops 全局校验项只看到本脚本数据。
 */
/** 生成 SQL 字面量数组（常量前缀，安全） */
function arrLit(arr) {
  return 'ARRAY[' + arr.map((s) => "'" + String(s).replace(/'/g, "''") + "'").join(',') + ']';
}

async function cleanup() {
  const DP = arrLit(DOC_PREFIXES);
  const CP = arrLit(CODE_PREFIXES);
  const SP = arrLit(STYLE_PREFIXES);
  await db.execute(sql.raw(`
    DELETE FROM unique_code_stock
    WHERE inbound_doc_id LIKE ANY(${DP})
       OR outbound_doc_id LIKE ANY(${DP})
       OR unique_code LIKE ANY(${CP})
  `));
  await db.execute(sql.raw(`
    DELETE FROM doc_unique_code
    WHERE doc_id LIKE ANY(${DP})
       OR unique_code LIKE ANY(${CP})
  `));
  await db.execute(sql.raw(`
    DELETE FROM doc_unique_code_archive
    WHERE doc_id LIKE ANY(${DP})
       OR unique_code LIKE ANY(${CP})
  `));
  // 溯源单据号解析测试插入的采购单（id 用本脚本前缀，安全清理）
  await db.execute(sql`DELETE FROM garment_purchase_order WHERE id::text LIKE ${PREFIX + '%'}`);
  const ffTasks = await db.select({ id: schema.hangtagPrintTask.id })
    .from(schema.hangtagPrintTask).where(sql.raw(`source_ref LIKE ANY(${DP})`));
  if (ffTasks.length) {
    const ids = ffTasks.map((t) => t.id);
    await db.delete(schema.hangtagPrintItem).where(inArray(schema.hangtagPrintItem.taskId, ids));
    await db.delete(schema.hangtagPrintTask).where(inArray(schema.hangtagPrintTask.id, ids));
  }
  await db.delete(schema.hangtagTemplate).where(sql.raw(`code LIKE ANY(${DP})`));
  // 聚合库存只清理本脚本的（其它脚本的 inventory_stock 属其自有夹具，不越界删除）
  await db.execute(sql`DELETE FROM inventory_stock WHERE sku_id IN (SELECT id FROM sku WHERE style_no LIKE ${PREFIX + '%'})`);
  // 主数据（仓库/SKU/款式/色组尺码组）只清理本脚本创建的：
  // 其它脚本的仓库与 SKU 可能被子表（inventory_stocktake、sales_order_item 等）引用，越界删除会触发 FK 约束。
  await db.delete(schema.warehouse).where(sql`code LIKE ${PREFIX + '%'}`);
  await db.delete(schema.sku).where(sql`style_no LIKE ${PREFIX + '%'}`);
  await db.delete(schema.style).where(sql`style_no LIKE ${PREFIX + '%'}`);
  await db.delete(schema.colorGroup).where(sql`code LIKE ${PREFIX + '%'}`);
  await db.delete(schema.sizeGroup).where(sql`code LIKE ${PREFIX + '%'}`);
  for (const k of ['UNIQUE_CODE_ENABLED', 'UNIQUE_CODE_LENGTH', 'UNIQUE_CODE_MAX', 'UNIQUE_CODE_PREFIX', 'UNIQUE_CODE_CHECKSUM', 'UNIQUE_CODE_ARCHIVE_DAYS']) {
    await db.delete(schema.systemConfig).where(eq(schema.systemConfig.configKey, k));
  }
}

async function seedBase() {
  const supplierId = '00000000-0000-0000-0000-0000000000a1';
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
  return { whA, whB, st, sku1, sku2, supplierId };
}

async function main() {
  await ensureTables();
  await cleanup();

  const hangtag = new HangtagService(db);
  const uc = createUniqueCodeService(db);
  const ops = new OpsService(db);

  // ===== P2-1 前缀/校验位工具函数 =====
  {
    const code = buildUniqueCode(1, 6, 'GM26', true); // GM26000001 + 校验位
    assert(code.startsWith('GM26') && code.length === 6 + 4 + 1, 'buildUniqueCode 生成 前缀+补零+校验位', code);
    assert(validateChecksum(code) === true, 'validateChecksum 合法码通过', code);
    assert(extractNumeric(code, 'GM26', true) === 1, 'extractNumeric 还原数字部分', String(extractNumeric(code, 'GM26', true)));
    const tampered = code.slice(0, -1) + (code.slice(-1) === '0' ? '1' : '0');
    assert(validateChecksum(tampered) === false, 'validateChecksum 篡改校验位应失败', tampered);
    // 无前缀/无校验位时与旧行为一致
    const plain = buildUniqueCode(42, 6, null, false);
    assert(plain === '000042', '无前缀/无校验位保持纯补零（向后兼容）', plain);
  }

  await hangtag.setUniqueCodeConfig({ enabled: true, length: 6, prefix: 'GM26', checksum: true });
  const base = await seedBase();

  // ===== P2-1 端到端：开启校验位后扫描合法码通过、篡改码被拒 =====
  {
    const c1 = buildUniqueCode(1, 6, 'GM26', true);
    const c2 = buildUniqueCode(2, 6, 'GM26', true);
    const reg = await uc.registerInbound({
      docType: 'purchase_inbound', docId: PREFIX + 'IN1', warehouseId: base.whA.id,
      items: [
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c1 },
        { styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: c2 },
      ],
    });
    assert(reg.registered === 2, '注册含前缀+校验位的唯一码 2 个', JSON.stringify(reg));
    const rows = await db.select().from(schema.uniqueCodeStock).where(sql`unique_code LIKE ${PREFIX + '%'}`);
    assert(rows.every((r) => r.status === 'in_stock'), '入库后在库状态正确');
    assert(rows.every((r) => typeof r.numericValue === 'number' && r.numericValue > 0), 'numeric_value 正确还原（含前缀/校验位）');

    const ok = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT1', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c1,
    });
    assert(ok.ok === true, '合法含校验位码出库通过', JSON.stringify(ok));

    const bad = c1.slice(0, -1) + (c1.slice(-1) === '0' ? '1' : '0');
    const rej = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT2', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: bad,
    });
    assert(rej.ok === false && rej.reason === 'bad_checksum', '篡改校验位的码出库被拒(bad_checksum)', JSON.stringify(rej));

    // parse 校验
    const pBad = await uc.parseTagCode(`${base.st.styleNo}|红|M|${bad}`, { validateChecksum: true });
    assert(pBad.matched === false, 'parse 开启校验位后篡改码解析失败');
  }

  // ===== P2-1 防伪变更保护：已发码后改 checksum 需 force =====
  {
    let threw = false;
    try {
      await hangtag.setUniqueCodeConfig({ enabled: true, length: 6, checksum: false });
    } catch { threw = true; }
    assert(threw === true, '已发码后变更校验位需 force 否则拒绝');
    const ok2 = await hangtag.setUniqueCodeConfig({ enabled: true, length: 6, checksum: false, force: true });
    assert(ok2.checksum === false, '带 force 可变更校验位开关');
    // 恢复
    await hangtag.setUniqueCodeConfig({ enabled: true, length: 6, prefix: 'GM26', checksum: true, force: true });
  }

  // ===== P1-1 scanDocument 统一网关（outbound / return / sold） =====
  {
    const c2 = buildUniqueCode(2, 6, 'GM26', true);
    const out = await uc.scanDocument({
      direction: 'outbound', docType: 'sales_outbound', docId: PREFIX + 'DOC_OUT', warehouseId: base.whA.id,
      items: [{ styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: c2 }],
    });
    assert(out.okCount === 1 && out.results[0].ok === true, 'scanDocument(outbound) 路由并出库成功', JSON.stringify(out));

    const sold = await uc.scanDocument({
      direction: 'sold', docType: 'retail', docId: PREFIX + 'DOC_SOLD',
      items: [{ uniqueCode: c2 }],
    });
    assert(sold.results[0].ok === true, 'scanDocument(sold) 路由并核销成功');

    const ret = await uc.scanDocument({
      direction: 'return', docType: 'sales_return', docId: PREFIX + 'DOC_RET', warehouseId: base.whA.id,
      items: [{ uniqueCode: c2 }],
    });
    assert(ret.results[0].ok === true, 'scanDocument(return) 路由并回库成功');
    const sBack = await uc.getUniqueCodeStock(c2);
    assert(sBack && sBack.status === 'in_stock', '回库后状态为 in_stock');
  }

  // ===== P1-1 scanTransfer 调拨（源仓出 + 目标仓入） =====
  {
    const c3 = buildUniqueCode(3, 6, 'GM26', true);
    await uc.registerInbound({
      docType: 'purchase_inbound', docId: PREFIX + 'IN2', warehouseId: base.whA.id,
      items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c3 }],
    });
    const tr = await uc.scanTransfer({
      docId: PREFIX + 'TR1', fromWarehouseId: base.whA.id, toWarehouseId: base.whB.id,
      items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c3 }],
    });
    assert(tr.allOk === true, 'scanTransfer 调拨整体成功', JSON.stringify(tr));
    const s = await uc.getUniqueCodeStock(c3);
    assert(s && s.status === 'in_stock' && s.warehouseId === base.whB.id, '调拨后唯一码在库于目标仓B', JSON.stringify(s));
    // 跨仓出库校验：在仓B从仓A出应 wrong_warehouse
    const rej = await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'OUT_T', warehouseId: base.whA.id,
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c3,
    });
    assert(rej.ok === false && rej.reason === 'wrong_warehouse', '调拨后在库仓B，从仓A出应 wrong_warehouse');
  }

  // ===== P1-1 reconcileStocktake 盘点对账（隔离场景：仅 c4/c5 在库于仓A） =====
  {
    // 隔离：清空 FF_P1_ 件级库存与流水，避免 c2(已回库) 等历史码干扰
    // 注意：唯一码本身是 GM26 前缀，须按单据号列清理
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code WHERE doc_id LIKE ${PREFIX + '%'}`);
    const c4 = buildUniqueCode(4, 6, 'GM26', true);
    const c5 = buildUniqueCode(5, 6, 'GM26', true);
    await uc.registerInbound({
      docType: 'purchase_inbound', docId: PREFIX + 'IN3', warehouseId: base.whA.id,
      items: [
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c4 },
        { styleNo: base.st.styleNo, color: '蓝', size: 'L', uniqueCode: c5 },
      ],
    });
    // 实扫只扫到 c4（c5 盘亏），并多扫一个不存在的码 c6（盘盈）
    const c6 = buildUniqueCode(6, 6, 'GM26', true);
    const rec = await uc.reconcileStocktake({
      docId: PREFIX + 'STK1', warehouseId: base.whA.id,
      scannedCodes: [c4, c6],
    });
    assert(rec.expectedCount === 2, '盘点应盘范围为 2 件（c4/c5）', JSON.stringify(rec));
    assert(rec.missing.length === 1 && rec.missing[0].uniqueCode === c5, '盘点检出盘亏（c5 未扫）', JSON.stringify(rec.missing));
    assert(rec.extra.length === 1 && rec.extra[0] === c6, '盘点检出盘盈（c6 不在库）', JSON.stringify(rec.extra));
  }

  // ===== P2-2 生命周期报表 =====
  {
    const rep = await uc.getLifecycleReport();
    assert(rep.enabled === true && Array.isArray(rep.byStatus), '生命周期报表返回按状态分布');
    const total = rep.byStatus.reduce((a, b) => a + b.count, 0);
    assert(total >= 2, '生命周期报表覆盖多状态统计', JSON.stringify(rep.byStatus));
    assert(typeof rep.anomalies.stuckInStock === 'number', '报表含异常概览');
  }

  // ===== 单据服务接入：verifySoldByDoc / returnDocUniqueCodes（同事务批量核销与回库） =====
  {
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code WHERE doc_id LIKE ${PREFIX + '%'}`);
    const d1 = buildUniqueCode(11, 6, 'GM26', true);
    const d2 = buildUniqueCode(12, 6, 'GM26', true);
    await uc.registerInbound({
      docType: 'purchase_inbound', docId: PREFIX + 'DIN1', warehouseId: base.whA.id,
      items: [
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: d1 },
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: d2 },
      ],
    });
    // 模拟零售单出库扫码（docType=retail）
    const out = await uc.scanDocument({
      direction: 'outbound', docType: 'retail', docId: PREFIX + 'R1', warehouseId: base.whA.id,
      items: [
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: d1 },
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: d2 },
      ],
    });
    assert(out.okCount === 2, '零售单出库扫码 2 件成功', JSON.stringify(out));
    // 单据级核销（结算环节调用）
    const vs = await uc.verifySoldByDoc({ docType: 'retail', docId: PREFIX + 'R1' });
    assert(vs.enabled === true && vs.processed === 2, 'verifySoldByDoc 整单核销 2 件', JSON.stringify(vs));
    const sd1a = await uc.getUniqueCodeStock(d1);
    assert(sd1a && sd1a.status === 'sold', '核销后状态为 sold');
    // 部分退货：仅回库 d1（防串货关键：未退的件不能被误回库）
    const pr = await uc.returnDocUniqueCodes({
      docType: 'retail', docId: PREFIX + 'R1', warehouseId: base.whA.id, uniqueCodes: [d1],
    });
    assert(pr.processed === 1, 'returnDocUniqueCodes 指定码只回库 1 件', JSON.stringify(pr));
    const sd1b = await uc.getUniqueCodeStock(d1);
    const sd2b = await uc.getUniqueCodeStock(d2);
    assert(sd1b && sd1b.status === 'in_stock', '部分退货后 d1 回库为 in_stock');
    assert(sd2b && sd2b.status === 'sold', '部分退货后 d2 仍为 sold（未被误回库）');
    // 整单退货：不传 uniqueCodes 时回库剩余件；已在库的 d1 不会重复回库
    const fr = await uc.returnDocUniqueCodes({
      docType: 'retail', docId: PREFIX + 'R1', warehouseId: base.whA.id,
    });
    assert(fr.processed === 1, '整单退货只回库剩余的 d2', JSON.stringify(fr));
    assert(fr.failed.length === 1 && fr.failed[0].uniqueCode === d1, '已回库的 d1 不重复处理（幂等）', JSON.stringify(fr.failed));
    const sd2c = await uc.getUniqueCodeStock(d2);
    assert(sd2c && sd2c.status === 'in_stock', '整单回库后 d2 回到 in_stock');
  }

  // ===== P1-2 ops 聚合对账（隔离场景：清空 FF_P1_ 后仅构造 sku1@仓A） =====
  {
    // 隔离：清空 FF_P1_ 件级库存、流水与聚合库存，避免历史残留干扰
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code WHERE doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM inventory_stock WHERE sku_id IN (SELECT id FROM sku WHERE style_no LIKE ${PREFIX + '%'})`);

    const c4 = buildUniqueCode(4, 6, 'GM26', true);
    await uc.registerInbound({
      docType: 'purchase_inbound', docId: PREFIX + 'IN4', warehouseId: base.whA.id,
      items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: c4 }], // 红M = sku1
    });
    // 构造聚合库存偏差：sku1@仓A 件级在库=1，但台账=5
    await db.insert(schema.inventoryStock).values({
      skuId: base.sku1.id, skuCode: base.sku1.skuCode, styleNo: base.st.styleNo, color: '红', size: 'M',
      warehouseId: base.whA.id, warehouseName: base.whA.name, quantity: '5',
    });
    // 该校验项是全局的（其它脚本残留也会产出问题），故断言聚焦"我构造的这条漂移"
    const pick = (c) => (c && c.issues ? c.issues : []);
    const mine = (c) => pick(c).filter((i) => String(i.entityId).includes(base.sku1.id));
    const sysErr = (c) => pick(c).filter((i) => i.entityId === 'UNIQUE_CODE_AGG_RECONCILE');

    let report = await ops.runValidation({ checks: ['UNIQUE_CODE_AGG_RECONCILE'] });
    const agg = report.checks.find((c) => c.code === 'UNIQUE_CODE_AGG_RECONCILE');
    assert(agg && sysErr(agg).length === 0, 'ops 聚合校验项执行无 SQL 异常', JSON.stringify(pick(agg)));
    assert(agg && mine(agg).length >= 1, 'ops 聚合对账检出我构造的漂移（sku1@仓A 件级1 vs 台账5）', JSON.stringify(mine(agg)));
    const drift = mine(agg)[0];
    assert(drift && /差异 -4\b/.test(drift.description), '漂移描述含正确差异值(-4)', drift && drift.description);
    // 修正聚合库存为正确值（sku1 在仓A 件级=1）
    await db.update(schema.inventoryStock).set({ quantity: '1' })
      .where(sql`sku_id = ${base.sku1.id} AND warehouse_id = ${base.whA.id}`);
    report = await ops.runValidation({ checks: ['UNIQUE_CODE_AGG_RECONCILE'] });
    const agg2 = report.checks.find((c) => c.code === 'UNIQUE_CODE_AGG_RECONCILE');
    assert(agg2 && mine(agg2).length === 0, '修正聚合库存后 sku1@仓A 漂移消失', JSON.stringify(mine(agg2)));
  }

  // ===== 溯源：getTrace 单码历史出入库 + 操作人 + 业务单号 + 串货 + range =====
  {
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code WHERE doc_id LIKE ${PREFIX + '%'}`);

    // 插入一张采购单，用于验证「单据号解析」（业务单号替代内部 id）
    const poId = '11111111-1111-1111-1111-111111111111';
    await db.execute(sql`DELETE FROM garment_purchase_order WHERE id = ${poId}`);
    await db.insert(schema.garmentPurchaseOrder).values({
      id: poId, orderNo: 'PO-TEST-001', supplierId: base.supplierId,
      supplierName: '测试供应商', orderDate: '2026-09-01',
    });

    const t1 = buildUniqueCode(21, 6, 'GM26', true);
    const t2 = buildUniqueCode(22, 6, 'GM26', true);
    // 采购入库（仓A，操作人 OP-001）
    await uc.registerInbound({
      docType: 'purchase_inbound', docId: poId, warehouseId: base.whA.id, operatorId: 'OP-001',
      items: [
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t1 },
        { styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t2 },
      ],
    });
    // 销售出库（仓A，操作人 OP-002）
    await uc.scanOutboundUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'TOUT', warehouseId: base.whA.id, operatorId: 'OP-002',
      styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t1,
    });
    // 结算核销（同单）
    await uc.verifySold({ docType: 'sales_outbound', docId: PREFIX + 'TOUT', uniqueCode: t1, operatorId: 'OP-002' });
    // 退货回库（仓A）
    await uc.returnUniqueCode({
      docType: 'sales_outbound', docId: PREFIX + 'TOUT', warehouseId: base.whA.id, uniqueCode: t1, operatorId: 'OP-001',
    });

    const tr = await uc.getTrace(t1);
    assert(tr.enabled === true && tr.current !== null, 'getTrace 返回当前状态');
    assert(tr.current.warehouseName === base.whA.name, '溯源当前仓库名正确', tr.current && tr.current.warehouseName);
    assert(tr.current.status === 'in_stock' && tr.current.statusLabel === '在库可用', '溯源当前状态=退回后重新在库');
    // 操作人归因：每个事件记录了扫码人
    assert(tr.events[0].operatorId === 'OP-001' && tr.events[1].operatorId === 'OP-002', '事件持久化操作人(operatorId)', JSON.stringify(tr.events.map((e) => e.operatorId)));
    // 业务单号解析：采购入库事件应显示 PO-TEST-001（当前 inboundDocNo 反映最近一次入库即退货单，可为 null，属正常）
    assert(tr.events[0].docNo === 'PO-TEST-001', '溯源解析业务单号(采购单号)替代内部 id', JSON.stringify({ cur: tr.current.inboundDocNo, ev: tr.events[0].docNo }));
    // 事件按时间升序：入库→出库→核销→退货
    const types = tr.events.map((e) => e.scanType);
    assert(JSON.stringify(types) === JSON.stringify(['inbound', 'outbound', 'sold', 'returned']), '事件按时间升序且覆盖完整生命周期', JSON.stringify(types));
    assert(tr.events[0].direction === '入' && tr.events[1].direction === '出' && tr.events[2].direction === '核' && tr.events[3].direction === '退', '事件方向(入/出/核/退)正确');
    assert(tr.events[1].docTypeName === '销售出库单', '出库事件单据名中文化', tr.events[1].docTypeName);
    // 同仓销售：不串货
    assert(tr.channelCrossingSuspect === false, '同仓采购入库+同仓销售：不标记串货', String(tr.channelCrossingSuspect));

    // 过滤：只看出入库（不含核销/退货）
    const trInOut = await uc.getTrace(t1, { eventTypes: ['inbound', 'outbound'] });
    assert(trInOut.eventCount === 2, 'eventTypes 过滤生效', JSON.stringify(trInOut.events.map((e) => e.scanType)));

    // 未启用时返回空（单独验证：临时关闭配置）
    const tBefore = await hangtag.getUniqueCodeConfig();
    await hangtag.setUniqueCodeConfig({ enabled: false, force: true });
    const trOff = await uc.getTrace(t1);
    assert(trOff.enabled === false && trOff.eventCount === 0, '未启用唯一码时溯源返回空');
    await hangtag.setUniqueCodeConfig({ enabled: true, length: tBefore.length, prefix: tBefore.prefix, checksum: tBefore.checksum, force: true });

    // ===== 串货场景：采购入库在仓A，但被手动在仓B再次入库后于仓B销售（无调拨单）=====
    const t3 = buildUniqueCode(23, 6, 'GM26', true);
    await uc.registerInbound({ docType: 'purchase_inbound', docId: PREFIX + 'TIN2', warehouseId: base.whA.id, operatorId: 'OP-001', items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t3 }] });
    // 模拟"未经调拨直接出现在仓B并被登记/销售"：在仓B再次入库（覆盖入库仓），随后仓B销售
    await uc.registerInbound({ docType: 'purchase_inbound', docId: PREFIX + 'TIN3', warehouseId: base.whB.id, operatorId: 'OP-003', items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t3 }] });
    await uc.scanOutboundUniqueCode({ docType: 'sales_outbound', docId: PREFIX + 'TOUT3', warehouseId: base.whB.id, operatorId: 'OP-003', styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t3 });

    const tr3 = await uc.getTrace(t3);
    assert(tr3.channelCrossingSuspect === true, '跨仓无调拨销售：标记串货嫌疑', String(tr3.channelCrossingSuspect));
    const out3 = tr3.events.find((e) => e.scanType === 'outbound');
    assert(out3 && out3.crossesChannel === true, '违规出库事件 crossesChannel=true', JSON.stringify(out3));

    // 串货违规检出接口
    const viol = await uc.getChannelViolations({ skuId: base.sku1.id });
    assert(viol.enabled === true && viol.total >= 1 && viol.items.some((i) => i.uniqueCode === t3), 'getChannelViolations 检出疑似串货件', JSON.stringify(viol.items.map((i) => i.uniqueCode)));
    const v3 = viol.items.find((i) => i.uniqueCode === t3);
    assert(v3 && v3.originWarehouseId === base.whA.id && v3.violationWarehouseId === base.whB.id && v3.violationDocNo === null, '串货件含原始仓/违规仓/违规单', JSON.stringify(v3));

    // ===== 合法调拨场景：采购仓A → 调拨仓B → 仓B销售（不应标记串货）=====
    const t4 = buildUniqueCode(24, 6, 'GM26', true);
    await uc.registerInbound({ docType: 'purchase_inbound', docId: PREFIX + 'TIN4', warehouseId: base.whA.id, items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t4 }] });
    await uc.scanTransfer({ docId: PREFIX + 'TR1', fromWarehouseId: base.whA.id, toWarehouseId: base.whB.id, items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t4 }] });
    await uc.scanOutboundUniqueCode({ docType: 'sales_outbound', docId: PREFIX + 'TOUT4', warehouseId: base.whB.id, styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: t4 });
    const tr4 = await uc.getTrace(t4);
    assert(tr4.channelCrossingSuspect === false, '经调拨后跨仓销售：不标记串货', String(tr4.channelCrossingSuspect));

    // ===== 跨区间批量溯源 =====
    const range = await uc.getTraceByRange({ skuId: base.sku1.id, limit: 100 });
    assert(range.enabled === true && range.total >= 6, 'getTraceByRange 返回本SKU扁平流水', JSON.stringify({ total: range.total, rows: range.rows.length }));
    assert(range.rows.every((r) => typeof r.crossesChannel === 'boolean' && 'docNo' in r && 'operatorId' in r), 'range 每行含 crossesChannel/docNo/operatorId', JSON.stringify(range.rows[0]));
    const rT1 = range.rows.filter((r) => r.uniqueCode === t1);
    assert(rT1.length === 4 && rT1[0].operatorId === 'OP-001', 'range 过滤到 t1 的 4 条且操作人正确', JSON.stringify(rT1.map((r) => r.operatorId)));
    // 按 eventTypes + 仓库过滤
    const rangeOut = await uc.getTraceByRange({ skuId: base.sku1.id, eventTypes: ['outbound'], warehouseId: base.whB.id });
    assert(rangeOut.rows.every((r) => r.scanType === 'outbound' && r.warehouseId === base.whB.id), 'range 按动作+仓库过滤生效', JSON.stringify(rangeOut.rows.map((r) => [r.scanType, r.warehouseId])));

    // 按 SKU 批量溯源
    const bySku = await uc.getTraceBySku(base.sku1.id);
    assert(bySku.enabled === true && bySku.totalCodes >= 2, 'getTraceBySku 覆盖本SKU全部件', JSON.stringify(bySku.items.map((i) => i.uniqueCode)));
    const t1Item = bySku.items.find((i) => i.uniqueCode === t1);
    assert(t1Item && t1Item.eventCount === 4 && t1Item.status === 'in_stock', '批量溯源单件含 4 事件且当前在库', JSON.stringify(t1Item));

    // CSV 导出
    const csv = uc.buildTraceCsv(await uc.getTrace(t1));
    assert(csv.startsWith('﻿序号,动作') && (csv.match(/\r\n/g) || []).length === 4, 'CSV 含 BOM 表头且 4 行事件', csv.slice(0, 60));
  }

  // ===== P2 流水归档 / 冷热分离：归档后溯源仍完整 + 公开溯源 + 二维码端点 =====
  {
    // 隔离：清空 FF_P1_ 的件级库存、流水与归档，避免历史残留干扰
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code WHERE doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code_archive WHERE doc_id LIKE ${PREFIX + '%'}`);

    const p2code = buildUniqueCode(41, 6, 'GM26', true);
    // 完整生命周期：采购入库(仓A) → 销售出库(仓A) → 结算核销 → 退货回库(仓A)
    await uc.registerInbound({ docType: 'purchase_inbound', docId: PREFIX + 'PIN1', warehouseId: base.whA.id, operatorId: 'OP-P2A', items: [{ styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: p2code }] });
    await uc.scanOutboundUniqueCode({ docType: 'sales_outbound', docId: PREFIX + 'POUT1', warehouseId: base.whA.id, operatorId: 'OP-P2B', styleNo: base.st.styleNo, color: '红', size: 'M', uniqueCode: p2code });
    await uc.verifySold({ docType: 'sales_outbound', docId: PREFIX + 'POUT1', uniqueCode: p2code, operatorId: 'OP-P2B' });
    await uc.returnUniqueCode({ docType: 'sales_outbound', docId: PREFIX + 'POUT1', warehouseId: base.whA.id, uniqueCode: p2code, operatorId: 'OP-P2A' });

    const beforeTrace = await uc.getTrace(p2code);
    assert(beforeTrace.eventCount === 4, '归档前 getTrace 含 4 条事件', JSON.stringify(beforeTrace.events.map((e) => e.scanType)));
    assert(beforeTrace.current && beforeTrace.current.status === 'in_stock', '归档前当前状态为退回后在库');

    // 归档全部 FF_P1_ 热表流水（before 设为远未来，覆盖所有已写入行）
    const moved = await uc.archiveOldEvents(new Date(Date.now() + 86400000 * 365), 2000);
    assert(moved.moved >= 4, 'archiveOldEvents 搬移 FF_P1_ 流水', JSON.stringify(moved));

    // 归档后：热表应无该码，归档表应有 4 条
    const hotAfter = await db.select({ c: sql`COUNT(*)::int` }).from(schema.docUniqueCode).where(sql`unique_code = ${p2code}`);
    const arcAfter = await db.select({ c: sql`COUNT(*)::int` }).from(schema.docUniqueCodeArchive).where(sql`unique_code = ${p2code}`);
    assert(hotAfter[0].c === 0, '归档后热表无该码（已迁冷）', JSON.stringify(hotAfter));
    assert(arcAfter[0].c === 4, '归档后归档表含 4 条', JSON.stringify(arcAfter));

    // 关键断言：归档后溯源仍完整（跨冷热表）
    const afterTrace = await uc.getTrace(p2code);
    assert(afterTrace.eventCount === 4, '归档后 getTrace 仍完整（跨冷热表读取）', JSON.stringify(afterTrace.events.map((e) => e.scanType)));
    const afterTypes = afterTrace.events.map((e) => e.scanType);
    assert(JSON.stringify(afterTypes) === JSON.stringify(['inbound', 'outbound', 'sold', 'returned']), '归档后事件按时间升序且覆盖完整生命周期', JSON.stringify(afterTypes));
    assert(afterTrace.events[0].operatorId === 'OP-P2A', '归档后内部溯源仍保留操作人(operatorId)', JSON.stringify(afterTrace.events.map((e) => e.operatorId)));

    // 归档统计
    const st = await uc.getArchiveStats();
    assert(typeof st.hot.count === 'number' && typeof st.archive.count === 'number', 'getArchiveStats 返回热/归档计数', JSON.stringify(st));
    assert(st.archive.count >= 4, 'getArchiveStats 归档计数 >= 4', JSON.stringify(st));

    // 公开溯源：消费者安全字段，不含操作人 / 内部单号
    const pub = await uc.getPublicTrace(p2code);
    assert(pub.found === true && pub.authentic === true, '公开溯源 found & 验真通过', JSON.stringify({ found: pub.found, authentic: pub.authentic }));
    assert(pub.styleNo === base.st.styleNo && pub.color === '红' && pub.size === 'M', '公开溯源暴露款色码', JSON.stringify({ s: pub.styleNo, c: pub.color, z: pub.size }));
    assert(pub.eventCount === 4, '公开溯源事件数 = 4', String(pub.eventCount));
    assert(!('operatorId' in pub) && !('docId' in pub), '公开溯源剥离操作人/内部单号顶层字段', JSON.stringify(Object.keys(pub)));
    assert(!('docId' in pub.events[0]) && !('docNo' in pub.events[0]) && !('operatorId' in pub.events[0]), '公开溯源事件不含内部单据信息', JSON.stringify(pub.events[0]));
    assert(pub.events[0].eventType === '入库登记' && pub.events[0].direction === '入', '公开溯源事件简化字段正确(中文动作+方向)', JSON.stringify(pub.events[0]));

    // 二维码端点：直接调用 TracePublicController.qr，验证返回 SVG
    const ctrl = new TracePublicController(uc);
    let captured = { headers: {}, status: null, body: null };
    const res = {
      setHeader: (k, v) => { captured.headers[k] = v; },
      status: (s) => { captured.status = s; return res; },
      send: (b) => { captured.body = b; return res; },
    };
    const req = { protocol: 'http', get: (h) => (h === 'host' ? 'localhost:3000' : '') };
    await ctrl.qr(req, res, p2code, '240');
    assert(captured.status === 200, 'QR 端点返回 200', String(captured.status));
    assert((captured.headers['Content-Type'] || '').includes('image/svg+xml'), 'QR 端点 Content-Type=image/svg+xml', JSON.stringify(captured.headers));
    assert(typeof captured.body === 'string' && captured.body.startsWith('<svg'), 'QR 端点返回合法 SVG', (captured.body || '').slice(0, 40));

    // 公开溯源未命中场景：未登记码返回 found=false
    const missing = await uc.getPublicTrace(buildUniqueCode(999999, 6, 'GM26', true));
    assert(missing.found === false && missing.authentic === false, '公开溯源未登记码 found=false');
  }

  // ===== P3 配置化归档（系统配置项 UNIQUE_CODE_ARCHIVE_DAYS 驱动 archiveByDays）=====
  {
    // 隔离：清空 FF_P1_ 的件级库存、流水与归档
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code WHERE doc_id LIKE ${PREFIX + '%'}`);
    await db.execute(sql`DELETE FROM doc_unique_code_archive WHERE doc_id LIKE ${PREFIX + '%'}`);

    const cfgKey = 'UNIQUE_CODE_ARCHIVE_DAYS';
    // 1) 默认/未设置（days=0）：archiveByDays 视为未启用，不搬移任何流水
    const r0 = await uc.archiveByDays(0, 2000);
    assert(r0.enabled === false && r0.moved === 0 && r0.days === 0, 'archiveByDays(0) 未启用且搬移 0 条（默认不归档）', JSON.stringify(r0));

    // 2) 管理员在系统配置页录入归档天数=30（模拟写入 UNIQUE_CODE_ARCHIVE_DAYS）
    await db.insert(schema.systemConfig).values({
      configKey: cfgKey, configValue: '30', description: '唯一码流水归档天数',
    }).onConflictDoUpdate({ target: schema.systemConfig.configKey, set: { configValue: '30' } });

    // 3) 后端读取该配置：getArchiveDays 应返回 30（>0 视为启用）
    const cfgDays = await uc.getArchiveDays();
    assert(cfgDays === 30, 'getArchiveDays 读取系统配置归档天数=30', String(cfgDays));

    // 4) 构造早于 30 天的历史流水（60 天前）与近期流水（今天）
    const oldCode = buildUniqueCode(61, 6, 'GM26', true);
    const newCode = buildUniqueCode(62, 6, 'GM26', true);
    const oldAt = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const newAt = new Date().toISOString();
    await db.insert(schema.docUniqueCode).values([
      { docType: 'purchase_inbound', docId: PREFIX + 'CFGOLD', uniqueCode: oldCode, skuId: base.sku1.id, styleNo: base.st.styleNo, color: '红', size: 'M', warehouseId: base.whA.id, scanType: 'inbound', scanAt: oldAt, operatorId: 'OP-CFG' },
      { docType: 'purchase_inbound', docId: PREFIX + 'CFGNEW', uniqueCode: newCode, skuId: base.sku1.id, styleNo: base.st.styleNo, color: '红', size: 'M', warehouseId: base.whA.id, scanType: 'inbound', scanAt: newAt, operatorId: 'OP-CFG' },
    ]);

    // 5) 按配置天数归档：仅搬移早于 30 天的 oldCode（60 天前），不动 newCode
    const rc = await uc.archiveByDays(cfgDays, 2000);
    assert(rc.enabled === true && rc.days === 30, 'archiveByDays(30) 启用且 days 回传正确', JSON.stringify(rc));
    assert(rc.moved === 1, 'archiveByDays(30) 只搬移早于 30 天的 1 条', JSON.stringify(rc));
    const hotOld = await db.select({ c: sql`COUNT(*)::int` }).from(schema.docUniqueCode).where(sql`unique_code = ${oldCode}`);
    const arcOld = await db.select({ c: sql`COUNT(*)::int` }).from(schema.docUniqueCodeArchive).where(sql`unique_code = ${oldCode}`);
    const hotNew = await db.select({ c: sql`COUNT(*)::int` }).from(schema.docUniqueCode).where(sql`unique_code = ${newCode}`);
    assert(hotOld[0].c === 0 && arcOld[0].c === 1, '配置归档将旧流水迁入归档表、热表清空', JSON.stringify({ hot: hotOld, arc: arcOld }));
    assert(hotNew[0].c === 1, '配置归档不动近期流水（newCode 仍在热表）', JSON.stringify(hotNew));

    // 6) 管理员把天数改回 0（不归档）后：getArchiveDays 应返回 0
    await db.update(schema.systemConfig).set({ configValue: '0' }).where(eq(schema.systemConfig.configKey, cfgKey));
    const cfgDays0 = await uc.getArchiveDays();
    assert(cfgDays0 === 0, '配置清零后 getArchiveDays 返回 0（不归档）', String(cfgDays0));
  }

  // ===== P0-1 生命周期报表（getLifecycleReport 参数化重写，消除 SQL 注入）=====
  {
    // 隔离：清空本脚本件级库存（按单据前缀 + 按本款款号，覆盖非 FF_P1_ 单据前缀的遗留行）
    await db.execute(sql`DELETE FROM unique_code_stock WHERE inbound_doc_id LIKE ${PREFIX + '%'} OR outbound_doc_id LIKE ${PREFIX + '%'} OR style_no = ${base.st.styleNo}`);

    // 直接落 unique_code_stock（LOCAL 表无 FK 约束，可填任意 uuid 占位），用本脚本前缀便于 cleanup 清理
    await db.insert(schema.uniqueCodeStock).values([
      { uniqueCode: PREFIX + 'LC1', numericValue: 71, skuId: base.sku1.id, styleNo: base.st.styleNo, color: '红', size: 'M', warehouseId: base.whA.id, status: 'in_stock', inboundDocType: 'purchase_inbound', inboundDocId: PREFIX + 'LCIN1' },
      { uniqueCode: PREFIX + 'LC2', numericValue: 72, skuId: base.sku1.id, styleNo: base.st.styleNo, color: '蓝', size: 'L', warehouseId: base.whA.id, status: 'sold', inboundDocType: 'purchase_inbound', inboundDocId: PREFIX + 'LCIN2' },
    ]);

    const rep = await uc.getLifecycleReport({ styleNo: base.st.styleNo });
    assert(Array.isArray(rep.byStatus) && rep.byStatus.length > 0, 'getLifecycleReport 返回 byStatus 分布', JSON.stringify(rep.byStatus));
    assert(Array.isArray(rep.byWarehouse) && rep.byWarehouse.length > 0, 'getLifecycleReport 返回 byWarehouse 分布', JSON.stringify(rep.byWarehouse));
    assert(Array.isArray(rep.byStyle) && rep.byStyle.length > 0, 'getLifecycleReport 返回 byStyle 分布', JSON.stringify(rep.byStyle));
    const whACount = rep.byWarehouse.filter((r) => r.warehouseId === base.whA.id).reduce((s, r) => s + r.count, 0);
    assert(whACount === 2, 'getLifecycleReport 按仓库聚合：仓A 共 2 件', JSON.stringify(rep.byWarehouse));
    const styleCount = rep.byStyle.filter((r) => r.styleNo === base.st.styleNo).reduce((s, r) => s + r.count, 0);
    assert(styleCount === 2, 'getLifecycleReport 按款号聚合：本款 共 2 件', JSON.stringify(rep.byStyle));
    const statusMap = Object.fromEntries(rep.byStatus.map((r) => [r.status, r.count]));
    assert(statusMap['in_stock'] === 1 && statusMap['sold'] === 1, 'getLifecycleReport 按状态分布：in_stock=1/sold=1', JSON.stringify(rep.byStatus));

    // 参数化过滤生效：传入不存在的款号，本款不应出现在结果中（验证 warehouseId/styleNo 已参数化而非字符串拼接）
    const repX = await uc.getLifecycleReport({ styleNo: 'NONEXIST_X_' + PREFIX });
    assert(!repX.byStyle.some((r) => r.styleNo === base.st.styleNo), 'getLifecycleReport 参数化过滤生效（非本款不混入）', JSON.stringify(repX.byStyle));
  }

  await cleanup();

  console.log('\n==================== 联调结果 ====================');
  console.log(`通过 ${R.checks.filter((c) => c.ok).length} / 共 ${R.checks.length}`);
  for (const c of R.checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.issue}${c.ok ? '' : '  -> ' + c.detail}`);
  }
  await client.end();
  if (R.errors.length) process.exit(1);
}

main().catch((e) => {
  console.error('运行异常：', e);
  process.exit(1);
});
