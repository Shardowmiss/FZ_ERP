/**
 * SKU 批量导入端到端验证（真实 DB）。
 * 覆盖：有效插入、批内重复 skuCode、styleNo 不存在、缺失必填字段四种场景。
 */
const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');

const { SkuService } = require('./dist/server/modules/base/sku/sku.service');
const { sku, style } = require('./dist/server/database/schema');

const sql = postgres(URL);
const db = drizzle(sql);
const svc = new SkuService(db);
const log = (...a) => console.log(...a);

async function run() {
  let failures = 0;
  // 清理历史测试数据
  await sql`delete from sku where sku_code like 'BULK_TEST_%'`;

  const sRows = await sql`select style_no from style limit 1`;
  if (sRows.length === 0) {
    log('SKIP: style 表无数据，无法构造有效 styleNo');
    await sql.end();
    process.exit(0);
  }
  const styleNo = sRows[0].style_no;

  const items = [
    { skuCode: 'BULK_TEST_1', styleNo, color: 'BULK_红', size: 'BULK_S', tagPrice: 100 },
    { skuCode: 'BULK_TEST_2', styleNo, color: 'BULK_红', size: 'BULK_M', tagPrice: 100 },
    { skuCode: 'BULK_TEST_1', styleNo, color: 'BULK_红', size: 'BULK_S' }, // 批内重复
    { skuCode: 'BULK_TEST_3', styleNo: 'NO_SUCH_STYLE', color: 'BULK_红', size: 'BULK_X' }, // styleNo 不存在
    { skuCode: 'BULK_TEST_4' }, // 缺失 styleNo/color/size
  ];

  const res = await svc.bulkImport(items);
  log('[bulkImport] %j', res);

  if (res.total !== 5) { failures += 1; log('  total 期望 5'); }
  if (res.inserted !== 2) { failures += 1; log('  inserted 期望 2, 实际', res.inserted); }
  if (res.skipped !== 0) { failures += 1; log('  skipped 期望 0, 实际', res.skipped); }
  const has = (sub) => res.errors.some((e) => (e.reason || '').includes(sub));
  if (!has('批内重复 skuCode')) { failures += 1; log('  errors 缺少 批内重复'); }
  if (!has('NO_SUCH_STYLE')) { failures += 1; log('  errors 缺少 styleNo不存在'); }
  if (!has('必填')) { failures += 1; log('  errors 缺少 必填'); }

  // 二次运行应跳过已存在的 2 条（skipped=2, inserted=0）
  const res2 = await svc.bulkImport(items);
  log('[bulkImport rerun] %j', res2);
  if (res2.inserted !== 0) { failures += 1; log('  二次 inserted 期望 0'); }
  if (res2.skipped !== 2) { failures += 1; log('  二次 skipped 期望 2, 实际', res2.skipped); }

  // 清理
  await sql`delete from sku where sku_code like 'BULK_TEST_%'`;
  await sql.end();

  log(failures === 0 ? 'BULK_IMPORT_PASS' : `BULK_IMPORT_FAIL(count=${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
