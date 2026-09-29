/**
 * keyset 游标分页端到端验证（真实 DB）—— 针对三个"追加写 + 高流量"列表：
 *   1) SalesOrderService.list        api/sales/order
 *   2) RetailService.getRetailOrderList  api/retail
 *   3) InventoryFlowService.getFlowList  api/inventory/flow
 *
 * 验证点：
 *   A. keyset 全程翻页顺序 == OFFSET 全量基准（顺序一致 / 无重复 / 无遗漏）
 *   B. 同毫秒时间戳下（id tiebreak 生效）仍然一致 —— 这是 keyset 最容易出错的场景
 *   C. 深翻页等价：OFFSET 第 N 页 == keyset 连续翻到第 N 页
 *   D. 游标非法时自动回退 OFFSET，不报错
 *   E. keyset 模式 total 语义 = 当页行数；OFFSET 模式 total = 精确 COUNT
 *   F. 游标越过末页时 rows 为空且 nextCursor 为 undefined
 */
const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');

const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service');
const { RetailService } = require('./dist/server/modules/retail/retail.service');
const { InventoryFlowService } = require('./dist/server/modules/inventory/flow/inventory-flow.service');
const { salesOrder, retailOrder, inventoryFlow } = require('./dist/server/database/schema');

const sql = postgres(URL);
const db = drizzle(sql);

const log = (...a) => console.log(...a);
let failures = 0;
function check(name, ok, extra = '') {
  if (ok) {
    log('  PASS  %s %s', name, extra);
  } else {
    failures += 1;
    log('  FAIL  %s %s', name, extra);
  }
}

const N = 23; // 23 = 2*10 + 3，跨 3 页（10/10/3）
const PAGE = 10;

/** 构造测试数据：前 8 行共用同一毫秒时间戳，强制走 id tiebreak。 */
function buildRows(base, newCustomerId, storeId, warehouseId) {
  const now = new Date(base).getTime();
  const sales = [];
  const retail = [];
  const flow = [];
  for (let i = 0; i < N; i++) {
    const sameTs = i < 8; // 同毫秒块
    const ts = new Date(sameTs ? now : now - (i - 7) * 60000);
    const tag = `OKS_${base}_${i}`;
    sales.push({
      orderNo: tag,
      customerId: newCustomerId,
      customerName: 'keyset-tester',
      orderDate: new Date().toISOString().slice(0, 10), // date 列，postgres.js 需字符串
      totalAmount: '10',
      status: 'draft',
      createdAt: ts,
    });
    retail.push({
      retailNo: `ORT_${base}_${i}`,
      storeId,
      storeName: 'keyset-tester-store',
      saleDate: new Date().toISOString().slice(0, 10), // date 列，postgres.js 需字符串
      source: 'store_pos',
      totalAmount: '10',
      payMethods: [],
      itemCount: 1,
      status: 'draft',
      createdAt: ts,
    });
    flow.push({
      flowType: 'retail_outbound',
      bizNo: `IFT_${base}_${i}`,
      direction: 'out',
      itemType: 'sku',
      warehouseId,
      warehouseName: 'keyset-tester-wh',
      quantity: '1',
      createdAt: ts,
    });
  }
  return { sales, retail, flow };
}

/**
 * keyset 逐页收集 id 列表。遍历会在“取完最后一页数据后再多取一页空页”时终止，
 * 因此末次 total 恒为 0，最后一条非空页的 total 才是当页行数。
 */
async function collectKeyset(fetchPage) {
  const ids = [];
  const totals = [];
  let cursor = null;
  let pages = 0;
  let lastNonEmptyTotal = -1;
  while (true) {
    const r = await fetchPage(cursor);
    ids.push(...r.items.map((x) => x.id));
    totals.push(r.total);
    if (r.items.length > 0) lastNonEmptyTotal = r.total;
    cursor = r.nextCursor ?? null;
    pages += 1;
    if (!cursor || pages > 20) break;
  }
  return { ids, pages, totals, lastNonEmptyTotal };
}

/** keyset 翻到数据耗尽，返回末次（空页）结果。 */
async function walkToEnd(fetchPage) {
  let cursor = null;
  for (let i = 0; i < 20; i += 1) {
    const r = await fetchPage(cursor);
    if (r.items.length === 0) return r;
    cursor = r.nextCursor ?? null;
    if (!cursor) return r;
  }
  throw new Error('walkToEnd 超过最大页数');
}

