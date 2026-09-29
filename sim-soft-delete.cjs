// 验证 BaseCrudService 软删除：删除后置位 deletedAt，查询过滤，物理行可恢复。
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq } = require('drizzle-orm');
const { BaseCrudService } = require('./dist/server/common/base/base-crud.service.js');
const { supplier } = require('./dist/server/database/schema.js');

const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(URL);
const db = drizzle(client);

const svc = new BaseCrudService(supplier);
svc.db = db;

console.log('[DEBUG] softDeleteEnabled =', !!svc.table?.deletedAt, 'has deletedAt prop =', 'deletedAt' in svc.table);

const code = 'SOFTDEL-' + Date.now();

(async () => {
  let failures = 0;

  const ins = await svc.insertRow({ code, name: '软删测试' });
  console.log('[1] inserted id=%s', ins.id);

  const found = await svc.findById(ins.id);
  console.log('[2] findById before delete: found?=%s', !!found);
  if (!found) failures += 1;

  await svc.remove(ins.id);
  const afterDel = await svc.findById(ins.id);
  console.log('[3] findById after soft-delete: found?=%s (expect false)', !!afterDel);
  if (afterDel) failures += 1;

  const all = await svc.listAll();
  const inList = all.some((r) => r.id === ins.id);
  console.log('[4] listAll excludes deleted?=%s (expect true)', !inList);
  if (inList) failures += 1;

  // 物理行仍在，deletedAt 已置位 → 可恢复（drizzle 将 _deleted_at 映射回 key deletedAt）
  const raw = await db.select().from(supplier).where(eq(supplier.id, ins.id));
  const recoverable = raw.length === 1 && raw[0].deletedAt != null;
  console.log('[5] physical row present with deletedAt?=%s (deletedAt=%s)', recoverable, raw[0]?.deletedAt);
  if (!recoverable) failures += 1;

  // 还原测试数据
  await db.delete(supplier).where(eq(supplier.id, ins.id));

  console.log(failures === 0 ? '\n✅ 软删除验证 PASS' : `\n❌ 软删除验证 FAIL (failures=${failures})`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
