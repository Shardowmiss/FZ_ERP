/**
 * 软删除统一回归：验证三张自定义 service（sales_return / sales_outbound / purchase_inbound）
 * 的 delete 已改为置位 _deleted_at（不物理删除），且 list / getDetail 自动用 isNull(_deleted_at)
 * 过滤已删除行，与 BaseCrudService 的软删语义保持一致。
 *
 * 运行：node sim-soft-delete-services.cjs   （需 dev/postgres 在 localhost:5434）
 */
const { randomUUID } = require('crypto');
const postgres = require('postgres');
const { eq } = require('drizzle-orm');
const { RequestContext, ALL_SCOPE } = require('./dist/server/common/context/request-context.js');
const { SalesReturnService } = require('./dist/server/modules/sales/return/sales-return.service.js');
const { SalesOutboundService } = require('./dist/server/modules/sales/outbound/sales-outbound.service.js');
const { PurchaseInboundService } = require('./dist/server/modules/purchase/inbound/purchase-inbound.service.js');
const S = require('./dist/server/database/schema.js');
const { drizzle } = require('drizzle-orm/postgres-js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function seed() {
  const WH = randomUUID(), SUP = randomUUID(), CUS = randomUUID();
  const SO = randomUUID(), PO = randomUUID(), DO = randomUUID(), SR = randomUUID(), PI = randomUUID();
  const ts = Date.now();
  await client`INSERT INTO warehouse (id, code, name, type) VALUES (${WH}, ${'WH_' + ts}, ${'软删测试仓'}, ${'main'})`;
  await client`INSERT INTO supplier (id, code, name) VALUES (${SUP}, ${'SUP_' + ts}, ${'软删测试供'})`;
  await client`INSERT INTO customer (id, code, name) VALUES (${CUS}, ${'CUS_' + ts}, ${'软删测试客'})`;
  await client`INSERT INTO sales_order (id, order_no, customer_id, customer_name, order_date) VALUES (${SO}, ${'SO_' + ts}, ${CUS}, ${'软删测试客'}, ${'2026-01-01'})`;
  await client`INSERT INTO purchase_order (id, order_no, supplier_id, supplier_name, order_date) VALUES (${PO}, ${'PO_' + ts}, ${SUP}, ${'软删测试供'}, ${'2026-01-01'})`;
  await client`INSERT INTO sales_outbound (id, outbound_no, order_id, order_no, customer_id, customer_name, warehouse_id, warehouse_name, outbound_date) VALUES (${DO}, ${'DO_' + ts}, ${SO}, ${'SO_' + ts}, ${CUS}, ${'软删测试客'}, ${WH}, ${'软删测试仓'}, ${'2026-01-01'})`;
  await client`INSERT INTO sales_return (id, return_no, outbound_id, outbound_no, customer_id, customer_name, warehouse_id, warehouse_name, return_date) VALUES (${SR}, ${'SR_' + ts}, ${DO}, ${'DO_' + ts}, ${CUS}, ${'软删测试客'}, ${WH}, ${'软删测试仓'}, ${'2026-01-01'})`;
  await client`INSERT INTO purchase_inbound (id, inbound_no, order_id, order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, inbound_date) VALUES (${PI}, ${'PI_' + ts}, ${PO}, ${'PO_' + ts}, ${SUP}, ${'软删测试供'}, ${WH}, ${'软删测试仓'}, ${'2026-01-01'})`;
  return { WH, SUP, CUS, SO, PO, DO, SR, PI };
}

async function cleanup(s) {
  await client`DELETE FROM sales_return WHERE id=${s.SR}`;
  await client`DELETE FROM sales_outbound WHERE id=${s.DO}`;
  await client`DELETE FROM purchase_inbound WHERE id=${s.PI}`;
  await client`DELETE FROM sales_order WHERE id=${s.SO}`;
  await client`DELETE FROM purchase_order WHERE id=${s.PO}`;
  await client`DELETE FROM customer WHERE id=${s.CUS}`;
  await client`DELETE FROM supplier WHERE id=${s.SUP}`;
  await client`DELETE FROM warehouse WHERE id=${s.WH}`;
}

async function verifyOne(label, svc, dbTable, id) {
  // 1. 删除前 getDetail 可见
  let before = null;
  try { before = await RequestContext.run({ dealerScope: ALL_SCOPE }, () => svc.getDetail(id)); }
  catch (e) { before = null; }
  assert(`${label} 删除前 getDetail 可见`, !!before);

  // 2. 删除前 list 包含此行（total 计 + 显式查找双保险）
  const listBefore = await RequestContext.run({ dealerScope: ALL_SCOPE }, () => svc.list({ page: 1, pageSize: 100 }));
  assert(`${label} 删除前 list 包含此行`, listBefore.items.some((r) => r.id === id), { total: listBefore.total });

  // 3. delete（应置位 _deleted_at，不物理删除）
  try {
    await RequestContext.run({ dealerScope: ALL_SCOPE }, () => svc.delete(id));
    assert(`${label} delete 执行成功(软删)`, true);
  } catch (e) {
    assert(`${label} delete 执行成功(软删)`, false, e.message);
  }

  // 4. 删除后 getDetail 抛 NotFound（被 isNull(_deleted_at) 过滤）
  let notFound = false, afterDetail = null;
  try { afterDetail = await RequestContext.run({ dealerScope: ALL_SCOPE }, () => svc.getDetail(id)); }
  catch (e) {
    notFound = (e && ((e.getStatus && e.getStatus() === 404) || e.status === 404 || /不存在/.test(e.message || '')));
  }
  assert(`${label} 删除后 getDetail 不可见(NotFound)`, notFound, afterDetail ? '仍返回对象' : undefined);

  // 5. 删除后 list 不含此行（total 精确减 1）
  const listAfter = await RequestContext.run({ dealerScope: ALL_SCOPE }, () => svc.list({ page: 1, pageSize: 100 }));
  assert(`${label} 删除后 list 已过滤(total-1且不含此行)`, listAfter.total === listBefore.total - 1 && !listAfter.items.some((r) => r.id === id), { before: listBefore.total, after: listAfter.total });

  // 6. 物理行仍在 + _deleted_at 已置位
  const raw = await db.select({ deletedAt: dbTable.deletedAt }).from(dbTable).where(eq(dbTable.id, id));
  assert(`${label} 物理行仍在且 _deleted_at 已置位`, raw.length === 1 && raw[0].deletedAt != null, raw[0] ? String(raw[0].deletedAt) : null);
}

(async () => {
  let s;
  try {
    s = await seed();
    const stub = {};
    const srSvc = new SalesReturnService(db, stub, stub, stub);
    const soSvc = new SalesOutboundService(db, stub, stub, stub);
    const piSvc = new PurchaseInboundService(db, stub, stub, stub);

    console.log('\n[1] sales_return 软删统一');
    await verifyOne('sales_return', srSvc, S.salesReturn, s.SR);
    console.log('\n[2] sales_outbound 软删统一');
    await verifyOne('sales_outbound', soSvc, S.salesOutbound, s.DO);
    console.log('\n[3] purchase_inbound 软删统一');
    await verifyOne('purchase_inbound', piSvc, S.purchaseInbound, s.PI);
  } catch (e) {
    console.error('SIM ERROR', e);
    fail++;
  } finally {
    if (s) await cleanup(s);
  }

  console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
})();
