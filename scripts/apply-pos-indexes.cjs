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
//   pos_member           (erp_member_id)    UNIQUE           S2 会员下行身份锚点
//   pos_wallet_event     (event_key)        UNIQUE           S3 钱包上行幂等键
//   pos_wallet_event     (status,_created_at)/(member_id)    S3 outbox 补推热路径
//
// 说明：用 CONCURRENTLY 建索引，不锁表（门店 7×24 运行，禁止在运行时阻塞写）。
//       CONCURRENTLY 不能放在事务块内，故每条独立执行。
//
// ⚠ 唯一索引（unique:true）不只是查询加速：
//   - promotion-sync.service.ts 的 `onConflictDoUpdate({ target: erpPromotionId })`
//   - erp-integration.service.ts 会员下行的 `onConflictDoUpdate({ target: erpMemberId })`
//   都依赖它，缺了会直接报
//   "no unique or exclusion constraint matching the ON CONFLICT specification"。
//   建之前先查重 —— 若历史库里已有重复值，CONCURRENTLY 会失败，
//   此时必须先清理重复行（通常保留 _created_at 最早的一行）。
//
// ⚠ 历史 Bug（已修）：本脚本曾用 `CREATE INDEX ... IF NOT EXISTS` 建唯一索引 ——
//   **漏了 UNIQUE 关键字**，导致 uniq_pos_promotion_erp_id 在真库里其实是普通索引，
//   促销下行在真库必然失败。而 pglite 测试底座（server/test-utils/pglite.ts:59）
//   手工建了真唯一索引，所以单测全绿、线上必炸 —— 典型「假绿」。
//   现在按 idx.unique 生成 `CREATE UNIQUE INDEX`。
const pg = require('postgres');

const DEFAULT_URL = 'postgres://erp:erp@localhost:5434/pos_db';

const DRY_RUN = process.argv.includes('--dry-run');
const targetIdx = process.argv.findIndex((a) => a.startsWith('--target='));
const DB_URL = targetIdx >= 0 ? process.argv[targetIdx].slice('--target='.length) : process.env.DATABASE_URL || process.env.SUDA_DATABASE_URL || DEFAULT_URL;

// 平台 db-schema-sync 会建表，但不会为已存在的表追加**新列**；
// 新增的幂等键列必须先落列，否则后面的唯一索引会因列不存在而失败。
// 列名/类型来自本文件白名单常量（非用户输入），拼字符串是安全的。
const COLUMNS = [
  { table: 'pos_member', column: 'erp_member_id', ddl: 'uuid' },
];

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
    dupColumn: 'erp_promotion_id',
  },
  { name: 'idx_pos_stock_sku', table: 'pos_stock', ddl: '(sku_id)' },
  // S2：会员下行身份锚点。erp-integration.service.ts 会员分支改为以 erp_member_id
  // 作 ON CONFLICT target，没有唯一索引同样跑不起来。
  // 注意：PG 唯一索引允许多个 NULL，门店本地新建的会员（erp_member_id IS NULL）不受影响。
  {
    name: 'uniq_pos_member_erp_id',
    table: 'pos_member',
    ddl: '(erp_member_id)',
    unique: true,
    dupColumn: 'erp_member_id',
  },
  // 【S3】会员钱包上行 outbox。event_key 唯一索引是「同一业务事实只推一次」的唯一依赖
  // （member-wallet-upstream.service.ts 的 enqueue 用 ON CONFLICT DO NOTHING 去重），
  // 缺了它离线补传会把同一笔消费重复计入会员余额。
  {
    name: 'uniq_pos_wallet_event_key',
    table: 'pos_wallet_event',
    ddl: '(event_key)',
    unique: true,
    dupColumn: 'event_key',
  },
  // pending / failed 批次扫描热路径（flushPending 按 status + 时间排序取批次）
  {
    name: 'idx_pos_wallet_event_status',
    table: 'pos_wallet_event',
    ddl: '(status, _created_at)',
  },
  {
    name: 'idx_pos_wallet_event_member',
    table: 'pos_wallet_event',
    ddl: '(member_id)',
  },
];

async function main() {
  console.log(`target db: ${DB_URL.replace(/\/[^/]+$/, '/***')}`);
  console.log(`mode:      ${DRY_RUN ? 'DRY-RUN (不执行)' : 'APPLY'}\n`);

  const sql = pg(DB_URL, { max: 1, onnotice: () => {} });

  let ok = 0;
  const skipped = [];
  const failed = [];

  try {
    // 第 0 步：先补列（db-schema-sync 不会给已存在的表加新列）
    for (const col of COLUMNS) {
      const [{ exists: tableExists }] = await sql`
        SELECT to_regclass(${col.table}) IS NOT NULL AS exists
      `;
      if (!tableExists) {
        skipped.push(`${col.table}.${col.column} — 表不存在，跳过`);
        console.log(`SKIP   ${col.table}.${col.column} (表不存在)`);
        continue;
      }
      const stmt = `ALTER TABLE public.${col.table} ADD COLUMN IF NOT EXISTS ${col.column} ${col.ddl}`;
      if (DRY_RUN) {
        console.log(`DRYRUN ${stmt}`);
        ok += 1;
        continue;
      }
      try {
        await sql.unsafe(stmt);
        console.log(`OK     ${col.table}.${col.column} (列已就绪)`);
        ok += 1;
      } catch (e) {
        failed.push(`${col.table}.${col.column}: ${e.message}`);
        console.log(`FAIL   ${col.table}.${col.column}: ${e.message}`);
      }
    }

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
        // dupColumn 由本文件白名单提供（非用户输入），拼字符串安全；
        // 缺失配置直接报错，避免悄悄退化成「不查重」。
        if (!idx.dupColumn) {
          throw new Error(`索引 ${idx.name} 标记为 unique 但未配置 dupColumn，无法确定查重列`);
        }
        const dupRes = await sql.unsafe(`SELECT count(*) AS dup FROM (
            SELECT ${idx.dupColumn} FROM public.${idx.table}
            WHERE ${idx.dupColumn} IS NOT NULL
            GROUP BY ${idx.dupColumn} HAVING count(*) > 1
          ) d`);
        const dup = Number(dupRes[0]?.dup ?? 0);
        if (dup > 0) {
          failed.push(
            `${idx.table}.${idx.name}: 存在 ${dup} 个重复 ${idx.dupColumn}，请先清理重复行再建唯一索引`,
          );
          console.log(`FAIL   ${idx.table}.${idx.name}: 存在 ${dup} 个重复 ${idx.dupColumn}`);
          continue;
        }
      }

      // 幂等：IF NOT EXISTS。unique 必须生成 `CREATE UNIQUE INDEX`——
      // 历史上这里漏了 UNIQUE，导致唯一索引实际是普通索引（见文件头说明）。
      const stmt = `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX CONCURRENTLY IF NOT EXISTS ${idx.name} ON public.${idx.table} ${idx.ddl}`;
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
