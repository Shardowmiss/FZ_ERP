/**
 * 根因定位：为什么 keyset 没能 O(M) Seek。
 *
 * 观察：EXPLAIN 里 keyset 的 Index Cond 只有 warehouse_id，没有 _created_at/id，
 *       说明 drizzle 生成的 OR 形式游标条件 (t < a OR (t = a AND id < b))
 *       没有被 planner 下推成索引条件。而 btree 支持"行比较" (t, id) < (a, b)，
 *       该形式可以下推。本脚本对比三种写法的执行计划与耗时。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { inventoryFlow } = require('./dist/server/database/schema');

const TOTAL = 200000;
const PAGE = 20;
const WH = '00000000-0000-4000-8000-000000000002';
const OLD_IDX = 'idx_inventory_flow_created_at';
const NEW_IDX = 'idx_probe3_wh_created_id';

const sql = postgres(DBS);
const db = drizzle(sql);
const log = (...a) => console.log(...a);

async function plan(q) {
  const rows = await sql.unsafe(`explain (analyze, costs off) ${q}`);
  const txt = rows.map((r) => r['QUERY PLAN']).join('\n');
  const t = txt.match(/Execution Time: ([\d.]+)/);
  const used = [...txt.matchAll(/Index Scan(?: Backward)? using (\S+)/g)].map((m) => m[1]);
  const cond = [...txt.matchAll(/Index Cond: (.*)/g)].map((m) => m[1]).join(' | ') || '(无)';
  const m = txt.match(/Index Scan(?: Backward)? using \S+ on \S+ \(actual time=[\d.]+..[\d.]+ rows=(\d+)/);
  return { ms: t ? parseFloat(t[1]) : NaN, used, cond, idxRows: m ? +m[1] : 0 };
}

async function bench(tag, q) {
  for (let i = 0; i < 3; i += 1) await plan(q);
  const p = await plan(q);
  log('  %s : %s ms  idx=%s  索引返回=%d行', tag.padEnd(10), String(p.ms).padEnd(8),
    p.used.join(',') || '(none)', p.idxRows);
  log('      Index Cond: %s', p.cond);
  return p.ms;
}

async function run() {
  await sql`delete from inventory_flow where biz_no like 'IDX3_%'`;
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  for (let b = 0; b < TOTAL; b += 4000) {
    const vals = [];
    for (let i = 0; i < 4000; i += 1) {
      const k = b + i;
      vals.push({
        flowType: 'retail_outbound', bizNo: `IDX3_${k}`, direction: 'out', itemType: 'sku',
        warehouseId: WH, warehouseName: 'perf-wh', quantity: '1',
        createdAt: new Date(base + k * 1000),
      });
    }
    await db.insert(inventoryFlow).values(vals);
  }
  await sql`analyze inventory_flow`;
  log('造数完成 %d 行', TOTAL);

  // 游标锚点：取"第 10 万页"那一行（时间中位数附近，代表真实翻页位置）
  const [anchor] = await sql`
    select _created_at, id from inventory_flow order by _created_at desc, id desc offset ${Math.floor(TOTAL / 2)} limit 1`;
  const ts = new Date(anchor._created_at).toISOString();
  const aid = anchor.id;
  const whLit = `'${WH}'`;

  const qs = {
    offset: `select * from inventory_flow where warehouse_id = ${whLit}
               order by _created_at desc, id desc limit ${PAGE} offset ${Math.floor(TOTAL / 2)}`,
    orForm: `select * from inventory_flow where warehouse_id = ${whLit}
               and ((_created_at < '${ts}') or (_created_at = '${ts}' and id < '${aid}'))
               order by _created_at desc, id desc limit ${PAGE}`,
    rowForm: `select * from inventory_flow where warehouse_id = ${whLit}
               and (_created_at, id) < ('${ts}'::timestamptz, '${aid}'::uuid)
               order by _created_at desc, id desc limit ${PAGE}`,
  };

  log('\n=== A. 只有 _created_at 单列索引 ===');
  const aOff = await bench('OFFSET', qs.offset);
  const aOr = await bench('OR 形式', qs.orForm);
  await bench('行比较', qs.rowForm);

  log('\n=== B. 只有复合索引 (warehouse_id, created_at DESC, id DESC) ===');
  await sql.unsafe(`create index if not exists ${NEW_IDX}
    on inventory_flow (warehouse_id, _created_at desc, id desc)`);
  await sql.unsafe(`drop index if exists ${OLD_IDX}`);
  await sql`analyze inventory_flow`;
  const bOff = await bench('OFFSET', qs.offset);
  const bOr = await bench('OR 形式', qs.orForm);
  const bRow = await bench('行比较', qs.rowForm);

  log('\n===== 汇总（第 %d 页，20 行）=====', Math.floor(TOTAL / 2 / PAGE));
  log('            OFFSET    OR 形式    行比较');
  log(' 单列索引  : %s ms  %s ms  %s ms', aOff, aOr, aOff);
  log(' 复合索引  : %s ms  %s ms  %s ms', bOff, bOr, bRow);

  // 还原
  await sql.unsafe(`drop index if exists ${NEW_IDX}`);
  await sql.unsafe(`create index if not exists ${OLD_IDX} on inventory_flow (_created_at)`);
  await sql`analyze inventory_flow`;
  await sql`delete from inventory_flow where biz_no like 'IDX3_%'`;
  const [c] = await sql`select count(*)::int as c from inventory_flow where biz_no like 'IDX3_%'`;
  const [i1] = await sql`select count(*)::int as c from pg_indexes where indexname = ${OLD_IDX}`;
  log('\n还原完成：残留 %d 行，原索引恢复=%s', c.c, i1.c === 1);
  await sql.end();
}

run().catch(async (e) => { console.error(e); await sql.end(); process.exit(2); });
