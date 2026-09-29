/**
 * keyset 游标分页端到端验证（真实 DB）。
 * 向 system_operation_log 写入 25 行已知数据，用 OperationLogService.list
 * 走 keyset 逐页翻页，与 OFFSET 全量基准对比：顺序一致、无重复、无遗漏。
 */
const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');

const { OperationLogService } = require('./dist/server/modules/system/operation-log/operation-log.service');
const { systemOperationLog } = require('./dist/server/database/schema');

const sql = postgres(URL);
const db = drizzle(sql);
const svc = new OperationLogService(db);
const log = (...a) => console.log(...a);

async function run() {
  let failures = 0;
  await sql`delete from system_operation_log where user_id like 'u_keyset_%'`;

  const now = Date.now();
  const vals = [];
  for (let i = 0; i < 25; i++) {
    vals.push({
      userId: `u_keyset_${i}`,
      module: 'ktest',
      operationType: 'create',
      operationTime: new Date(now - (25 - i) * 60000),
      summary: `s${i}`,
    });
  }
  await db.insert(systemOperationLog).values(vals);

  // 基准：OFFSET 全量（第一页 pageSize=100，按测试 module 过滤隔离）
  const base = await svc.list({ page: 1, pageSize: 100, module: 'ktest' });
  const baseIds = base.items.map((x) => x.id);
  log('[base] total=%d items=%d', base.total, baseIds.length);
  if (baseIds.length !== 25) { failures += 1; log('  base count != 25'); }

  // keyset 逐页翻页（pageSize=10）
  let cursor = null;
  const collected = [];
  let pages = 0;
  while (true) {
    const r = await svc.list({ page: 1, pageSize: 10, cursor, module: 'ktest' });
    collected.push(...r.items.map((x) => x.id));
    cursor = r.nextCursor;
    pages += 1;
    if (!cursor || collected.length >= 25 || pages > 10) break;
  }

  const sameOrder = JSON.stringify(collected) === JSON.stringify(baseIds);
  const noDup = new Set(collected).size === collected.length;
  const complete = collected.length === 25;

  log('[keyset] pages=%d collected=%d', pages, collected.length);
  log('  sameOrder=%s noDup=%s complete=%s', sameOrder, noDup, complete);
  if (!(sameOrder && noDup && complete)) failures += 1;

  // 清理
  await sql`delete from system_operation_log where user_id like 'u_keyset_%'`;
  await sql.end();

  log(failures === 0 ? 'KEYSET_PASS' : `KEYSET_FAIL(count=${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
