/**
 * P1-c④「报表/分析/看板强制时间窗」的真实验证（真 PG，真 service 路径）。
 *
 * 分三段：
 *   A) resolveReportWindow 纯函数的边界语义（默认窗口 / 显式等价 / 豁免 / 非法输入）
 *   B) 走真实 service 方法，在 postgres.js 连接层捕获**真正执行的 SQL**，
 *      断言时间下界确实出现在 WHERE 里，且"显式传参时口径与改造前等价"
 *   C) 造 5 万行 inventory_transfer，对比「注入时间窗 + 新索引」与「全量扫描」
 *      的 EXPLAIN ANALYZE，确认护栏不是纸面功夫
 *
 * 安全：只 INSERT/DELETE 带 RW_ 前缀标记的数据，脚本结束全部删除；不删任何既有数据。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');

const {
  resolveReportWindow,
  describeReportWindow,
  DEFAULT_REPORT_WINDOW_DAYS,
} = require('./dist/server/common/report-window');
const { ReportService } = require('./dist/server/modules/report/report.service');
const { DashboardService } = require('./dist/server/modules/dashboard/dashboard.service');
const { AnalyticsService } = require('./dist/server/modules/analytics/analytics.service');
const { RetailReportService } = require('./dist/server/modules/retail/retail-report.service');

const log = (...a) => console.log(...a);
let failures = 0;
function check(name, ok, extra = '') {
  log('  %s  %s %s', ok ? 'PASS' : 'FAIL', name, extra);
  if (!ok) failures += 1;
}

let captured = [];
const sql = postgres(DBS, {
  debug: (conn, query, params) => {
    captured.push({ query, params: Array.isArray(params) ? params : [] });
  },
});
const db = drizzle(sql);

const cacheStub = {
  get: async () => null,
  set: async () => true,
  del: async () => true,
};

function inline(t, ps) {
  let i = 0;
  return t.replace(/\$\d+/g, () => {
    const v = ps[i];
    i += 1;
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

/**
 * 执行 fn 并返回连接层捕获到的、命中过滤器的全部 SQL（内联参数后的文本）。
 * 过滤器针对**原始** SQL：表可能以 `from "x"` 或 `join "x"` 出现，两种都要算命中。
 */
async function cap(fn, filter) {
  captured = [];
  await fn();
  return captured
    .filter((c) => filter(c.query))
    .map((c) => inline(c.query, c.params));
}

/**
 * 命中某张表的原始 SQL 过滤器。
 * 用 `\b表名\b` 而不是 `"表名"`：drizzle 的 `sql` 模板（透视/BI 走 db.execute）产出的
 * SQL 里表名**没有引号**，只有查询构造器产出的才有，两种都要命中。
 * 而 `\b` 能保证 `retail_order` 不会误命中 `retail_order_item`。
 */
function hits(table) {
  return (q) => new RegExp(`\\b${table}\\b`).test(q);
}

