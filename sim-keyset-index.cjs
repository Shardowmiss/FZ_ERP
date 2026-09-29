/**
 * 索引前提实验：keyset 要 O(M) Seek，必须有 (过滤列, created_at DESC, id DESC) 复合索引。
 * 现有索引都以 _created_at 打头，深翻页时只能"扫过 N 行再排序"，keyset 省掉的只是排序那一半。
 * 本脚本实测"补对索引"前后的差距，用于判断是否值得出迁移脚本。
 * 安全：造数以 biz_no LIKE 'IDXPROBE_%' 打标，结束后删表级索引 + 删数据。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { inventoryFlow } = require('./dist/server/database/schema');

const TOTAL = 200000;
const DEEP = 199000;
const PAGE = 20;
const WH = '00000000-0000-4000-8000-000000000002';

const sql = postgres(DBS);
const db = drizzle(sql);
const log = (...a) => console.log(...a);

async function plan(q) {
  const rows = await sql.unsafe(`explain (analyze, costs off) ${q}`);
  const txt = rows.map((r) => r['QUERY PLAN']).join('\n');
  const t = txt.match(/Execution Time: ([\d.]+)/);
  const usedIdx = [...txt.matchAll(/Index Scan(?: Backward)? using (\S+)/g)].map((m) => m[1]);
  return { ms: t ? parseFloat(t[1]) : NaN, usedIdx, txt };
}

async function run() {
  await sql`delete from inventory_flow where biz_no like 'IDXPROBE_%'`;
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  for (let b = 0; b < TOTAL; b += 4000) {
    const vals = [];
    for (let i = 0; i < 4000; i += 1) {
      const k = b + i;
      vals.push({
        flowType: 'retail_outbound', bizNo: `IDXPROBE_${k}`, direction: 'out', itemType: 'sku',
        warehouseId: WH, warehouseName: 'perf-wh', quantity: '1',
        createdAt: new Date(base + k * 1000),
      });
    }
    await db.insert(inventoryFlow).values(vals);
  }
  await sql`analyze inventory_flow`;
  log('造数完成 %d 行', TOTAL);

  // 锚点 = 深翻页处那一行的时间+id
  const [anchor] = await sql`
    select _created_at, id from inventory_flow
     order by _created_at desc, id desc offset ${DEEP - PAGE} limit 1`;
  const ts = new Date(anchor._created_at).toISOString();
  const anchorId = anchor.id;

  const offsetQ = `select * from inventory_flow where warehouse_id = '${WH}'
     order by _created_at desc, id desc limit ${PAGE} offset ${DEEP}`;
  const keysetQ = `select * from inventory_flow where warehouse_id = '${WH}'
     and ((_created_at < '${ts}') or (_created_at = '${ts}' and id < '${anchorId}'))
     order by _created_at desc, id desc limit ${PAGE}`;

  async function report(tag) {
    const o = await plan(offsetQ);
    const k = await plan(keysetQ);
    log('\n--- %s ---', tag);
    log('  OFFSET   : %s ms  index=%s', o.ms, o.usedIdx.join(',') || '(seqscan)');
    log('  keyset   : %s ms  index=%s', k.ms, k.usedIdx.join(',') || '(seqscan)');
    // 预热后再测一轮，规避冷缓存噪声
    await plan(offsetQ); await plan(keysetQ);
    const o2 = await plan(offsetQ);
    const k2 = await plan(keysetQ);
    log('  [warm] OFFSET=%s ms  keyset=%s ms  比值=%sx', o2.ms, k2.ms, (o2.ms / k2.ms).toFixed(1));
    return k2.ms;
  }

  const k0 = await report('现状：idx_inventory_flow_created_at(_created_at)');

  log('\n=== 补 (warehouse_id, _created_at DESC, id DESC) ===');
  await sql.unsafe(`create index if not exists idx_probe_wh_created_id
    on inventory_flow (warehouse_id, _created_at desc, id desc)`);
  await sql`analyze inventory_flow`;
  const k1 = await report('补索引后');

  log('\n结论参考：keyset %s ms → %s ms', k0, k1);

  await sql`drop index if exists idx_probe_wh_created_id`;
  await sql`delete from inventory_flow where biz_no like 'IDXPROBE_%'`;
  const [after] = await sql`select count(*)::int as c from inventory_flow where biz_no like 'IDXPROBE_%'`;
  log('清理完成，残留 %d 行', after.c);
  await sql.end();
}

run().catch(async (e) => { console.error(e); await sql.end(); process.exit(2); });
