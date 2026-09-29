/**
 * keyset 行比较改造的端到端真实验证（真实 PG）。
 *
 * 与之前的 raw-SQL 实验不同，这里走"真实 service 代码路径"：
 *   1. 用 InventoryFlowService.getFlowList 逐页翻到"第 5000 页"，拿到真实游标
 *   2. 在 postgres.js 连接层捕获 service 真正执行的 SQL（不是靠 toSQL 反推）
 *   3. 把捕获到的真实 SQL + 参数拿去 EXPLAIN ANALYZE，确认 Index Cond 下推行比较
 *   4. 与同条件的 OFFSET 深翻页对比耗时
 *
 * 数据 20 万行，仅使用库中原有的 idx_inventory_flow_created_at 单列索引（不加任何实验索引），
 * 结论可直接指导生产：是否需要为 keyset 补复合索引。
 * 安全：数据以 biz_no LIKE 'PLAN_%' 打标，脚本结束删除；不新增/删除任何索引。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { InventoryFlowService } = require('./dist/server/modules/inventory/flow/inventory-flow.service');

const TOTAL = 200000;
const PAGE = 20;
const WH = '00000000-0000-4000-8000-000000000002';

let captured = [];
const sql = postgres(DBS, {
  debug: (conn, query, params) => {
    captured.push({ query, params: Array.isArray(params) ? params : [] });
  },
});
const db = drizzle(sql);
const log = (...a) => console.log(...a);

let failures = 0;
function check(name, ok, extra = '') {
  log('  %s  %s %s', ok ? 'PASS' : 'FAIL', name, extra);
  if (!ok) failures += 1;
}

function inline(t, ps) {
  let i = 0;
  return t.replace(/\$\d+/g, () => {
    const v = ps[i];
    i += 1;
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return `'${v.toISOString()}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

async function run() {
  await sql`delete from inventory_flow where biz_no like 'PLAN_%'`;
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  for (let b = 0; b < TOTAL; b += 4000) {
    const vals = [];
    for (let i = 0; i < 4000; i += 1) {
      const k = b + i;
      vals.push({
        flowType: 'retail_outbound', bizNo: `PLAN_${k}`, direction: 'out', itemType: 'sku',
        warehouseId: WH, warehouseName: 'plan-wh', quantity: '1',
        createdAt: new Date(base + k * 1000),
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await db.insert(require('./dist/server/database/schema').inventoryFlow).values(vals);
  }
  await sql`analyze inventory_flow`;
  log('造数完成 %d 行', TOTAL);

  const svc = new InventoryFlowService(db);

  /** 清掉捕获缓冲后调用 service，返回最后一条真实 SQL。 */
  async function capture(fn) {
    captured = [];
    await fn();
    const pick = captured
      .filter((c) => /^select .* from "inventory_flow"/.test(c.query.trim()))
      .pop();
    if (!pick) throw new Error('未捕获到 service 执行的 SELECT');
    return pick;
  }

  // ---------- 1) 逐页翻到深页，拿到真实游标 ----------
  const walkTo = Math.floor(TOTAL / 2); // 第 5000 页
  let p = await svc.getFlowList({ page: 1, pageSize: 1, warehouseId: WH });
  for (let i = 1; i < walkTo; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    p = await svc.getFlowList({ page: 1, pageSize: 1, warehouseId: WH, cursor: p.nextCursor });
  }
  const cursor = p.nextCursor;
  log('已翻到 %d 行处，cursor=%s', walkTo, String(cursor).slice(0, 26) + '…');
  if (!cursor) throw new Error('未拿到游标');

  // ---------- 2) 捕获两条真实 SQL ----------
  const offCap = await capture(() =>
    svc.getFlowList({ page: Math.floor(walkTo / PAGE) + 1, pageSize: PAGE, warehouseId: WH }));
  const keyCap = await capture(() =>
    svc.getFlowList({ page: 1, pageSize: PAGE, warehouseId: WH, cursor }));

  log('\n=== service 真实执行的 OFFSET SQL（节选）===\n  %s',
    inline(offCap.query, offCap.params).replace(/\s+/g, ' ').slice(0, 150) + '…');
  log('=== service 真实执行的 keyset SQL（节选）===\n  %s',
    inline(keyCap.query, keyCap.params).replace(/\s+/g, ' ').slice(0, 150) + '…');

  async function explain(cap) {
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sql.unsafe(`explain (analyze, costs off) ${inline(cap.query, cap.params)}`);
    }
    const rows = await sql.unsafe(`explain (analyze, costs off) ${inline(cap.query, cap.params)}`);
    const txt = rows.map((r) => r['QUERY PLAN']).join('\n');
    const t = txt.match(/Execution Time: ([\d.]+)/);
    const m = txt.match(
      /Index Scan(?: Backward)? using (\S+) on (\S+) \(actual time=[\d.]+..[\d.]+ rows=(\d+)/,
    );
    return {
      ms: t ? parseFloat(t[1]) : NaN,
      idx: m ? m[1] : '(none)',
      idxRows: m ? +m[3] : 0,
      cond: [...txt.matchAll(/Index Cond: (.*)/g)].map((x) => x[1]).join(' | '),
    };
  }

  const offPlan = await explain(offCap);
  const keyPlan = await explain(keyCap);

  log('\n=== 执行计划对比（OFFSET %d, LIMIT %d，仅用原有单列索引）===\n', walkTo, PAGE);
  log('  OFFSET : %s ms  idx=%s  索引返回=%d行', offPlan.ms, offPlan.idx, offPlan.idxRows);
  log('  keyset : %s ms  idx=%s  索引返回=%d行', keyPlan.ms, keyPlan.idx, keyPlan.idxRows);
  log('  keyset Index Cond: %s', keyPlan.cond);

  // PG 会把行比较 (t,id) < (a,b) 化简成可 seek 的区间条件 t <= a 作为 Index Cond，
  // 这正是我们想要的：它让 Index Scan 直接从游标位置开始，而不是扫过前面的行。
  check('Index Cond 含游标时间下界（可 seek）', /_created_at <=/.test(keyPlan.cond),
    keyPlan.cond.slice(0, 100));
  check('索引只返回当页行数（真 seek，非扫描后过滤）', keyPlan.idxRows <= PAGE + 1,
    `idxRows=${keyPlan.idxRows}`);
  check('深翻页 keyset 至少快一个数量级', keyPlan.ms < offPlan.ms / 10,
    `keyset=${keyPlan.ms}ms offset=${offPlan.ms}ms`);

  // ---------- 3) 回归正确性：service 层全量遍历与 OFFSET 全量一致 ----------
  const allKey = [];
  let cur = null;
  for (let i = 0; i < TOTAL / PAGE + 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await svc.getFlowList({ page: 1, pageSize: PAGE, warehouseId: WH, cursor: cur });
    allKey.push(...r.items.map((x) => x.id));
    if (!r.nextCursor) break;
    cur = r.nextCursor;
  }
  const allOff = [];
  for (let pg = 1; allOff.length < TOTAL; pg += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await svc.getFlowList({ page: pg, pageSize: PAGE, warehouseId: WH });
    allOff.push(...r.items.map((x) => x.id));
  }
  check('深翻页全量遍历与 OFFSET 全量一致',
    JSON.stringify(allKey) === JSON.stringify(allOff),
    `keyset=${allKey.length} offset=${allOff.length}`);

  // ---------- 4) 清理 ----------
  captured = [];
  await sql`delete from inventory_flow where biz_no like 'PLAN_%'`;
  const [c] = await sql`select count(*)::int as c from inventory_flow`;
  const [left] = await sql`select count(*)::int as c from inventory_flow where biz_no like 'PLAN_%'`;
  check('数据清理干净', left.c === 0 && c.c === 0, `total=${c.c} left=${left.c}`);
  await sql.end();

  log(failures === 0 ? '\nKEYSET_PLAN_PASS' : `\nKEYSET_PLAN_FAIL(count=${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
