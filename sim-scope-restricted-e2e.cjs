/**
 * 受限态端到端隔离回归（抓"静默不隔离"类 bug）
 *
 * 背景：buildDealerScopeCondition(scope, path) 要求 path 带 `kind` 键；若调用处写成
 *   { dealerColumn: X } 或 { viaSupplier: X }（缺 kind），switch 会命中 default -> 返回 undefined，
 *   导致隔离"静默失效"（超管态本就返回 undefined，现有回归发现不了）。本 sim 用真实受限作用域
 *   驱动 service 方法，断言受限用户确实只看到自己经销商的数据、且直查他人 ID 被拒。
 *
 * 运行：node sim-scope-restricted-e2e.cjs   （需 dev/postgres 在 localhost:5434）
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
const { randomUUID } = require('crypto');
const { SalesReconciliationService } = require('./dist/server/modules/sales/reconciliation/reconciliation.service.js');
const { RequestContext, ALL_SCOPE } = require('./dist/server/common/context/request-context.js');
const S = require('./dist/server/database/schema.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = null; // 服务内部用 @Inject(DRIZZLE_DATABASE)，这里直接构造

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// 15 个已注入作用域的 service 源文件（静态守卫：必须含 { kind: 且不得含 dealerColumn:）
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

async function seed() {
  const D1 = randomUUID(), D2 = randomUUID();
  const CU1 = randomUUID(), CU2 = randomUUID();
  const R1 = randomUUID(), R2 = randomUUID();
  await client`INSERT INTO dealer (id, code, name) VALUES (${D1}, ${'D1_' + D1.slice(0,8)}, ${'Dealer1'}), (${D2}, ${'D2_' + D2.slice(0,8)}, ${'Dealer2'})`;
  await client`INSERT INTO customer (id, code, name, partner_id) VALUES (${CU1}, ${'C1_' + CU1.slice(0,8)}, ${'Cust1'}, ${D1}), (${CU2}, ${'C2_' + CU2.slice(0,8)}, ${'Cust2'}, ${D2})`;
  await client`INSERT INTO sales_reconciliation (id, recon_no, customer_id, customer_name, start_date, end_date, outbound_amount, return_amount, total_amount, status) VALUES
    (${R1}, ${'R1_' + R1.slice(0,8)}, ${CU1}, ${'Cust1'}, ${'2026-01-01'}, ${'2026-01-31'}, ${100}, ${0}, ${100}, ${'draft'}),
    (${R2}, ${'R2_' + R2.slice(0,8)}, ${CU2}, ${'Cust2'}, ${'2026-01-01'}, ${'2026-01-31'}, ${200}, ${0}, ${200}, ${'draft'})`;
  return { D1, D2, CU1, CU2, R1, R2 };
}

async function cleanup(s) {
  await client`DELETE FROM sales_reconciliation WHERE id IN (${s.R1}, ${s.R2})`;
  await client`DELETE FROM customer WHERE id IN (${s.CU1}, ${s.CU2})`;
  await client`DELETE FROM dealer WHERE id IN (${s.D1}, ${s.D2})`;
}

async function run() {
  console.log('\n[Part 1] 静态守卫：15 个注入文件的调用签名+import 必须正确（含 kind:，无 dealerColumn:，且 import 存在）');
  for (const f of INJECTED) {
    const full = path.join(__dirname, f);
    const txt = fs.readFileSync(full, 'utf8');
    const hasKind = /buildDealerScopeCondition\([^]*?\{[^}]*kind:\s*'/.test(txt);
    const hasBroken = /dealerColumn:/.test(txt) || /\{\s*viaSupplier:|\{\s*viaCustomer:|\{\s*viaWarehouse:/.test(txt);
    const hasImport = /from ['"]@server\/common\/data-scope\/dealer-scope['"]/.test(txt) && /from ['"]@server\/common\/context\/request-context['"]/.test(txt);
    assert(`签名+import正确: ${f.split('/').slice(-2).join('/')}`, hasKind && !hasBroken && hasImport, { hasKind, hasBroken, hasImport });
  }

  console.log('\n[Part 2] 受限态端到端：销售对账单隔离');
  const s = await seed();
  const stub = {};
  const { drizzle } = require('drizzle-orm/postgres-js');
  const drizzleDb = drizzle(client, { schema: S });
  const svc2 = new SalesReconciliationService(drizzleDb, stub, stub);

  try {
    // 超管全量
    const all = await RequestContext.run({ dealerScope: ALL_SCOPE }, () => svc2.list({ page: 1, pageSize: 100 }));
    assert('超管态可见全部（>=2 含种子）', all.total >= 2, all.total);

    // 受限 D1：仅看到 CU1 的对账单
    const d1 = await RequestContext.run({ dealerScope: { type: 'dealer', dealerIds: [s.D1] } }, () => svc2.list({ page: 1, pageSize: 100 }));
    const d1Ids = d1.items.map((r) => r.customerId);
    assert('受限 D1 仅见自己客户数据（total=1）', d1.total === 1 && d1Ids[0] === s.CU1, { total: d1.total, d1Ids });

    // 受限于不存在的经销商：空集（证明过滤生效，而非静默失效）
    const none = await RequestContext.run({ dealerScope: { type: 'dealer', dealerIds: [randomUUID()] } }, () => svc2.list({ page: 1, pageSize: 100 }));
    assert('受限无匹配经销商 -> 空集（隔离生效，非静默放行）', none.total === 0, none.total);

    // 直查他人（CU2）对账单：应被拒（IDOR 保护）
    let threw = false, gotCust = null;
    try {
      const r = await RequestContext.run({ dealerScope: { type: 'dealer', dealerIds: [s.D1] } }, () => svc2.get(s.R2));
      gotCust = r && r.customerId;
    } catch (e) { threw = true; }
    assert('受限 D1 直查他人(CU2)对账单被拒（IDOR 保护）', threw || gotCust !== s.CU2, { threw, gotCust });
  } finally {
    await cleanup(s);
  }

  console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); }).finally(() => client.end());
