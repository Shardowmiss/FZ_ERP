/**
 * P0-S2 写越权硬化 · 黑盒验证（真实 DB）
 *
 * 三层验证：
 *   Part A 静态守卫：3 个已注入 service 源文件必须包含 assertWriteWithinScope( 调用
 *   Part B helper 单元级：直接驱动编译后的 assertWriteWithinScope，覆盖
 *           customer / supplier / warehouse 三类实体 × 超管 / 受限合法 / 受限越权 / 空范围 / 实体不存在
 *   Part C 集成验证：驱动编译后的 SalesReconciliationService.create（经行级写校验），
 *           证明 service 层注入点真实生效（合法放行 / 越权被拒 / 空范围拒绝）
 *
 * 运行：node sim-write-scope.cjs   （需 dev/postgres 在 localhost:5434）
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
const { randomUUID } = require('crypto');
const { drizzle } = require('drizzle-orm/postgres-js');

const { SalesReconciliationService } = require('./dist/server/modules/sales/reconciliation/reconciliation.service.js');
const { RequestContext, ALL_SCOPE } = require('./dist/server/common/context/request-context.js');
const { assertWriteWithinScope } = require('./dist/server/common/data-scope/write-scope.js');
const S = require('./dist/server/database/schema.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const INJECTED = [
  'server/modules/sales/outbound/sales-outbound.service.ts',
  'server/modules/sales/return/sales-return.service.ts',
  'server/modules/purchase/inbound/purchase-inbound.service.ts',
  'server/modules/purchase/return/purchase-return.service.ts',
  'server/modules/purchase/garment-order/garment-purchase-order.service.ts',
  'server/modules/purchase/garment-inbound/garment-purchase-inbound.service.ts',
  'server/modules/purchase/garment-return/garment-purchase-return.service.ts',
  'server/modules/production/work-order/work-order.service.ts',
  'server/modules/production/material-issue/material-issue.service.ts',
  'server/modules/production/finish-receipt/finish-receipt.service.ts',
  'server/modules/production/material-purchase/material-purchase-order.service.ts',
  'server/modules/production/material-purchase/material-purchase-inbound.service.ts',
  'server/modules/subcontract/subcontract.service.ts',
  'server/modules/sales/reconciliation/reconciliation.service.ts',
  'server/modules/purchase/reconciliation/reconciliation.service.ts',
];

// 实体状态提取（兼容 e.status 与 getStatus()）
function statusOf(e) {
  if (!e) return undefined;
  if (typeof e.getStatus === 'function') return e.getStatus();
  return e.status;
}

async function seed() {
  const D1 = randomUUID(), D2 = randomUUID();
  const CU1 = randomUUID(), CU2 = randomUUID();
  const SU1 = randomUUID(), SU2 = randomUUID();
  const W1 = randomUUID(), W2 = randomUUID();
  await client`INSERT INTO dealer (id, code, name) VALUES
    (${D1}, ${'D1_' + D1.slice(0, 8)}, ${'Dealer1'}),
    (${D2}, ${'D2_' + D2.slice(0, 8)}, ${'Dealer2'})`;
  await client`INSERT INTO customer (id, code, name, partner_id) VALUES
    (${CU1}, ${'C1_' + CU1.slice(0, 8)}, ${'Cust1'}, ${D1}),
    (${CU2}, ${'C2_' + CU2.slice(0, 8)}, ${'Cust2'}, ${D2})`;
  await client`INSERT INTO supplier (id, code, name, partner_id) VALUES
    (${SU1}, ${'S1_' + SU1.slice(0, 8)}, ${'Sup1'}, ${D1}),
    (${SU2}, ${'S2_' + SU2.slice(0, 8)}, ${'Sup2'}, ${D2})`;
  await client`INSERT INTO warehouse (id, code, name, type, dealer_id) VALUES
    (${W1}, ${'W1_' + W1.slice(0, 8)}, ${'Wh1'}, ${'self'}, ${D1}),
    (${W2}, ${'W2_' + W2.slice(0, 8)}, ${'Wh2'}, ${'self'}, ${D2})`;
  return { D1, D2, CU1, CU2, SU1, SU2, W1, W2 };
}

async function cleanup(s) {
  await client`DELETE FROM sales_reconciliation WHERE customer_id IN (${s.CU1}, ${s.CU2})`;
  await client`DELETE FROM customer WHERE id IN (${s.CU1}, ${s.CU2})`;
  await client`DELETE FROM supplier WHERE id IN (${s.SU1}, ${s.SU2})`;
  await client`DELETE FROM warehouse WHERE id IN (${s.W1}, ${s.W2})`;
  await client`DELETE FROM dealer WHERE id IN (${s.D1}, ${s.D2})`;
}

async function run() {
  // ---------- Part A 静态守卫 ----------
  // 含 update 写入点的文件需同时覆盖 create + update（≥2 处调用）
  const NEEDS_TWO = new Set([
    'server/modules/production/work-order/work-order.service.ts',
    'server/modules/production/material-issue/material-issue.service.ts',
    'server/modules/production/finish-receipt/finish-receipt.service.ts',
    'server/modules/production/material-purchase/material-purchase-order.service.ts',
  ]);
  console.log('\n[Part A] 静态守卫：15 个注入文件必须含 write-scope import 且含 assertWriteWithinScope( 调用');
  for (const f of INJECTED) {
    const txt = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const hasImport = /from '@server\/common\/data-scope\/write-scope'/.test(txt);
    const callCount = (txt.match(/assertWriteWithinScope\(/g) || []).length;
    const min = NEEDS_TWO.has(f) ? 2 : 1;
    const ok = hasImport && callCount >= min;
    assert(`import + 调用齐全(≥${min}): ${f.split('/').slice(-2).join('/')}`, ok, { hasImport, callCount, min });
  }

  // ---------- Part B helper 单元级全分支 ----------
  console.log('\n[Part B] helper 单元级：三类实体 × 五态');
  const s = await seed();
  const scopeD1 = { type: 'dealer', dealerIds: [s.D1] };
  const scopeEmpty = { type: 'dealer', dealerIds: [] };
  const NOPE = randomUUID();

  async function check(label, scope, refs, expectThrow, expectStatus) {
    try {
      await RequestContext.run({ dealerScope: scope }, () => assertWriteWithinScope(db, refs));
      assert(label + ' -> 放行', !expectThrow);
    } catch (e) {
      const st = statusOf(e);
      const ok = expectThrow && (expectStatus ? st === expectStatus : true);
      assert(label + ` -> 被拒(status=${st})`, ok, { status: st, msg: e && e.message });
    }
  }

  // 超管：全部放行
  await check('超管/customer 放行', ALL_SCOPE, { customerId: s.CU1 }, false);
  await check('超管/supplier 放行', ALL_SCOPE, { supplierId: s.SU1 }, false);
  await check('超管/warehouse 放行', ALL_SCOPE, { warehouseId: s.W1 }, false);

  // 受限 D1 合法（归属 D1）
  await check('受限D1/customer(CU1∈D1) 放行', scopeD1, { customerId: s.CU1 }, false);
  await check('受限D1/supplier(SU1∈D1) 放行', scopeD1, { supplierId: s.SU1 }, false);
  await check('受限D1/warehouse(W1∈D1) 放行', scopeD1, { warehouseId: s.W1 }, false);
  // 组合校验：customer + warehouse 同时合法
  await check('受限D1/customer+warehouse 均合法 放行', scopeD1, { customerId: s.CU1, warehouseId: s.W1 }, false);

  // 受限 D1 越权（归属 D2）
  await check('受限D1/customer(CU2∈D2) 越权拒', scopeD1, { customerId: s.CU2 }, true, 403);
  await check('受限D1/supplier(SU2∈D2) 越权拒', scopeD1, { supplierId: s.SU2 }, true, 403);
  await check('受限D1/warehouse(W2∈D2) 越权拒', scopeD1, { warehouseId: s.W2 }, true, 403);
  // 组合：customer 合法但 warehouse 越权 → 整体拒
  await check('受限D1/customer合法+warehouse越权 拒', scopeD1, { customerId: s.CU1, warehouseId: s.W2 }, true, 403);

  // 受限空范围：默认拒绝
  await check('空范围/customer 拒', scopeEmpty, { customerId: s.CU1 }, true, 403);
  await check('空范围/warehouse 拒', scopeEmpty, { warehouseId: s.W1 }, true, 403);

  // 实体不存在：BadRequest
  await check('customer 不存在 BadRequest', scopeD1, { customerId: NOPE }, true, 400);
  await check('warehouse 不存在 BadRequest', scopeD1, { warehouseId: NOPE }, true, 400);

  // ---------- Part C 集成验证：SalesReconciliationService.create ----------
  console.log('\n[Part C] 集成验证：SalesReconciliationService.create 经写越权校验');
  const stubNumGen = { generateNextNo: async () => 'SR' + randomUUID().replace(/-/g, '').slice(0, 12) };
  const stubOpLog = { create: async () => ({}) };
  const svc = new SalesReconciliationService(db, stubNumGen, stubOpLog);

  async function tryCreate(scope, custId, name) {
    const dto = {
      customerId: custId, customerName: name,
      startDate: '2026-01-01', endDate: '2026-01-31',
      outboundAmount: 100, returnAmount: 0, totalAmount: 100,
    };
    try {
      const r = await RequestContext.run({ dealerScope: scope }, () => svc.create(dto, 'u_test'));
      return { ok: true, customerId: r && r.customerId };
    } catch (e) {
      return { ok: false, status: statusOf(e), msg: e && e.message };
    }
  }

  // 超管：成功
  const admin = await tryCreate(ALL_SCOPE, s.CU1, 'Cust1');
  assert('超管态 create 成功(customerId=CU1)', admin.ok && admin.customerId === s.CU1, admin);

  // 受限 D1 合法：成功
  const legal = await tryCreate(scopeD1, s.CU1, 'Cust1');
  assert('受限D1 create(CU1∈D1) 成功', legal.ok && legal.customerId === s.CU1, legal);

  // 受限 D1 越权（CU2∈D2）：被拒 403
  const cross = await tryCreate(scopeD1, s.CU2, 'Cust2');
  assert('受限D1 create(CU2∈D2) 越权被拒(403)', !cross.ok && cross.status === 403, cross);

  // 空范围：被拒 403
  const empty = await tryCreate(scopeEmpty, s.CU1, 'Cust1');
  assert('空范围 create 被拒(403)', !empty.ok && empty.status === 403, empty);

  // 实体不存在：被拒 400
  const missing = await tryCreate(scopeD1, NOPE, 'NoCust');
  assert('customer 不存在 create 被拒(400)', !missing.ok && missing.status === 400, missing);

  await cleanup(s);

  console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(2); }).finally(() => client.end());
