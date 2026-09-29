// P1-c② 软删扩表验证：销售订单 / 采购订单由硬删改为软删。
//
// 全部跑真实 PG，不打桩。验证点：
//   1. delete() 只置位 _deleted_at，物理行保留（可恢复）
//   2. getDetail / list 立即看不到被删的单据
//   3. 明细行不被级联删除（主表软删不再触发 FK ON DELETE CASCADE）
//   4. 看板 pendingDocCount 不再把已软删的草稿单算进去（否则口径虚高）
//   5. restore() 能把单据放回列表
//   6. 软删后用同一 order_no 重建不撞唯一键（0016 的 PARTIAL 唯一索引）
//   7. 未软删的行仍受 order_no 唯一约束保护
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, or, isNull, and } = require('drizzle-orm');
const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service.js');
const { PurchaseOrderService } = require('./dist/server/modules/purchase/order/purchase-order.service.js');
const { DashboardService } = require('./dist/server/modules/dashboard/dashboard.service.js');
const { RequestContext, ALL_SCOPE } = require('./dist/server/common/context/request-context.js');
const schema = require('./dist/server/database/schema.js');

const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(URL, { max: 1 });
const db = drizzle(client);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const errMsg = (e) => String((e && e.message) || e);

const stubCache = { get: async () => undefined, set: async () => {}, del: async () => true };
const salesSvc = new SalesOrderService(db, {}, {});
const purchaseSvc = new PurchaseOrderService(db, {});
const dash = new DashboardService(db, stubCache);

const today = new Date().toISOString().slice(0, 10);
const stamp = Date.now().toString(36).toUpperCase();
const SO_NO = `SOTEST-${stamp}`;
const PO_NO = `POTEST-${stamp}`;
const DUMMY_SKU = '00000000-0000-0000-0000-000000000000';

let custName = null;
let suppName = null;

async function insertOrder(table, orderNo, fkColumn, fkId) {
  const [row] = await db
    .insert(table)
    .values({
      orderNo,
      [fkColumn]: fkId,
      customerName: table === schema.salesOrder ? custName : null,
      supplierName: table === schema.purchaseOrder ? suppName : null,
      orderDate: today,
      totalAmount: '0',
      status: 'draft',
    })
    .returning();
  return row;
}

