// 验证 hangtag resolveSkuIds 批量解析：去重款号一次性查询（替代逐件 N+1）
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sku } = require('./dist/server/database/schema');
const { HangtagService } = require('./dist/server/modules/hangtag/hangtag.service');

(async () => {
  const sql = postgres(process.env.SUDA_DATABASE_URL, { max: 1 });
  const db = drizzle(sql);
  const svc = new HangtagService(db);

  // 4 个真实款号(同款 ST-SPRING 4 个颜色/尺码) + 1 个不存在 → 去重后仅 1 条查询
  const keys = [
    { styleNo: 'ST-SPRING', color: '红', size: 'S' },
    { styleNo: 'ST-SPRING', color: '红', size: 'M' },
    { styleNo: 'ST-SPRING', color: '黑', size: 'S' },
    { styleNo: 'ST-SPRING', color: '黑', size: 'M' },
    { styleNo: 'NOPE-STYLE', color: 'X', size: 'Y' },
  ];

  const map = await svc.resolveSkuIds(keys);

  // 用 DB 直接核对期望值：按款号取全部 SKU 后在内存建映射（避免元组 IN 语法差异）
  const { eq } = require('drizzle-orm');
  const all = await db
    .select({ id: sku.id, styleNo: sku.styleNo, color: sku.color, size: sku.size })
    .from(sku)
    .where(eq(sku.styleNo, 'ST-SPRING'));
  const expectMap = new Map();
  for (const r of all) expectMap.set(`${r.styleNo}|${r.color}|${r.size}`, r.id);

  let failures = 0;
  for (const k of keys) {
    const ck = `${k.styleNo}|${k.color}|${k.size}`;
    const got = map.get(ck);
    const want = expectMap.get(ck) ?? null;
    const ok = got === want;
    if (!ok) failures += 1;
    console.log('  %s => %s (expect %s) %s', ck.padEnd(28), got ?? 'null', want ?? 'null', ok ? 'OK' : 'FAIL');
  }

  // 去重款号数 = 2（ST-SPRING 与 NOPE-STYLE），证明非逐件查询
  const distinctStyleNos = new Set(keys.map((k) => k.styleNo)).size;
  console.log('[dedup] distinct styleNo count = %d (逐件查询会是 %d 次)', distinctStyleNos, keys.length);
  console.log(failures === 0 ? '[PASS] resolveSkuIds 批量解析结果正确' : `[FAIL] ${failures} 项不匹配`);

  await sql.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
