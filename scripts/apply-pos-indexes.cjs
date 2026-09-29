// P1-6：POS 缺失索引的幂等补建脚本
// ---------------------------------------------------------------------------
// 背景：`server/database/schema.ts` 由 `npm run gen:db-schema`（@lark-apaas/db-schema-sync）
// 生成，平台侧同步只会建表、不会为已存在的表追加索引；因此 schema 里声明的 index
// 需要一次性落到目标库。本脚本幂等，可重复执行。
//
// 用法：
//   node scripts/apply-pos-indexes.cjs              # 执行（默认库见 DEFAULT_URL）
//   node scripts/apply-pos-indexes.cjs --dry-run    # 只打印将要执行的 SQL
//   node scripts/apply-pos-indexes.cjs --target=... # 覆盖库 URL
//
// 索引清单与 schema.ts 一一对应（改 schema 后请同步此处）：
//   pos_suspended_order  (store_id, status, _created_at)     挂单列表热路径
//   pos_promotion        (status, priority, _created_at)     有效促销列表 + 开单计价热路径
//   pos_promotion        (status, valid_from, valid_to)      促销有效期过滤
//   pos_promotion        (erp_promotion_id) UNIQUE           Wave 4-C 促销下行幂等键
//   pos_stock            (sku_id)                            单 SKU 维度查询
//
// 说明：用 CONCURRENTLY 建索引，不锁表（门店 7×24 运行，禁止在运行时阻塞写）。
//       CONCURRENTLY 不能放在事务块内，故每条独立执行。
//
// ⚠ 唯一索引（unique:true）不只是查询加速：promotion-sync.service.ts 的
//   `onConflictDoUpdate({ target: erpPromotionId })` 依赖它，缺了会直接报
//   "no unique or exclusion constraint matching the ON CONFLICT specification"。
//   建之前先查重 —— 若历史库里已有重复 erp_promotion_id，CONCURRENTLY 会失败，
//   此时必须先清理重复行（通常保留 _created_at 最早的一行）。
const pg = require('postgres');

const DEFAULT_URL = 'postgres://erp:erp@localhost:5434/pos_db';

const DRY_RUN = process.argv.includes('--dry-run');
const targetIdx = process.argv.findIndex((a) => a.startsWith('--target='));
const DB_URL = targetIdx >= 0 ? process.argv[targetIdx].slice('--target='.length) : process.env.DATABASE_URL || process.env.SUDA_DATABASE_URL || DEFAULT_URL;

const INDEXES = [
  { name: 'idx_pos_suspended_store_status', table: 'pos_suspended_order', ddl: '(store_id, status, _created_at DESC)' },
  { name: 'idx_pos_promotion_active_priority', table: 'pos_promotion', ddl: '(status, priority DESC, _created_at DESC)' },
  { name: 'idx_pos_promotion_validity', table: 'pos_promotion', ddl: '(status, valid_from, valid_to)' },
  // Wave 4-C：促销下行幂等键。ON CONFLICT 的唯一依赖，属「不建就跑不起来」级别。
  {
    name: 'uniq_pos_promotion_erp_id',
    table: 'pos_promotion',
    ddl: '(erp_promotion_id)',
    unique: true,
  },
  { name: 'idx_pos_stock_sku', table: 'pos_stock', ddl: '(sku_id)' },
];

async function main() {
  console.log(`target db: ${DB_URL.replace(/\/[^/]+$/, '/***')}`);
  console.log(`mode:      ${DRY_RUN ? 'DRY-RUN (不执行)' : 'APPLY'}\n`);

  const sql = pg(DB_URL, { max: 1, onnotice: () => {} });

  let ok = 0;
  const skipped = [];
  const failed = [];

  try {
    for (const idx of INDEXES) {
      // 先确认表存在（本地开发库可能尚未建这些业务表，缺表不应视为失败）
      const [{ exists }] = await sql`
        SELECT to_regclass(${idx.table}) IS NOT NULL AS exists
      `;
      if (!exists) {
        skipped.push(`${idx.table}.${idx.name} — 表不存在，跳过`);
        console.log(`SKIP   ${idx.table}.${idx.name} (表不存在)`);
        continue;
      }

      // 唯一索引：先查重。重复行会让 CONCURRENTLY 建索引直接失败，
      // 而 PG 的报错是 "could not create unique index ... Key (erp_promotion_id)=(..) is
      // duplicated"，不预先查重很难把线索串到「历史库有没有脏数据」上。
      // 表名来自上面的白名单常量（不是用户输入），拼字符串是安全的。
      if (idx.unique) {
        const dupRes = await sql.unsafe(`SELECT count(*) AS dup FROM (
            SELECT erp_promotion_id FROM public.${idx.table}
            WHERE erp_promotion_id IS NOT NULL
            GROUP BY erp_promotion_id HAVING count(*) > 1
          ) d`);
        const dup = Number(dupRes[0]?.dup ?? 0);
        if (dup > 0) {
          failed.push(
            `${idx.table}.${idx.name}: 存在 ${dup} 个重复 erp_promotion_id，请先清理重复行再建唯一索引`,
          );
          console.log(`FAIL   ${idx.table}.${idx.name}: 存在 ${dup} 个重复 erp_promotion_id`);
          continue;
        }
      }

      // 幂等：IF NOT EXISTS
      const stmt = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx.name} ON public.${idx.table} ${idx.ddl}`;
      if (DRY_RUN) {
        console.log(`DRYRUN ${stmt}`);
        ok += 1;
        continue;
      }
      try {
        await sql.unsafe(stmt);
        console.log(`OK     ${idx.table}.${idx.name}`);
        ok += 1;
      } catch (e) {
        // 并发场景下可能撞上"索引已存在"竞态，视为成功
        if (/already exists/i.test(e.message)) {
          console.log(`OK     ${idx.table}.${idx.name} (已存在，跳过)`);
          ok += 1;
        } else {
          failed.push(`${idx.table}.${idx.name}: ${e.message}`);
          console.log(`FAIL   ${idx.table}.${idx.name}: ${e.message}`);
        }
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(`\nsummary: applied/skipped-existing=${ok} skipped(missing-table)=${skipped.length} failed=${failed.length}`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