async function scenarioSales(base) {
  log('\n[1] SalesOrderService.list  sales_order');
  const [cust] = await sql`select id from customer limit 1`;
  if (!cust) throw new Error('需要至少 1 个 customer 作为外键');
  const cid = cust.id;
  const { sales } = buildRows(base, cid, null, null);
  await db.insert(salesOrder).values(sales);

  const svc = new SalesOrderService(db, {});
  try {
    const filter = { customerId: cid };
    const baseRes = await svc.list({ page: 1, pageSize: 100, ...filter });
    const baseline = baseRes.items.map((x) => x.id);
    check('A1 基准条数', baseline.length === N, `got=${baseline.length}`);

    const { ids, pages, lastNonEmptyTotal } = await collectKeyset((cur) =>
      svc.list({ page: 1, pageSize: PAGE, cursor: cur, ...filter }),
    );
    const sameOrder = JSON.stringify(ids) === JSON.stringify(baseline);
    const noDup = new Set(ids).size === ids.length;
    check('A2 keyset 顺序一致', sameOrder);
    check('A3 无重复', noDup);
    check('A4 无遗漏', ids.length === N, `collected=${ids.length}/${N} pages=${pages}`);

    // C. 深翻页等价：OFFSET 第 3 页 vs keyset 翻到第 3 页
    const off3 = (await svc.list({ page: 3, pageSize: PAGE, ...filter })).items.map((x) => x.id);
    const k1 = await svc.list({ page: 1, pageSize: PAGE, ...filter });
    const k2 = await svc.list({ page: 1, pageSize: PAGE, cursor: k1.nextCursor, ...filter });
    const k3 = await svc.list({ page: 1, pageSize: PAGE, cursor: k2.nextCursor, ...filter });
    check('C  深翻页等价(第3页)', JSON.stringify(off3) === JSON.stringify(k3.items.map((x) => x.id)));

    // D. 非法游标回退
    const bad = await svc.list({ page: 1, pageSize: PAGE, cursor: 'not-a-valid-cursor!!', ...filter });
    check('D  非法游标回退 OFFSET', bad.items.length === PAGE && bad.total === N,
      `items=${bad.items.length} total=${bad.total}`);

    // E. total 语义
    check('E1 OFFSET total = 精确 COUNT', baseRes.total === N, `total=${baseRes.total}`);
    check('E2 keyset total = 当页行数', lastNonEmptyTotal === N % PAGE, `total=${lastNonEmptyTotal}`);
  } finally {
    await sql`delete from sales_order where order_no like ${`OKS_${base}_%`}`;
  }
}

async function scenarioRetail(base) {
  log('\n[2] RetailService.getRetailOrderList  retail_order');
  const storeId = '00000000-0000-4000-8000-000000000001';
  const { retail } = buildRows(base, null, storeId, null);
  await db.insert(retailOrder).values(retail);

  const svc = new RetailService(db);
  try {
    const filter = { storeId };
    const baseRes = await svc.getRetailOrderList({ page: 1, pageSize: 100, ...filter });
    const baseline = baseRes.items.map((x) => x.id);
    check('A1 基准条数', baseline.length === N, `got=${baseline.length}`);

    const { ids, pages, lastNonEmptyTotal } = await collectKeyset((cur) =>
      svc.getRetailOrderList({ page: 1, pageSize: PAGE, cursor: cur, ...filter }),
    );
    check('A2 keyset 顺序一致',
      JSON.stringify(ids) === JSON.stringify(baseline));
    check('A3 无重复', new Set(ids).size === ids.length);
    check('A4 无遗漏', ids.length === N, `collected=${ids.length}/${N} pages=${pages}`);

    const off3 = (await svc.getRetailOrderList({ page: 3, pageSize: PAGE, ...filter })).items.map((x) => x.id);
    const k1 = await svc.getRetailOrderList({ page: 1, pageSize: PAGE, ...filter });
    const k2 = await svc.getRetailOrderList({ page: 1, pageSize: PAGE, cursor: k1.nextCursor, ...filter });
    const k3 = await svc.getRetailOrderList({ page: 1, pageSize: PAGE, cursor: k2.nextCursor, ...filter });
    check('C  深翻页等价(第3页)', JSON.stringify(off3) === JSON.stringify(k3.items.map((x) => x.id)));

    const bad = await svc.getRetailOrderList({ page: 1, pageSize: PAGE, cursor: 'xx-xx', ...filter });
    check('D  非法游标回退 OFFSET', bad.items.length === PAGE && bad.total === N,
      `items=${bad.items.length} total=${bad.total}`);

    check('E1 OFFSET total = 精确 COUNT', baseRes.total === N, `total=${baseRes.total}`);
    check('E2 keyset total = 当页行数', lastNonEmptyTotal === N % PAGE, `total=${lastNonEmptyTotal}`);

    // F. 游标越过末页：整段走完后仍带游标再取一次，应返回空且无下一页游标
    const end = await walkToEnd((cur) =>
      svc.getRetailOrderList({ page: 1, pageSize: PAGE, cursor: cur, ...filter }),
    );
    check('F  越过末页 rows 空且无游标',
      end.items.length === 0 && !end.nextCursor,
      `items=${end.items.length} next=${end.nextCursor}`);
  } finally {
    await sql`delete from retail_order where retail_no like ${`ORT_${base}_%`}`;
  }
}

