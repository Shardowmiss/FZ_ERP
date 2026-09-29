/**
 * 单号生成器并发安全性验证（实物证）
 *
 * 直接加载真实的 NumberGeneratorService，发起 N 个并发事务，每个事务：
 *   1) 调用 generateNextNo（内部 pg_advisory_xact_lock + FOR UPDATE）生成单号
 *   2) 将单号插入一张带 .unique() 约束的临时表
 *
 * 判定：
 *   - 若出现唯一约束冲突（23505）→ 生成器非并发安全（旧配货逻辑的真实风险）
 *   - 若全部成功且 N 个单号互不相同 → 生成器并发安全（配货改走它的依据）
 *
 * 这是 P0-新① 修复所依赖机制的直证：配货/吊牌改用锁生成器后，并发不会撞单号。
 */
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { pgTable, serial, varchar } = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');

const CONN = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const N = 40;

// 临时表 + 对应 drizzle 模型
const scratch = pgTable('ng_concurrency_test', {
  id: serial('id').primaryKey(),
  no: varchar('no', { length: 50 }).notNull().unique(),
});

async function main() {
  const client = postgres(CONN, { max: N + 2 });
  const db = drizzle(client);

  const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service.js');
  const svc = new NumberGeneratorService();

  // 准备临时表
  await db.execute(sql`DROP TABLE IF EXISTS ng_concurrency_test`);
  await db.execute(sql`CREATE TABLE ng_concurrency_test (id serial primary key, no varchar(50) not null unique)`);

  let errors = 0;
  const results = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      try {
        await db.transaction(async (tx) => {
          const no = await svc.generateNextNo(tx, scratch, scratch.no, 'C', 4);
          await tx.insert(scratch).values({ no });
          return no;
        });
        return { ok: true, i };
      } catch (e) {
        errors++;
        return { ok: false, i, code: e?.code, msg: String(e?.message || e).slice(0, 120) };
      }
    }),
  );

  const [{ total }] = await db.execute(sql`select count(*)::int as total from ng_concurrency_test`);
  const [{ distinct }] = await db.execute(sql`select count(distinct no)::int as distinct from ng_concurrency_test`);

  await db.execute(sql`DROP TABLE IF EXISTS ng_concurrency_test`);
  await client.end();

  console.log(`并发事务数 N = ${N}`);
  console.log(`唯一约束冲突次数 = ${errors}`);
  console.log(`插入总行数 = ${total}, 去重单号数 = ${distinct}`);

  const pass = errors === 0 && Number(total) === N && Number(distinct) === N;
  console.log(pass ? 'RESULT: PASS ✅ 生成器并发安全（单号唯一、无冲突）' : 'RESULT: FAIL ❌ 检测到并发冲突或重复');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('SIM_CRASH', e);
  process.exit(2);
});