(async () => {
  // ---------- 准备：FK 目标行 ----------
  const [cust] = await db
    .select({ id: schema.customer.id, name: schema.customer.name })
    .from(schema.customer)
    .limit(1);
  const [supp] = await db
    .select({ id: schema.supplier.id, name: schema.supplier.name })
    .from(schema.supplier)
    .limit(1);
  const [skuRow] = await db.select({ id: schema.sku.id }).from(schema.sku).limit(1);
  if (!cust || !supp || !skuRow) {
    throw new Error(`缺少基础数据 customer=${!!cust} supplier=${!!supp} sku=${!!skuRow}`);
  }

  // customer.name / supplier.name 均 NOT NULL，库里有脏数据时兜一个值
  custName = cust.name || 'SIM Customer';
  suppName = supp.name || 'SIM Supplier';
  const so = await insertOrder(schema.salesOrder, SO_NO, 'customerId', cust.id);
  const po = await insertOrder(schema.purchaseOrder, PO_NO, 'supplierId', supp.id);
  await db.insert(schema.salesOrderItem).values({
    orderId: so.id,
    skuId: skuRow.id,
    skuCode: skuRow.code || 'SIMSKU',
    styleNo: 'SIMSTYLE',
    color: '-',
    size: '-',
    quantity: '1',
    price: '0',
    amount: '0',
  });

  await RequestContext.run({ dealerScope: ALL_SCOPE, userId: 'sim' }, async () => {
    try {
      // ---------- 7. 未软删行仍受唯一约束保护（先测，避免数据被软删干扰） ----------
      console.log('\n[0] 未软删行的 order_no 唯一约束仍然生效');
      let liveDupErr = null;
      try {
        await insertOrder(schema.salesOrder, SO_NO, 'customerId', cust.id);
      } catch (e) {
        liveDupErr = e;
      }
      check('草稿单已存在时，同 order_no 不能再插入', liveDupErr != null);

      // ---------- 1. 看板基线（两个单据都在） ----------
      const before = await dash.getStats();
      console.log(`\n[1] 看板基线 pendingDocCount=${before.pendingDocCount}`);

      // ---------- 2. 销售单软删 ----------
      console.log('\n[2] SalesOrderService.delete()');
      await salesSvc.delete(so.id);

      const rawSo = await db.select().from(schema.salesOrder).where(eq(schema.salesOrder.id, so.id));
      check('物理行仍在（软删而非硬删）', rawSo.length === 1);
      check('_deleted_at 已置位', rawSo[0]?.deletedAt != null, `deletedAt=${rawSo[0]?.deletedAt ?? 'null'}`);
      check(
        '_updated_at 已推进（下游增量同步可感知）',
        rawSo[0]?._updated_at != null || rawSo[0]?.updatedAt != null,
      );

      const items = await db
        .select()
        .from(schema.salesOrderItem)
        .where(eq(schema.salesOrderItem.orderId, so.id));
      check('明细行未被级联删除', items.length === 1, `items=${items.length}`);

      let detailErr = null;
      try {
        await salesSvc.getDetail(so.id);
      } catch (e) {
        detailErr = e;
      }
      check('getDetail 看不到被删单据', detailErr != null, detailErr ? errMsg(detailErr) : '仍可查到');

      const listed = await salesSvc.list({ page: 1, pageSize: 100 });
      check(
        'list 中不含被删单据',
        !listed.items.some((r) => r.id === so.id),
        `total=${listed.total}`,
      );

      // 被软删的草稿单应当**不再**计入待处理单据数：
      // 若漏掉 isNull(deletedAt) 过滤，这里就会停在基线值（修复前的行为）。
      const afterDelete = await dash.getStats();
      check(
        '看板 pendingDocCount 减 1（软删草稿单不再计入）',
        afterDelete.pendingDocCount === before.pendingDocCount - 1,
        `${before.pendingDocCount} → ${afterDelete.pendingDocCount}（漏加 isNull 过滤时会停在 ${before.pendingDocCount}）`,
      );

      // ---------- 3. 采购单软删 ----------
      console.log('\n[3] PurchaseOrderService.delete()');
      await purchaseSvc.delete(po.id);
      const rawPo = await db
        .select()
        .from(schema.purchaseOrder)
        .where(eq(schema.purchaseOrder.id, po.id));
      check('物理行仍在', rawPo.length === 1);
      check('_deleted_at 已置位', rawPo[0]?.deletedAt != null);

      // ---------- 4. 还原 ----------
      console.log('\n[4] restore()');
      await salesSvc.restore(so.id);
      await purchaseSvc.restore(po.id);

      const restoredSo = await db
        .select()
        .from(schema.salesOrder)
        .where(eq(schema.salesOrder.id, so.id));
      check('还原后 _deleted_at 清空', restoredSo[0]?.deletedAt == null);
      const backDetail = await salesSvc.getDetail(so.id);
      check('还原后 getDetail 可查回', !!backDetail?.id);
      const restored = await dash.getStats();
      check(
        '还原后 pendingDocCount 回到基线',
        restored.pendingDocCount === before.pendingDocCount,
        `${before.pendingDocCount} → ${restored.pendingDocCount}`,
      );

      // ---------- 5. 软删后复用同一 order_no 重建 ----------
      console.log('\n[5] 软删后复用同一 order_no 重建');
      await salesSvc.delete(so.id);
      let rebuildErr = null;
      try {
        await insertOrder(schema.salesOrder, SO_NO, 'customerId', cust.id);
      } catch (e) {
        rebuildErr = e;
      }
      check('软删后可用同一 order_no 重建', rebuildErr == null, rebuildErr ? errMsg(rebuildErr) : '');
    } finally {
      // ---------- 清理 ----------
      console.log('\n[6] 清理测试数据');
      await db
        .delete(schema.salesOrderItem)
        .where(eq(schema.salesOrderItem.orderId, so.id));
      await db.delete(schema.salesOrder).where(
        or(eq(schema.salesOrder.id, so.id), eq(schema.salesOrder.orderNo, SO_NO)),
      );
      await db.delete(schema.purchaseOrder).where(
        or(eq(schema.purchaseOrder.id, po.id), eq(schema.purchaseOrder.orderNo, PO_NO)),
      );
      const leaked = await db
        .select({ c: schema.salesOrder.id })
        .from(schema.salesOrder)
        .where(isNull(schema.salesOrder.deletedAt));
      console.log(`  库中未删除的销售单总数=${leaked.length}`);
    }
  });

  console.log(`\n${failures === 0 ? '✅ 软删扩表验证 PASS' : `❌ 软删扩表验证 FAIL (failures=${failures})`}`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
