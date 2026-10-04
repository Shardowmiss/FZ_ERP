/**
 * 聚合端点（报表/看板/分析/财务）经销商作用域回归 sim
 *
 * 验证：在「已配置但无可见范围」（dealerIds:[]）拒绝态下，所有注入 buildAggregationScope 的
 * 聚合端点必须返回空集（1=0 / IN 空集生效，无跨租户泄漏）；在「全部可见」（ALL_SCOPE）态下，
 * 端点必须返回真实计数（注入对放开态是 no-op，无回归）。
 *
 * 直接驱动真实编译后的 Service（黑盒），不依赖任何种子数据——dev 库已有真实经营数据。
 *
 * 运行：node sim-aggregation-scope.cjs   （需 dev/postgres 在 localhost:5434 运行）
 */
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const RC = require('./dist/server/common/context/request-context.js');
const S = require('./dist/server/database/schema.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 5 });
const db = drizzle(client, { schema: S });

const PaymentService = require('./dist/server/modules/finance/payment/payment.service.js').PaymentService;
const ReceiptService = require('./dist/server/modules/finance/receipt/receipt.service.js').ReceiptService;
const PayableService = require('./dist/server/modules/finance/payable/payable.service.js').PayableService;
const ReceivableService = require('./dist/server/modules/finance/receivable/receivable.service.js').ReceivableService;
const ProfitService = require('./dist/server/modules/finance/profit/profit.service.js').ProfitService;
const ReportService = require('./dist/server/modules/report/report.service.js').ReportService;
const DashboardService = require('./dist/server/modules/dashboard/dashboard.service.js').DashboardService;
const AnalyticsService = require('./dist/server/modules/analytics/analytics.service.js').AnalyticsService;

const stub = {};
const svc = {
  payment: new PaymentService(db, stub, stub),
  receipt: new ReceiptService(db, stub, stub),
  payable: new PayableService(db, stub),
  receivable: new ReceivableService(db, stub),
  profit: new ProfitService(db),
  report: new ReportService(db),
  // DashboardService 自缓存改造后需要 cacheManager（线上由全局 CacheModule 提供），
  // 此处用穿透桩：每次都真查库，作用域校验看的是传给 SQL 的条件，不受缓存影响。
  dashboard: new DashboardService(db, {
    get: async () => undefined,
    set: async () => {},
    del: async () => true,
  }),
  analytics: new AnalyticsService(db),
};

const DENY = { type: 'dealer', dealerIds: [] };
const ALLOW = { type: 'all', dealerIds: [] };

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
async function countTable(table) {
  const r = await client.unsafe(`SELECT count(*)::int AS c FROM ${table}`);
  return r[0].c;
}
function run(scope, fn) { return RC.RequestContext.run({ dealerScope: scope }, fn); }

// 把 list 返回统一成 {total, items}
function norm(res) {
  if (res && typeof res === 'object' && 'items' in res) return res;
  if (Array.isArray(res)) return { total: res.length, items: res };
  return { total: 0, items: [] };
}

async function main() {
  // ============ 财务：列表端点 ============
  console.log('\n[财务] 列表端点 dealer 作用域');
  const finCases = [
    ['payment.list', () => svc.payment.list({ page: 1, pageSize: 1000 }), 'finance_payment'],
    ['receipt.list', () => svc.receipt.list({ page: 1, pageSize: 1000 }), 'finance_receipt'],
    ['payable.list', () => svc.payable.list({ page: 1, pageSize: 1000 }), 'payable'],
    ['receivable.list', () => svc.receivable.list({ page: 1, pageSize: 1000 }), 'receivable'],
  ];
  for (const [label, call, tbl] of finCases) {
    const real = await countTable(tbl);
    const denyRes = norm(await run(DENY, call));
    assert(`${label} 拒绝态 total=0（无泄漏）`, Number(denyRes.total) === 0 && denyRes.items.length === 0, { total: denyRes.total, n: denyRes.items.length });
    const allowRes = norm(await run(ALLOW, call));
    if (real > 0) {
      assert(`${label} 放开态 返回真实数据 total>0（无回归）`, Number(allowRes.total) > 0 && allowRes.items.length > 0, { got: allowRes.total, n: allowRes.items.length });
    } else {
      assert(`${label} 放开态 基础表为空 total=0（无回归）`, Number(allowRes.total) === 0, { got: allowRes.total });
    }
  }

  // ============ 财务：明细端点（按 id 注入） ============
  console.log('\n[财务] 明细端点按 id 注入（跨租户 id 命中 0 = NotFound 拦截）');
  // 取一张真实存在的付款单 id（放开态可读），在拒绝态下应抛 NotFound
  const anyPayment = await client.unsafe('SELECT id FROM finance_payment LIMIT 1');
  const anyReceivable = await client.unsafe('SELECT id FROM receivable LIMIT 1');
  const anyPayable = await client.unsafe('SELECT id FROM payable LIMIT 1');
  const anyReceipt = await client.unsafe('SELECT id FROM finance_receipt LIMIT 1');
  if (anyPayment.length) {
    let threw = false;
    try { await run(DENY, () => svc.payment.get(anyPayment[0].id)); } catch (e) { threw = /不存在/.test(e?.message || String(e)); }
    assert('payment.get 拒绝态 跨租户 id → NotFound', threw);
    const ok = await run(ALLOW, () => svc.payment.get(anyPayment[0].id));
    assert('payment.get 放开态 可读', !!ok && ok.id === anyPayment[0].id);
  }
  if (anyReceivable.length) {
    let threw = false;
    try { await run(DENY, () => svc.receivable.getDetail(anyReceivable[0].id)); } catch (e) { threw = /不存在/.test(e?.message || String(e)); }
    assert('receivable.getDetail 拒绝态 跨租户 id → NotFound', threw);
  }
  if (anyPayable.length) {
    let threw = false;
    try { await run(DENY, () => svc.payable.getDetail(anyPayable[0].id)); } catch (e) { threw = /不存在/.test(e?.message || String(e)); }
    assert('payable.getDetail 拒绝态 跨租户 id → NotFound', threw);
  }
  if (anyReceipt.length) {
    let threw = false;
    try { await run(DENY, () => svc.receipt.get(anyReceipt[0].id)); } catch (e) { threw = /不存在/.test(e?.message || String(e)); }
    assert('receipt.get 拒绝态 跨租户 id → NotFound', threw);
  }

  // ============ 报表：6 个主方法 ============
  console.log('\n[报表] 主方法 dealer 作用域');
  const base = { page: 1, pageSize: 1000 };
  const repCases = [
    ['getPurchaseReport', () => svc.report.getPurchaseReport(base), 'purchase_inbound'],
    ['getSalesReport', () => svc.report.getSalesReport(base), 'sales_outbound'],
    ['getRetailReport', () => svc.report.getRetailReport(base), 'retail_order'],
    ['getInventoryReport', () => svc.report.getInventoryReport(base), 'inventory_stock'],
    ['getTransferReport', () => svc.report.getTransferReport(base), 'inventory_transfer'],
    ['getRetailSummary', () => svc.report.getRetailSummary({}), 'retail_order', true],
  ];
  for (const [label, call, tbl, summary] of repCases) {
    const real = await countTable(tbl);
    if (summary) {
      // getRetailSummary 返回 {orderCount,totalQty,totalAmount,avgPrice}（非分页）
      const denyR = await run(DENY, call);
      assert(`${label} 拒绝态 全字段=0（无泄漏）`, Number(denyR.orderCount) === 0 && Number(denyR.totalAmount) === 0 && Number(denyR.totalQty) === 0, denyR);
      const allowR = await run(ALLOW, call);
      assert(`${label} 放开态 返回真实聚合（无回归）`, Number(allowR.orderCount) >= 0 && Number.isFinite(Number(allowR.totalAmount)), allowR);
      continue;
    }
    const denyRes = norm(await run(DENY, call));
    assert(`${label} 拒绝态 total=0（无泄漏）`, Number(denyRes.total) === 0 && denyRes.items.length === 0, { total: denyRes.total, n: denyRes.items.length });
    const allowRes = norm(await run(ALLOW, call));
    // 报表 total 为明细行数（可能大于表头数），放开态应：有基础数据则 >0，无数据则 =0
    if (real > 0) {
      assert(`${label} 放开态 返回真实数据 total>0（无回归）`, Number(allowRes.total) > 0 && allowRes.items.length > 0, { got: allowRes.total, n: allowRes.items.length });
    } else {
      assert(`${label} 放开态 基础表为空 total=0（无回归）`, Number(allowRes.total) === 0, { got: allowRes.total });
    }
  }

  // ============ 看板：趋势/Top/预警 ============
  console.log('\n[看板] dealer 作用域');
  const salesReal = await countTable('sales_outbound');
  const invReal = await countTable('inventory_stock');
  const trendDeny = await run(DENY, () => svc.dashboard.getSalesTrend(3650));
  const trendDenySum = Array.isArray(trendDeny) ? trendDeny.reduce((a, r) => a + Number(r.amount || 0), 0) : -1;
  assert('getSalesTrend 拒绝态 金额合计=0（无泄漏）', trendDenySum === 0, trendDenySum);
  const trendAllow = await run(ALLOW, () => svc.dashboard.getSalesTrend(3650));
  assert('getSalesTrend 放开态 返回数组（无回归）', Array.isArray(trendAllow) && (salesReal === 0 ? true : trendAllow.length > 0));
  const topDeny = await run(DENY, () => svc.dashboard.getTopStyles(10));
  assert('getTopStyles 拒绝态 空数组', Array.isArray(topDeny) && topDeny.length === 0, topDeny && topDeny.length);
  const topAllow = await run(ALLOW, () => svc.dashboard.getTopStyles(10));
  assert('getTopStyles 放开态 返回数组（无回归）', Array.isArray(topAllow) && (salesReal === 0 ? true : topAllow.length > 0));
  const warnDeny = await run(DENY, () => svc.dashboard.getWarnings(10));
  assert('getWarnings 拒绝态 空数组', Array.isArray(warnDeny) && warnDeny.length === 0, warnDeny && warnDeny.length);
  const warnAllow = await run(ALLOW, () => svc.dashboard.getWarnings(10));
  assert('getWarnings 放开态 返回数组（无回归）', Array.isArray(warnAllow));

  // ============ 分析：生命周期 / BI ============
  console.log('\n[分析] dealer 作用域');
  const lifeDeny = await run(DENY, () => svc.analytics.lifecycleList(3650));
  const lifeDenyLeak = Array.isArray(lifeDeny) ? lifeDeny.some((it) => Number(it.recentQty || 0) !== 0) : true;
  assert('lifecycleList 拒绝态 所有款 recentQty=0（无泄漏）', lifeDenyLeak === false, lifeDeny && lifeDeny.length);
  const lifeAllow = await run(ALLOW, () => svc.analytics.lifecycleList(3650));
  assert('lifecycleList 放开态 返回数组（无回归）', Array.isArray(lifeAllow));
  const biDeny = await run(DENY, () => svc.analytics.bi('category'));
  assert('bi 拒绝态 rows 空', biDeny && Array.isArray(biDeny.rows) && biDeny.rows.length === 0, biDeny && biDeny.rows && biDeny.rows.length);
  const biAllow = await run(ALLOW, () => svc.analytics.bi('category'));
  assert('bi 放开态 rows 返回（无回归）', biAllow && Array.isArray(biAllow.rows));

  // ============ 汇总 ============
  console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('sim crashed:', e); process.exit(2); });
