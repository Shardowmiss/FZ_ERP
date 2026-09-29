/* 独立 Drizzle 数据库层功能测试（不依赖平台/HTTP）
 * - 广度：对 schema 中全部表做 SELECT，验证 schema 与库一致、可查询
 * - 深度：对代表表做 INSERT→SELECT→UPDATE→DELETE 往返（选无强制外键的表）
 */
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql, eq, getTableName } = require('drizzle-orm');
const postgres = require('postgres');
const schema = require('./dist/server/database/schema');
const crypto = require('crypto');

const url = process.env.SUDA_DATABASE_URL;
const client = postgres(url);
const db = drizzle(client, { schema });

const out = { tableSelect: { total: 0, ok: 0, fail: [] }, crud: [] };
const allTables = Object.values(schema).filter(v => v && v[Symbol.for('drizzle:Columns')]);

(async () => {
  // 广度
  out.tableSelect.total = allTables.length;
  for (const t of allTables) {
    try { await db.select().from(t).limit(1); out.tableSelect.ok++; }
    catch (e) { out.tableSelect.fail.push({ table: getTableName(t), err: String(e.message || e).slice(0, 140) }); }
  }

  // 深度：无强制外键的代表表
  const genId = () => crypto.randomUUID();
  const targets = [
    { label: 'supplier', t: schema.supplier, row: { id: genId(), code: 'SUP-TEST-001', name: '测试供应商', status: 'active' }, upd: { name: '测试供应商改' } },
    { label: 'customer', t: schema.customer, row: { id: genId(), code: 'CUS-TEST-001', name: '测试客户', status: 'active' }, upd: { name: '测试客户改' } },
    { label: 'color_group', t: schema.colorGroup, row: { id: genId(), code: 'CG-TEST', name: '测试色组', status: 'active' }, upd: { name: '色组改' } },
    { label: 'size_group', t: schema.sizeGroup, row: { id: genId(), code: 'SG-TEST', name: '测试尺码组', status: 'active' }, upd: { name: '尺码改' } },
    { label: 'style_attr_def', t: schema.styleAttrDef, row: { id: genId(), attrType: 'test', attrCode: 'TCODE1', attrName: '测试属性', status: 'active' }, upd: { attrName: '属性改' } },
    { label: 'system_config', t: schema.systemConfig, row: { configKey: 'TEST_KEY_1', configValue: 'v1', description: '测试' }, upd: { configValue: 'v2' } },
    { label: 'sales_channel(P1)', t: schema.salesChannel, row: { id: genId(), channelCode: 'CH-TEST', name: '测试渠道', platform: 'other', status: 'active' }, upd: { name: '渠道改' } },
    { label: 'member(P1)', t: schema.member, row: { id: genId(), memberNo: 'M-TEST-001', name: '测试会员', status: 'active' }, upd: { name: '会员改' } },
  ];

  for (const tg of targets) {
    if (!tg.t) { out.crud.push({ table: tg.label, status: 'SKIP(no table)' }); continue; }
    const rec = { table: tg.label, insert: '?', update: '?', delete: '?' };
    try {
      const ins = await db.insert(tg.t).values(tg.row).returning();
      rec.insert = 'OK';
      await db.update(tg.t).set(tg.upd).returning();
      rec.update = 'OK';
      const key = ins[0].id ? eq(tg.t.id, ins[0].id) : eq(tg.t.configKey, ins[0].configKey);
      await db.delete(tg.t).where(key);
      rec.delete = 'OK';
    } catch (e) { rec.err = String(e.message || e).slice(0, 160); }
    out.crud.push(rec);
  }

  console.log(JSON.stringify(out, null, 2));
  await client.end();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
