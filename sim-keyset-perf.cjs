/**
 * keyset vs OFFSET 深翻页实测（真实 PG，临时造 20 万行 inventory_flow）。
 * 目的不是"跑个数字好看"，而是回答一个问题：keyset 的性能收益依赖什么前提条件。
 * 结论同时决定是否要补 (created_at, id) 复合索引迁移。
 *
 * 安全：所有数据以 biz_no LIKE 'PERFKEY_%' 打标，脚本结束后全部删除。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { inventoryFlow } = require('./dist/server/database/schema');

const TOTAL = 200000;
const DEEP_OFFSET = 199000;
const PAGE = 20;

const sql = postgres(DBS);
const db = drizzle(sql);
const log = (...a) => console.log(...a);

async function run() {
  // ---------- 清理与造数 ----------
  await sql`delete from inventory_flow where biz_no like 'PERFKEY_%'`;
  const t0 = Date.now();
  const wh = '00000000-0000-4000-8000-000000000002';
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  for (let b = 0; b < TOTAL; b += 4000) {
    const vals = [];
    for (let i = 0; i < 4000; i++) {
      const k = b + i;
      vals.push({
        flowType: 'retail_outbound',
        bizNo: `PERFKEY_${k}`,
        direction: 'out',
        itemType: 'sku',
        warehouseId: wh,
        warehouseName: 'perf-wh',
        quantity: '1',
        createdAt: new Date(base + k * 1000), // 时间严格递增，便于 OFFSET 深翻页
      });
    }
    await db.insert(inventoryFlow).values(vals);
  }
  await sql`analyze inventory_flow`;
  log('造数完成：%d 行，用时 %dms', TOTAL, Date.now() - t0);

  const [cnt] = await sql`select count(*)::int as c from inventory_flow where biz_no like 'PERFKEY_%'`;
  log('实际行数 = %d', cnt.c);

  const whCond = `warehouse_id = '${wh}'`;

  // ---------- 1) OFFSET 深翻页 ----------
  const offsetSql = `select * from inventory_flow where ${whCond}
     order by _created_at desc, id desc limit ${PAGE} offset ${DEEP_OFFSET}`;

  // ---------- 2) keyset（走现有 idx_inventory_flow_created_at 单列索引） ----------
  // 游标 = 第 DEEP_OFFSET 行的时间+id
  const [anchor] = await sql`
    select _created_at, id from inventory_flow where ${sql`(warehouse_id = ${wh})`}
     order by _created_at desc, id desc offset ${DEEP_OFFSET - PAGE} limit 1`;
  const raw = `${new Date(anchor._created_at).getTime()}_${anchor.id}`;
  const cursor = Buffer.from(raw, 'utf8').toString('base64url');
  const keysetSql = `select * from inventory_flow
     where ${whCond}
       and ((_created_at < '${new Date(anchor._created_at).toISOString()}')
            or (_created_at = '${new Date(anchor._created_at).toISOString()}' and id < '${anchor.id}'))
     order by _created_at desc, id desc limit ${PAGE}`;

  async function measure(label, q) {
    const rows = await sql.unsafe(`explain (analyze, buffers, costs off, timing on) ${q}`);
    const txt = rows.map((r) => r['QUERY PLAN']).join('\n');
    const m = txt.match(/Execution Time: ([\d.]+)/);
    const ts = txt.match(/Total Runtime: ([\d.]+)/);
    return { label, ms: m ? parseFloat(m[1]) : (ts ? parseFloat(ts[1]) : NaN), plan: txt };
  }

  log('\n=== 深翻页对比（OFFSET %d, LIMIT %d）===\n', DEEP_OFFSET, PAGE);
  const offRes = await measure('OFFSET', offsetSql);
  const kRes = await measure('keyset', keysetSql);
  log('OFFSET   : %s ms', offRes.ms);
  log('keyset   : %s ms', kRes.ms);
  log('提升     : %s', offRes.ms > 0 ? `${(offRes.ms / kRes.ms).toFixed(1)}x` : 'n/a');

  log('\n--- OFFSET 计划 ---\n%s', offRes.plan.split('\n').slice(0, 8).join('\n'));
  log('\n--- keyset 计划 ---\n%s', kRes.plan.split('\n').slice(0, 8).join('\n'));

  // ---------- 3) 浅翻页对比（第 1 页），确认无回归 ----------
  log('\n=== 首屏对比（LIMIT %d，无 OFFSET）===\n', PAGE);
  const off1 = await measure('OFFSET', `select * from inventory_flow where ${whCond}
     order by _created_at desc, id desc limit ${PAGE}`);
  const k1 = await measure('keyset', `select * from inventory_flow where ${whCond}
     order by _created_at desc, id desc limit ${PAGE}`);
  log('OFFSET   : %s ms', off1.ms);
  log('keyset   : %s ms', k1.ms);

  // ---------- 4) 补复合索引后再测 keyset ----------
  log('\n=== 尝试补 (created_at DESC, id DESC) 复合索引 ===');
  const created = await sql.unsafe(
    `create index if not exists idx_inv_flow_created_id on inventory_flow
       using btree (_created_at desc, id desc)`,
  ).catch((e) => { log('  索引创建失败(可能已存在): %s', e.message); return null; });
  if (created && !Array.isArray(created)) log('  索引已创建');
  await sql`analyze inventory_flow`;
  const kRes2 = await measure('keyset+idx', keysetSql);
  log('keyset   : %s ms', kRes2.ms);
  log('--- keyset+idx 计划 ---\n%s', kRes2.plan.split('\n').slice(0, 8).join('\n'));

  // ---------- 清理 ----------
  await sql`drop index if exists idx_inv_flow_created_id`;
  await sql`delete from inventory_flow where biz_no like 'PERFKEY_%'`;
  const [after] = await sql`select count(*)::int as c from inventory_flow where biz_no like 'PERFKEY_%'`;
  log('\n清理完成，残留 %d 行', after.c);
  await sql.end();
}

run().catch(async (e) => { console.error(e); await sql.end(); process.exit(2); });