async function scenarioFlow(base) {
  log('\n[3] InventoryFlowService.getFlowList  inventory_flow');
  const warehouseId = '00000000-0000-4000-8000-000000000002';
  const { flow } = buildRows(base, null, null, warehouseId);
  await db.insert(inventoryFlow).values(flow);

  const svc = new InventoryFlowService(db);
  try {
    const filter = { warehouseId };
    const baseRes = await svc.getFlowList({ page: 1, pageSize: 100, ...filter });
    const baseline = baseRes.items.map((x) => x.id);
    check('A1 基准条数', baseline.length === N, `got=${baseline.length}`);

    const { ids, pages, lastNonEmptyTotal } = await collectKeyset((cur) =>
      svc.getFlowList({ page: 1, pageSize: PAGE, cursor: cur, ...filter }),
    );
    check('A2 keyset 顺序一致', JSON.stringify(ids) === JSON.stringify(baseline));
    check('A3 无重复', new Set(ids).size === ids.length);
    check('A4 无遗漏', ids.length === N, `collected=${ids.length}/${N} pages=${pages}`);

    const off3 = (await svc.getFlowList({ page: 3, pageSize: PAGE, ...filter })).items.map((x) => x.id);
    const k1 = await svc.getFlowList({ page: 1, pageSize: PAGE, ...filter });
    const k2 = await svc.getFlowList({ page: 1, pageSize: PAGE, cursor: k1.nextCursor, ...filter });
    const k3 = await svc.getFlowList({ page: 1, pageSize: PAGE, cursor: k2.nextCursor, ...filter });
    check('C  深翻页等价(第3页)', JSON.stringify(off3) === JSON.stringify(k3.items.map((x) => x.id)));

    const bad = await svc.getFlowList({ page: 1, pageSize: PAGE, cursor: 'zz', ...filter });
    check('D  非法游标回退 OFFSET', bad.items.length === PAGE && bad.total === N,
      `items=${bad.items.length} total=${bad.total}`);

    check('E1 OFFSET total = 精确 COUNT', baseRes.total === N, `total=${baseRes.total}`);
    check('E2 keyset total = 当页行数', lastNonEmptyTotal === N % PAGE, `total=${lastNonEmptyTotal}`);
  } finally {
    await sql`delete from inventory_flow where biz_no like ${`IFT_${base}_%`}`;
  }
}

async function run() {
  const leftovers = await Promise.all([
    sql`select count(*)::int as c from sales_order where order_no like 'OKS_test%'`,
    sql`select count(*)::int as c from retail_order where retail_no like 'ORT_test%'`,
    sql`select count(*)::int as c from inventory_flow where biz_no like 'IFT_test%'`,
  ]);
  const before = leftovers.reduce((s, r) => s + r[0].c, 0);
  if (before > 0) {
    log('[cleanup] 清理上次残留 %d 行', before);
    await Promise.all([
      sql`delete from sales_order where order_no like 'OKS_test%'`,
      sql`delete from retail_order where retail_no like 'ORT_test%'`,
      sql`delete from inventory_flow where biz_no like 'IFT_test%'`,
    ]);
  }

  const base = Date.now();
  await scenarioSales(base);
  await scenarioRetail(base);
  await scenarioFlow(base);

  const [after] = await Promise.all([
    Promise.all([
      sql`select count(*)::int as c from sales_order where order_no like 'OKS_test%'`,
      sql`select count(*)::int as c from retail_order where retail_no like 'ORT_test%'`,
      sql`select count(*)::int as c from inventory_flow where biz_no like 'IFT_test%'`,
    ]),
  ]);
  const remain = after.reduce((s, r) => s + r[0].c, 0);
  check('Z  测试数据已清理', remain === 0, `remain=${remain}`);
  await sql.end();

  log(failures === 0 ? '\nKEYSET_LISTS_PASS' : `\nKEYSET_LISTS_FAIL(count=${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
