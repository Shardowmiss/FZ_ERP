/**
 * 决定性实验：深翻页场景下 keyset 能否做到 O(M) Seek。
 *
 * 假设：只要存在 (过滤列, created_at DESC, id DESC) 复合索引，带等值过滤的 keyset 查询
 *       就能在过滤分区内直接 seek 到游标位置，耗时与"翻到第几页"无关。
 * 做法：临时卸载 idx_inventory_flow_created_at（测完还原），排除成本模型的干扰。
 * 安全：造数 IDX2_% 打标，索引测完全部还原。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { inventoryFlow } = require('./dist/server/database/schema');

const TOTAL = 200000;
const PAGE = 20;
const WH = '00000000-0000-4000-8000-000000000002';
const OLD_IDX = 'idx_inventory_flow_created_at';

const sql = postgres(DBS);
const db = drizzle(sql);
const log = (...a) => console.log(...a);

async function plan(q) {
  const rows = await sql.unsafe(`explain (analyze, costs off) ${q}`);
  const txt = rows.map((r) => r['QUERY PLAN']).join('\n');
  const t = txt.match(/Execution Time: ([\d.]+)/);
  const used = [...txt.matchAll(/Index Scan(?: Backward)? using (\S+)/g)].map((m) => m[1]);
  const cond = [...txt.matchAll(/Index Cond: (.*)/g)].map((m) => m[1]);
  const scanned = txt.match(/Index Scan(?: Backward)? using \S+ on \S+ \(actual time=[\d.]+..[\d.]+ rows=(\d+)/);
  return { ms: t ? parseFloat(t[1]) : NaN, used, cond, scannedRows: scanned ? +scanned[1] : 0, txt };
}

async function measure(tag, offsetQ, keysetQ) {
  for (let i = 0; i < 2; i += 1) { await plan(offsetQ); await plan(keysetQ); } // 预热
  const o = await plan(offsetQ);
  const k = await plan(keysetQ);
  log('\n--- %s ---', tag);
  log('  OFFSET : %s ms  (used=%s)', o.ms, o.used.join(',') || '(none)');
  log('  keyset : %s ms  (used=%s, 索引返回行数=%d)', k.ms, k.used.join(',') || '(none)', k.scannedRows);
  log('  keyset Index Cond: %s', k.cond.join(' | ') || '(无)');
  return { o: o.ms, k: k.ms };
}

async function run() {
  await sql`delete from inventory_flow where biz_no like 'IDX2_%'`;
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  for (let b = 0; b < TOTAL; b += 4000) {
    const vals = [];
    for (let i = 0; i < 4000; i += 1) {
      const k = b + i;
      vals.push({
        flowType: 'retail_outbound', bizNo: `IDX2_${k}`, direction: 'out', itemType: 'sku',
        warehouseId: WH, warehouseName: 'perf-wh', quantity: '1',
        createdAt: new Date(base + k * 1000),
      });
    }
    await db.insert(inventoryFlow).values(vals);
  }
  await sql`analyze inventory_flow`;
  log('造数完成 %d 行', TOTAL);

  const [anchor] = await sql`
    select _created_at, id from inventory_flow order by _created_at desc, id desc offset ${TOTAL - 1 - 750} limit 1`;
  const ts = new Date(anchor._created_at).toISOString();
  const aid = anchor.id;
  const keysetQ = `select * from inventory_flow where warehouse_id = '${WH}'
     and ((_created_at < '${ts}') or (_created_at = '${ts}' and id < '${aid}'))
     order by _created_at desc, id desc limit ${PAGE}`;
  const offsetQ = `select * from inventory_flow where warehouse_id = '${WH}'
     order by _created_at desc, id desc limit ${PAGE} offset ${TOTAL - 750}`;

  const r0 = await measure('A. 仅有 _created_at 单列索引', offsetQ, keysetQ);

  // 建复合索引并卸掉单列索引，只留复合索引
  await sql.unsafe(`create index if not exists idx_probe2_wh_created_id
    on inventory_flow (warehouse_id, _created_at desc, id desc)`);
  await sql.unsafe(`drop index if exists ${OLD_IDX}`);
  await sql`analyze inventory_flow`;
  const r1 = await measure('B. 仅有 (warehouse_id, created_at DESC, id DESC)', offsetQ, keysetQ);

  // 浅翻页对照（第 1 页，两者都应<1ms）
  const shallowOffset = `select * from inventory_flow where warehouse_id = '${WH}'
     order by _created_at desc, id desc limit ${PAGE}`;
  const shallowKeyset = `select * from inventory_flow where warehouse_id = '${WH}'
     and ((_created_at < '9999-12-31') or (_created_at = '9999-12-31' and id < ''))
     order by _created_at desc, id desc limit ${PAGE}`;
  const r2 = await measure('C. 同条件浅翻页（对照上限）', shallowOffset, shallowKeyset);

  log('\n===== 汇总 =====');
  log('  深翻页 OFFSET      : %s ms', r0.o);
  log('  深翻页 keyset(单列) : %s ms  → %sx', r0.k, (r0.o / r0.k).toFixed(1));
  log('  深翻页 keyset(复合) : %s ms  → %sx', r1.k, (r1.o / r1.k).toFixed(1));
  log('  浅翻页 OFFSET      : %s ms  （keyset 的理论下限）', r2.o);

  // 还原
  await sql.unsafe(`drop index if exists idx_probe2_wh_created_id`);
  await sql.unsafe(`create index if not exists ${OLD_IDX} on inventory_flow (_created_at)`);
  await sql`analyze inventory_flow`;
  await sql`delete from inventory_flow where biz_no like 'IDX2_%'`;
  const [after] = await sql`select count(*)::int as c from inventory_flow where biz_no like 'IDX2_%'`;
  const [idxOk] = await sql`
    select count(*)::int as c from pg_indexes where indexname = ${OLD_IDX}`;
  log('\n还原完成：残留数据 %d 行，原索引恢复=%s', after.c, idxOk.c === 1);
  await sql.end();
}

run().catch(async (e) => { console.error(e); await sql.end(); process.exit(2); });