// 断言辅助：只认「内联后」的半开区间写法 `>= 'YYYY-MM-DD'` 与 `< 'YYYY-MM-DD'`。
// 注意：必须和 report-window.ts 输出的口径一致（半开区间），否则断言会自欺欺人。
const UPPER_RE = />= '(\d{4}-\d{2}-\d{2})'/g;
const LOWER_RE = /< '(\d{4}-\d{2}-\d{2})'/g;
const upperDates = (txt) => [...txt.matchAll(UPPER_RE)].map((m) => m[1]);
const lowerDates = (txt) => [...txt.matchAll(LOWER_RE)].map((m) => m[1]);
const hasUpperBound = (txt) => upperDates(txt).length > 0;
const hasLowerBound = (txt) => lowerDates(txt).length > 0;
const anyBound = (txt) => upperDates(txt).length + lowerDates(txt).length;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const today = todayStr();
  const svc = new ReportService(db);
  const dash = new DashboardService(db, cacheStub);
  const ana = new AnalyticsService(db);
  const retailReport = new RetailReportService(db);
  const RE_T = hits('retail_order');
  const RE_TI = hits('inventory_transfer');
  const RE_S = hits('sales_outbound');
  const RE_PI = hits('purchase_inbound');
  const RE_SOI = hits('sales_outbound_item');
  const RE_ROI = hits('retail_order_item');
  const RE_PIV = hits('garment_purchase_inbound_sku');

  // ===================== A) 纯函数语义 =====================
  log('\n=== A) resolveReportWindow 纯函数 ===');
  const NOW = new Date('2026-09-23T18:00:00+08:00');
  const W = resolveReportWindow({ now: NOW });
  check('无参时注入默认窗口', W !== undefined && W.startDefaulted && W.endDefaulted,
    describeReportWindow(W));
  check(`默认回看 ${DEFAULT_REPORT_WINDOW_DAYS} 天（含今天）`,
    W.start === '2026-06-26' && W.endExclusive === '2026-09-24',
    `start=${W.start} endExclusive=${W.endExclusive}`);

  const W2 = resolveReportWindow({ startDate: '2026-01-01', endDate: '2026-01-31', now: NOW });
  check('显式传参：下界原样保留', W2.start === '2026-01-01');
  check('显式传参：上界 = endDate+1（与改造前 lt(endDate) 等价）',
    W2.endExclusive === '2026-02-01', `endExclusive=${W2.endExclusive}`);
  check('显式传参：不再打 defaulted 标记', !W2.startDefaulted && !W2.endDefaulted);

  const W3 = resolveReportWindow({ endDate: '2026-03-31', windowDays: 7, now: NOW });
  check('只传 end + windowDays：窗口末端对齐 end',
    W3.endExclusive === '2026-04-01' && W3.windowDays === 7 && W3.start === '2026-03-25',
    `${W3.start} ~ ${W3.endExclusive}`);

  const W4 = resolveReportWindow({ allowFullRange: true, now: NOW });
  check('allowFullRange 显式豁免 → undefined（全量）', W4 === undefined);
  const W5 = resolveReportWindow({ windowDays: 0, now: NOW });
  check('windowDays<=0 等价豁免', W5 === undefined);

  const W6 = resolveReportWindow({ startDate: '2026-12-31', endDate: '2026-12-31', now: NOW });
  check('跨年边界：2026-12-31 → 2027-01-01', W6.endExclusive === '2027-01-01',
    `endExclusive=${W6.endExclusive}`);

  let threw = null;
  try { resolveReportWindow({ startDate: '2026/01/01' }); } catch (e) { threw = e; }
  check('非法日期格式抛 BadRequestException', threw && threw.constructor.name === 'BadRequestException',
    threw ? String(threw.message).slice(0, 40) : '(no throw)');

  // ===================== B) 真实 service 路径 =====================
  log('\n=== B) 真实 service 执行的 SQL 是否带时间下界 ===');
  const RS = { page: 1, pageSize: 5 };

  const c1 = await cap(() => svc.getRetailSummary({}), RE_T);
  if (process.env.RW_DEBUG) log('  [debug] %s', (c1[0] || '(none)').slice(0, 300));
  check('getRetailSummary 无参：WHERE 含时间下界（下界+上界）',
    c1.length > 0 && c1.every((t) => hasUpperBound(t) && hasLowerBound(t)),
    c1[0] ? `>=${upperDates(c1[0])[0]} <${lowerDates(c1[0])[0]}` : '(no sql)');

  const c2 = await cap(() => svc.getRetailSummary({ startDate: '2026-01-01', endDate: '2026-01-31', page: 1, pageSize: 5 }), RE_T);
  check('getRetailSummary 显式传参：沿用同一时间窗（口径与改造前等价）',
    c2.length > 0 && c2.every((t) => upperDates(t).includes('2026-01-01') && lowerDates(t).includes('2026-02-01')),
    c2[0] ? `>=${upperDates(c2[0])[0]} <${lowerDates(c2[0])[0]}` : '(no sql)');

  const c3 = await cap(() => svc.getRetailSummary({ allowFullRange: true, page: 1, pageSize: 5 }), RE_T);
  check('getRetailSummary 显式豁免：WHERE 无任何日期边界',
    c3.length > 0 && c3.every((t) => anyBound(t) === 0));

  for (const [name, fn, re] of [
    ['getSalesReport', () => svc.getSalesReport({ ...RS }), RE_S],
    ['getPurchaseReport', () => svc.getPurchaseReport({ ...RS }), RE_PI],
    ['getTransferReport', () => svc.getTransferReport({ ...RS }), RE_TI],
    ['getRetailReport', () => svc.getRetailReport({ ...RS }), RE_ROI],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const cs = await cap(fn, re);
    check(`${name} 无参：WHERE 含时间下界`,
      cs.length > 0 && cs.every((t) => hasUpperBound(t) && hasLowerBound(t)),
      cs[0] ? `>=${upperDates(cs[0])[0]} <${lowerDates(cs[0])[0]}` : '(no sql)');
  }

  const pv = await cap(() => svc.getPivotData({
    dataSource: 'purchase', rows: ['brand'], cols: [],
    values: [{ key: 'quantity', agg: 'sum', label: '数量' }], filters: [],
  }), RE_PIV);
  check('透视 purchase 无日期：WHERE 含时间下界',
    pv.length > 0 && hasUpperBound(pv[0]) && hasLowerBound(pv[0]),
    pv[0] ? `>=${upperDates(pv[0])[0]} <${lowerDates(pv[0])[0]}` : '(no sql)');

  const pvAll = await cap(() => svc.getPivotData({
    dataSource: 'purchase', rows: ['brand'], cols: [],
    values: [{ key: 'quantity', agg: 'sum', label: '数量' }], filters: [],
    allowFullRange: true,
  }), RE_PIV);
  check('透视 purchase 显式豁免：无日期边界', pvAll.length > 0 && anyBound(pvAll[0]) === 0);

  let invErr = null;
  try {
    await svc.getPivotData({
      dataSource: 'inventory', rows: ['month'], cols: [],
      values: [{ key: 'quantity', agg: 'sum', label: '数量' }], filters: [],
    });
  } catch (e) { invErr = e; }
  check('透视 inventory + month 维度被校验层拦下（既有缺陷修复）',
    !!invErr && invErr.constructor.name === 'BadRequestException',
    invErr ? String(invErr.message).slice(0, 30) : '(未报错！)');

  const ts90 = await cap(() => dash.getTopStyles(10, 90), RE_SOI);
  check('看板 topStyles(days=90)：含时间下界', ts90.length > 0 && hasUpperBound(ts90[0]),
    ts90[0] ? `>=${upperDates(ts90[0])[0]}` : '(no sql)');
  const ts0 = await cap(() => dash.getTopStyles(10, 0), RE_SOI);
  check('看板 topStyles(days=0)：无时间边界（显式豁免）',
    ts0.length > 0 && anyBound(ts0[0]) === 0);

  const b1 = await cap(() => ana.bi('warehouse', 'amount'), RE_SOI);
  check('BI 钻取无 from/to：含时间下界', b1.length > 0 && hasUpperBound(b1[0]),
    b1[0] ? `>=${upperDates(b1[0])[0]}` : '(no sql)');

  const rr = await cap(() => retailReport.getReport({
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    storeId: null,
    brand: 'RW_BRAND',
    page: 1,
    pageSize: 5,
  }), RE_ROI);
  const rrTxt = rr.join(' ');
  const upperCount = upperDates(rrTxt).length;
  check('retail-report brand 子查询也带时间窗（既有缺陷修复）', rr.length > 0 && upperCount >= 2,
    `时间下界出现 ${upperCount} 次（主查询+brand 子查询）`);

  // ===================== C) 性能对比 =====================
  log('\n=== C) 造数 5 万行 inventory_transfer 后的执行计划对比 ===');
  const MARK = 'RW_T%';
  // from_warehouse_id / to_warehouse_id 有 FK 指向 warehouse，必须用真实存在的 id。
  const whRows = await sql.unsafe("select id::text as id, name from warehouse order by code limit 2");
  if (whRows.length < 2) throw new Error('仓库不足 2 个，无法造调拨数据');
  const [WH, WH2] = [whRows[0].id, whRows[1].id];
  await sql.unsafe(
    "delete from inventory_transfer_item where transfer_id in (select id from inventory_transfer where transfer_no like $1)",
    [MARK],
  );
  await sql.unsafe('delete from inventory_transfer where transfer_no like $1', [MARK]);

  // 造 inventory_transfer 主表。
  // 关键：日期区间必须**覆盖默认窗口**（今天往前 REPORT_WINDOW_DAYS 天），否则"有界"
  // 查询扫到 0 行，耗时对比就没有意义（上一版铺 2024-2025 区间，默认窗口落在 2025 之后，
  // 结果只扫到库里原有的 10 行）。这里铺"今天往前 730 天 ~ 今天"。
  const DAY = 86400000;
  const BASE = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - 730 * DAY;
  const N = 50000;
  const BATCH = 4000;
  for (let b = 0; b < N; b += BATCH) {
    const rows = [];
    const args = [];
    for (let i = 0; i < BATCH; i += 1) {
      const k = b + i;
      const d = new Date(BASE + (k % 730) * 86400000).toISOString().slice(0, 10);
      rows.push(`($${args.length + 1},$${args.length + 2},$${args.length + 3},$${args.length + 4},$${args.length + 5},$${args.length + 6},$${args.length + 7},$${args.length + 8},$${args.length + 9})`);
      // 注意：postgres.js 不接受 JS Date 作为未指定类型参数（ERR_INVALID_ARG_TYPE），
      // 这里统一传 ISO 字符串。与 keyset 那次 drizzle sql 模板的坑同源。
      args.push(
        `RW_T${k}`, WH, whRows[0].name, WH2, whRows[1].name,
        d, 'sku', 'draft', new Date(BASE + (k % 730) * 86400000).toISOString(),
      );
    }
    // 用 RETURNING 直接拿新 id，避免再回查一次（回查要 order by 全表排序，是造数慢的主因）。
    // eslint-disable-next-line no-await-in-loop
    const ids = await sql.unsafe(
      'insert into inventory_transfer (transfer_no,from_warehouse_id,from_warehouse_name,to_warehouse_id,to_warehouse_name,transfer_date,item_type,status,_created_at) values '
      + rows.join(',')
      + ' returning id',
      args,
    );
    const irows = [];
    const iargs = [];
    for (let j = 0; j < ids.length; j += 1) {
      irows.push(`($${iargs.length + 1},$${iargs.length + 2},$${iargs.length + 3},$${iargs.length + 4},$${iargs.length + 5},$${iargs.length + 6},$${iargs.length + 7})`);
      iargs.push(ids[j].id, null, `RW-ITEM-${b}`, 'RW 款', '均', '1',
        new Date(BASE + ((b * BATCH) % 730) * DAY).toISOString());
    }
    // eslint-disable-next-line no-await-in-loop
    await sql.unsafe(
      'insert into inventory_transfer_item (transfer_id,sku_id,item_code,item_name,color,quantity,_created_at) values '
      + irows.join(','),
      iargs,
    );
  }
  await sql`analyze inventory_transfer`;
  await sql`analyze inventory_transfer_item`;
  const [cnt] = await sql`select count(*)::int as c from inventory_transfer where transfer_no like ${MARK}`;
  const [itemCnt] = await sql`select count(*)::int as c from inventory_transfer_item i join inventory_transfer t on i.transfer_id = t.id where t.transfer_no like ${MARK}`;
  check('造数落库', cnt.c >= N && itemCnt.c >= N, `transfer=${cnt.c} item=${itemCnt.c}（目标 ${N}）`);

  const win = resolveReportWindow({ now: new Date() });

  /** 取 service 真实执行的 SQL 做 EXPLAIN ANALYZE（复用 3 次消除首次开销）。 */
  async function plan(fn, re) {
    const cs = await cap(fn, re);
    if (!cs.length) throw new Error('未捕获到 SQL');
    const txt = cs[0];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sql.unsafe(`explain (analyze, buffers) ${txt}`);
    }
    const rows = await sql.unsafe(`explain (analyze, buffers) ${txt}`);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    const ms = /Execution Time: ([\d.]+)/.exec(plan);
    const scans = [...plan.matchAll(/Seq Scan on (\S+)/g)].map((m) => m[1]);
    const idxScan = /Index Scan(?: Backward)? using (\S+)/.exec(plan);
    return {
      ms: ms ? parseFloat(ms[1]) : NaN,
      seq: scans,
      idx: idxScan ? idxScan[1] : '(none)',
      plan,
      rows: /rows=(\d+)/.exec(plan) ? Number(/rows=(\d+)/.exec(plan)[1]) : 0,
      txt,
    };
  }

  log('\n  --- getTransferReport：注入时间窗（有界）---');
  const bounded = await plan(
    () => svc.getTransferReport({ page: 1, pageSize: 20 }),
    RE_TI,
  );
  log('  耗时=%sms  SeqScan=%s', bounded.ms, JSON.stringify(bounded.seq));
  if (process.env.RW_DEBUG) log('%s', bounded.plan);

  log('\n  --- getTransferReport：allowFullRange（无界，改造前的行为）---');
  const full = await plan(
    () => svc.getTransferReport({ page: 1, pageSize: 20, allowFullRange: true }),
    RE_TI,
  );
  log('  耗时=%sms  SeqScan=%s', full.ms, JSON.stringify(full.seq));
  if (process.env.RW_DEBUG) log('%s', full.plan);

  check('无界版本确实在扫全表', full.seq.includes('inventory_transfer'), JSON.stringify(full.seq));
  check('时间窗版本快于无界版本', bounded.ms < full.ms,
    `bounded=${bounded.ms}ms full=${full.ms}ms (~${(full.ms / Math.max(bounded.ms, 0.01)).toFixed(1)}x)`);

  // 关键澄清：报表 SQL 以 inventory_transfer_item 为驱动表，planner 不会把
  // transfer_date 下界带进 Index Cond —— 加了索引也不等于这条 SQL 走索引。
  // 这里单独验证：以 inventory_transfer 为主表的查询确实能用上新索引。
  log('\n  --- 单表对照：新索引 idx_inventory_transfer_transfer_date 是否被用上 ---');
  async function singlePlan(cond) {
    const rows = await sql.unsafe(
      `explain (analyze) select count(*) from inventory_transfer t where ${cond}`,
    );
    const p = rows.map((r) => r['QUERY PLAN']).join('\n');
    const ms = /Execution Time: ([\d.]+)/.exec(p);
    // 坑：PG 打印索引行时两种动词——普通索引是 "Index Scan **using** idx_x"，
    // Bitmap 却是 "Bitmap Index Scan **on** idx_x"。只认 using 会把 Bitmap 形态误判成"没走索引"。
    const used = /Index (?:Only )?Scan\s+(?:Backward\s+)?(?:using|on)\s+(\S+)/.exec(p);
    const bitmap = /Bitmap Index Scan\s+(?:using\s+|on\s+)(\S+)/.exec(p);
    const condLine = /Index Cond: (.*)/.exec(p);
    // 取"主扫描节点"这一行的实际行数，用来证明确实扫到了造的数据（而不是空跑）。
    // 注意两点：① Aggregate 节点自身也是 rows=1，必须锁定扫描节点那一行；
    // ② 计划行形如 "  ->  Bitmap Heap Scan on t ..."，箭头后是**两个空格**，
    //    用 \S+ 去吞前缀会漏掉空格数，所以这里直接按行匹配。
    const scanLine = p.split('\n').find((l) => /Seq Scan|Heap Scan/.test(l));
    const m = scanLine ? /rows=(\d+)/.exec(scanLine) : null;
    return {
      ms: ms ? parseFloat(ms[1]) : NaN,
      idx: (used || bitmap) ? ((used || bitmap)[1]) : null,
      cond: condLine ? condLine[1] : '',
      actual: m ? Number(m[1]) : 0,
      plan: p,
    };
  }
  // 用**默认窗口本身**做单表对照，确保与造数区间重叠（否则扫 0 行，结论无意义）。
  const sBounded = await singlePlan(
    `item_type = 'sku' and transfer_date >= '${win.start}' and transfer_date < '${win.endExclusive}'`,
  );
  const sFull = await singlePlan("item_type = 'sku'");
  log('  有界（窗口 %s ~ %s）：耗时=%sms  索引=%s  实际命中=%s行',
    win.start, win.endExclusive, sBounded.ms, sBounded.idx ?? '(无)', sBounded.actual);
  log('        Index Cond=%s', sBounded.cond);
  log('  无界：耗时=%sms  索引=%s  实际命中=%s行', sFull.ms, sFull.idx ?? '(无)', sFull.actual);
  if (process.env.RW_DEBUG) {
    log('  完整计划:\n%s', sBounded.plan);
  }
  check('有界对照确实命中造数区间（非空跑）', sBounded.actual > 1000, `actual=${sBounded.actual} 行`);
  check('以 transfer 为主表的有界查询命中新索引', sBounded.idx === 'idx_inventory_transfer_transfer_date',
    String(sBounded.idx));
  check('有界查询明显快于无界查询', sBounded.ms < sFull.ms,
    `bounded=${sBounded.ms}ms full=${sFull.ms}ms`);

  // ------------------------------------------------------------------
  // 清理
  // ------------------------------------------------------------------
  await sql.unsafe(
    "delete from inventory_transfer_item where transfer_id in (select id from inventory_transfer where transfer_no like $1)",
    [MARK],
  );
  await sql.unsafe('delete from inventory_transfer where transfer_no like $1', [MARK]);
  const [left] = await sql`select count(*)::int as c from inventory_transfer where transfer_no like ${MARK}`;
  const [lleft] = await sql`select count(*)::int as c from inventory_transfer_item`;
  const [back] = await sql`select count(*)::int as c from inventory_transfer`;
  check('数据清理干净', left.c === 0, `transfer 残留=${left.c} 全局 transfer=${back.c} item=${lleft.c}`);
}

main()
  .then(() => {
    log('\n===== %s =====', failures === 0 ? 'REPORT_WINDOW_PASS' : `REPORT_WINDOW_FAIL(${failures})`);
    // postgres.js 的连接池会 keep-alive，不显式退出进程会一直挂着（旧版脚本因此被误判为超时）。
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(2); });
