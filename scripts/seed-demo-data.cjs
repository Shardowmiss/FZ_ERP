#!/usr/bin/env node
/**
 * ERP 演示数据种子脚本（开发环境，可重复执行、幂等）
 * - 复用项目自带的 postgres@3.4.9 驱动
 * - 引用 erp_db 中已有主数据（store/warehouse/supplier/material/sku/style/channel）；客户主数据已移除，销售单客户名称用固定演示值
 * - 为各"单据模块"插入少量连贯数据，便于点击模拟、发现问题
 * - 运行: node scripts/seed-demo-data.cjs
 */
const path = require('path');
const postgres = require(path.join(__dirname, '..', 'node_modules', 'postgres'));

const conn = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const sql = postgres(conn, { max: 1 });

const n = (v, d = 2) => (v == null || isNaN(Number(v)) ? Number(d) : Number(v));
const date = (offDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - offDays);
  return d.toISOString().slice(0, 10);
};
const pick = (arr, i) => arr[Math.min(i, arr.length - 1)];
const ins = async (table, obj) => (await sql`INSERT INTO ${sql(table)} ${sql(obj)} RETURNING id`)[0].id;
const guard = async (table, col, val) =>
  (await sql`SELECT 1 FROM ${sql(table)} WHERE ${sql(col)} = ${val} LIMIT 1`).length > 0;
const getId = async (table, col, val) => {
  const r = await sql`SELECT id FROM ${sql(table)} WHERE ${sql(col)} = ${val} LIMIT 1`;
  return r[0] ? r[0].id : null;
};
// 存在则取 id，否则插入并返回 id
const upsertId = async (table, col, val, obj) => {
  const ex = await getId(table, col, val);
  if (ex) return ex;
  return ins(table, obj);
};

(async () => {
  console.log('== 读取主数据 ==');
  // 客户主数据已移除（sales_order 仅保留 customer_name 自由文本，无 customer_id 外键）。
  // 演示销售单的客户名称改用固定演示值，避免种子脚本在空库/新库上因查询已删除的 customer 表而直接崩溃。
  const customers = [{ id: null, name: '华南连锁批发' }];
  const stores = await sql`SELECT id, name, store_type FROM store LIMIT 6`;
  const warehouses = await sql`SELECT id, name FROM warehouse LIMIT 6`;
  const suppliers = await sql`SELECT id, name FROM supplier LIMIT 6`;
  const materials = await sql`SELECT id, code, name, unit, std_price FROM material`;
  const skus = await sql`SELECT id, sku_code, style_no, color, size, tag_price, cost_price FROM sku LIMIT 10`;
  const styles = await sql`SELECT id, style_no FROM style LIMIT 5`;
  const channels = await sql`SELECT id, name FROM sales_channel LIMIT 1`;
  console.log(`customers=${customers.length} stores=${stores.length} warehouses=${warehouses.length} suppliers=${suppliers.length} materials=${materials.length} skus=${skus.length} styles=${styles.length} channels=${channels.length}`);

  const C = (i) => pick(customers, i);
  const ST = (i) => pick(stores, i);
  const W = (i) => pick(warehouses, i);
  const SUP = (i) => pick(suppliers, i);
  const SKU = (i) => pick(skus, i);
  const ch = channels[0];
  const report = {};

  // ============ 1) 销售：订单 → 出库 → 应收 → 收款 → 退货 ============
  {
    const soNo = 'SEED-SO-2026-001';
    const c = C(0);
    const s1 = SKU(0), s2 = SKU(1);
    const p1 = n(s1.tag_price) || 199, p2 = n(s2.tag_price) || 299;
    const q1 = 10, q2 = 5, amt1 = p1 * q1, amt2 = p2 * q2, total = amt1 + amt2;
    const soId = await upsertId('sales_order', 'order_no', soNo, {
      order_no: soNo, customer_name: c.name, order_date: date(20),
      delivery_date: date(15), total_amount: total, status: 'draft',
    });
    // 历史兼容：早期 seed 版本向 sales_order 写入了状态机无法识别的状态（如 'confirmed'），
    // 导致该演示单在界面中无法渲染/流转。规范化回合法草稿态，使演示单可正常打开与操作。
    // 幂等：仅当确为非法遗留值时更新，重复执行无副作用。
    await sql`UPDATE sales_order SET status = 'draft' WHERE order_no = ${soNo} AND status = 'confirmed'`;
    const getItem = async (skuId) =>
      (await sql`SELECT id FROM sales_order_item WHERE order_id=${soId} AND sku_id=${skuId} LIMIT 1`)[0]?.id;
    let it1 = await getItem(s1.id);
    if (!it1) it1 = await ins('sales_order_item', { order_id: soId, sku_id: s1.id, sku_code: s1.sku_code, style_no: s1.style_no, color: s1.color, size: s1.size, quantity: q1, price: p1, amount: amt1, delivered_qty: 0 });
    let it2 = await getItem(s2.id);
    if (!it2) it2 = await ins('sales_order_item', { order_id: soId, sku_id: s2.id, sku_code: s2.sku_code, style_no: s2.style_no, color: s2.color, size: s2.size, quantity: q2, price: p2, amount: amt2, delivered_qty: 0 });

    const obNo = 'SEED-OB-2026-001';
    const w = W(0);
    let obId = await getId('sales_outbound', 'outbound_no', obNo);
    if (!obId) {
      obId = await ins('sales_outbound', { outbound_no: obNo, order_id: soId, order_no: soNo, customer_name: c.name, warehouse_id: w.id, warehouse_name: w.name, outbound_date: date(10), total_amount: total, cost_amount: n(s1.cost_price) * q1 + n(s2.cost_price) * q2, status: 'out' });
      if (!(await guard('sales_outbound_item', 'outbound_id', obId))) {
        await ins('sales_outbound_item', { outbound_id: obId, order_item_id: it1, sku_id: s1.id, sku_code: s1.sku_code, style_no: s1.style_no, color: s1.color, size: s1.size, quantity: q1, price: p1, cost_price: n(s1.cost_price), amount: amt1, cost_amount: n(s1.cost_price) * q1, batch_no: 'B20260901' });
        await ins('sales_outbound_item', { outbound_id: obId, order_item_id: it2, sku_id: s2.id, sku_code: s2.sku_code, style_no: s2.style_no, color: s2.color, size: s2.size, quantity: q2, price: p2, cost_price: n(s2.cost_price), amount: amt2, cost_amount: n(s2.cost_price) * q2, batch_no: 'B20260901' });
      }
    }
    const recNo = 'SEED-AR-2026-001';
    if (!(await guard('receivable', 'receivable_no', recNo))) {
      await ins('receivable', { receivable_no: recNo, customer_name: c.name, biz_type: 'sales_outbound', biz_no: obNo, amount: total, received_amount: 0, balance: total, due_date: date(-5), status: 'unpaid' });
    }
    if (!(await guard('finance_receipt', 'receipt_no', 'SEED-RC-2026-001'))) {
      await ins('finance_receipt', { receipt_no: 'SEED-RC-2026-001', receipt_date: date(8), customer_name: c.name, amount: total * 0.6, payment_method: 'transfer', handler: '财务-王', status: 'confirmed', remark: '演示收款60%' });
    }
    const rtNo = 'SEED-SR-2026-001';
    if (!(await guard('sales_return', 'return_no', rtNo))) {
      const rtId = await ins('sales_return', { return_no: rtNo, outbound_id: obId, outbound_no: obNo, customer_name: c.name, warehouse_id: w.id, warehouse_name: w.name, return_date: date(3), total_amount: amt1, status: 'returned' });
      await ins('sales_return_item', { return_id: rtId, sku_id: s1.id, sku_code: s1.sku_code, style_no: s1.style_no, color: s1.color, size: s1.size, quantity: 2, price: p1, amount: p1 * 2 });
    }
    report.sales = { soId, obId };
  }

  // ============ 2) 采购：订单 → 入库 → 应付 → 付款 ============
  {
    const poNo = 'SEED-PO-2026-001';
    const sup = SUP(0);
    const m1 = materials[0], m2 = materials[1] || materials[0];
    const q1 = 100, q2 = 50, p1 = n(m1.std_price) || 8, p2 = n(m2.std_price) || 12, amt1 = q1 * p1, amt2 = q2 * p2, total = amt1 + amt2;
    const poId = await upsertId('purchase_order', 'order_no', poNo, { order_no: poNo, supplier_id: sup.id, supplier_name: sup.name, order_date: date(25), expect_date: date(15), total_amount: total, status: 'confirmed' });
    const getPi = async (mid) => (await sql`SELECT id FROM purchase_order_item WHERE order_id=${poId} AND material_id=${mid} LIMIT 1`)[0]?.id;
    let pi1 = await getPi(m1.id);
    if (!pi1) pi1 = await ins('purchase_order_item', { order_id: poId, material_id: m1.id, material_code: m1.code, material_name: m1.name, unit: m1.unit || '个', quantity: q1, price: p1, amount: amt1, received_qty: 0 });
    let pi2 = await getPi(m2.id);
    if (!pi2) pi2 = await ins('purchase_order_item', { order_id: poId, material_id: m2.id, material_code: m2.code, material_name: m2.name, unit: m2.unit || '个', quantity: q2, price: p2, amount: amt2, received_qty: 0 });

    const ibNo = 'SEED-IB-2026-001';
    const w = W(1);
    let ibId = await getId('purchase_inbound', 'inbound_no', ibNo);
    if (!ibId) {
      ibId = await ins('purchase_inbound', { inbound_no: ibNo, order_id: poId, order_no: poNo, supplier_id: sup.id, supplier_name: sup.name, warehouse_id: w.id, warehouse_name: w.name, inbound_date: date(12), total_amount: total, status: 'in_stock' });
      if (!(await guard('purchase_inbound_item', 'inbound_id', ibId))) {
        await ins('purchase_inbound_item', { inbound_id: ibId, order_item_id: pi1, material_id: m1.id, material_code: m1.code, material_name: m1.name, unit: m1.unit || '个', quantity: q1, price: p1, amount: amt1, batch_no: 'P20260901' });
        await ins('purchase_inbound_item', { inbound_id: ibId, order_item_id: pi2, material_id: m2.id, material_code: m2.code, material_name: m2.name, unit: m2.unit || '个', quantity: q2, price: p2, amount: amt2, batch_no: 'P20260901' });
      }
    }
    const payNo = 'SEED-AP-2026-001';
    let payId = await getId('payable', 'payable_no', payNo);
    if (!payId) {
      payId = await ins('payable', { payable_no: payNo, supplier_id: sup.id, supplier_name: sup.name, biz_type: 'purchase_inbound', biz_no: ibNo, amount: total, paid_amount: 0, balance: total, due_date: date(-2), status: 'unpaid' });
      if (!(await guard('finance_payment', 'payment_no', 'SEED-PAY-2026-001'))) {
        await ins('finance_payment', { payment_no: 'SEED-PAY-2026-001', payment_date: date(6), supplier_id: sup.id, supplier_name: sup.name, amount: total * 0.5, payment_method: 'transfer', handler: '财务-李', status: 'confirmed', remark: '演示付款50%' });
      }
      if (!(await guard('payable_payment', 'payable_id', payId))) {
        await ins('payable_payment', { payable_id: payId, payment_date: date(6), amount: total * 0.5, payment_method: 'transfer' });
      }
    }
    report.purchase = { poId, ibId, payId };
  }

  // ============ 3) 零售订单（含 pos_session） ============
  {
    const rNo = 'SEED-RT-2026-001';
    if (!(await guard('retail_order', 'retail_no', rNo))) {
      const st = ST(0);
      const sessId = await ins('pos_session', { store_id: st.id, store_name: st.name, open_time: new Date(Date.now() - 8 * 3600e3).toISOString(), close_time: new Date().toISOString(), open_amount: 500, close_amount: 3500, expected_amount: 3000, status: 'closed' });
      const s1 = SKU(2), s2 = SKU(3);
      const p1 = n(s1.tag_price) || 159, p2 = n(s2.tag_price) || 259, q1 = 2, q2 = 1, amt1 = p1 * q1, amt2 = p2 * q2, total = amt1 + amt2;
      const rtId = await ins('retail_order', { retail_no: rNo, store_id: st.id, store_name: st.name, sale_date: date(1), cashier_name: '店员01', source: 'store_pos', total_amount: total, discount_amount: 0, receivable_amount: total, received_amount: total, change_amount: 0, pay_methods: [{ method: 'wechat', amount: total }], item_count: q1 + q2, status: 'settled', pos_session_id: sessId });
      await ins('retail_order_item', { retail_id: rtId, sku_id: s1.id, sku_code: s1.sku_code, style_no: s1.style_no, color: s1.color, size: s1.size, quantity: q1, tag_price: p1, deal_price: p1, discount_rate: 1, line_amount: amt1 });
      await ins('retail_order_item', { retail_id: rtId, sku_id: s2.id, sku_code: s2.sku_code, style_no: s2.style_no, color: s2.color, size: s2.size, quantity: q2, tag_price: p2, deal_price: p2, discount_rate: 1, line_amount: amt2 });
      report.retail = { rtId, sessId };
    }
  }

  // ============ 4) 库存现存量 + 库存调拨 ============
  {
    const w = W(0);
    let stockCnt = 0;
    for (let i = 0; i < Math.min(6, skus.length); i++) {
      const s = skus[i];
      if (await guard('inventory_stock', 'sku_id', s.id) && await guard('inventory_stock', 'warehouse_id', w.id)) {
        const ex = await sql`SELECT 1 FROM inventory_stock WHERE sku_id=${s.id} AND warehouse_id=${w.id} LIMIT 1`;
        if (ex.length) continue;
      }
      const ex = await sql`SELECT 1 FROM inventory_stock WHERE sku_id=${s.id} AND warehouse_id=${w.id} LIMIT 1`;
      if (ex.length) continue;
      await ins('inventory_stock', { sku_id: s.id, sku_code: s.sku_code, style_no: s.style_no, color: s.color, size: s.size, warehouse_id: w.id, warehouse_name: w.name, quantity: 50 + i * 10, in_transit_qty: 10 });
      stockCnt++;
    }
    const tfNo = 'SEED-TR-2026-001';
    if (!(await guard('inventory_transfer', 'transfer_no', tfNo))) {
      const wf = W(0), wt = W(2), s = SKU(0);
      const tfId = await ins('inventory_transfer', { transfer_no: tfNo, from_warehouse_id: wf.id, from_warehouse_name: wf.name, to_warehouse_id: wt.id, to_warehouse_name: wt.name, transfer_date: date(4), item_type: 'sku', status: 'completed' });
      await ins('inventory_transfer_item', { transfer_id: tfId, sku_id: s.id, item_code: s.sku_code, item_name: s.style_no, color: s.color, size: s.size, quantity: 20 });
      report.transfer = { tfId };
    }
    report.stockAdded = stockCnt;
  }

  // ============ 5) 补货计划 ============
  {
    const plNo = 'SEED-RP-2026-001';
    let plId = await getId('replenish_plan', 'plan_no', plNo);
    if (!plId) {
      const st = ST(1);
      plId = await ins('replenish_plan', { plan_no: plNo, store_id: st.id, store_type: st.store_type, store_name: st.name, doc_type: 'transfer', status: 'confirmed', calc_snapshot: { avgDaily: 5, leadTime: 7, safetyDays: 10, generatedAt: new Date().toISOString() }, remark: '演示补货计划' });
      for (let i = 0; i < Math.min(4, skus.length); i++) {
        const s = skus[i];
        const recent = 30 + i * 5, dailyAvg = (recent / 30).toFixed(2);
        await ins('replenish_plan_item', { plan_id: plId, sku_id: s.id, sku_code: s.sku_code, style_no: s.style_no, color: s.color, size: s.size, recent_sales_qty: recent, daily_avg: dailyAvg, current_stock: 40 + i * 5, in_transit_qty: 10, safety_stock: 20, suggested_raw: 40 + i * 5, suggested_qty: 60 + i * 5 });
      }
      report.replenish = { plId };
    }
  }

  // ============ 6) 价格体系 ============
  {
    const code = 'SEED-PL-STORE-001';
    let plId = await getId('price_list', 'code', code);
    if (!plId) {
      plId = await ins('price_list', { code, name: '演示门店零售价', type: 'store', scope_id: ST(0).id, priority: 10, status: 'active', effective_from: date(30), remark: '演示价格表' });
      for (let i = 0; i < Math.min(6, skus.length); i++) {
        const s = skus[i], tp = n(s.tag_price) || 199;
        await ins('price_list_item', { price_list_id: plId, style_no: s.style_no, sku_id: s.id, sku_code: s.sku_code, tag_price: tp, price: tp, discount_rate: 1, status: 'active' });
      }
      report.priceList = { plId };
    }
  }

  // ============ 7) 全渠道订单 ============
  {
    const oNo = 'SEED-OMNI-2026-001';
    if (!(await guard('omni_order', 'order_no', oNo))) {
      const s1 = SKU(4), s2 = SKU(5) || SKU(0);
      const p1 = n(s1.tag_price) || 199, p2 = n(s2.tag_price) || 199, total = p1 * 2 + p2;
      const omId = await ins('omni_order', { order_no: oNo, channel_id: ch.id, channel_name: ch.name, customer_name: '渠道客户-测试', contact_phone: '13800000000', address: '浙江省杭州市萧山区', total_amount: total, item_count: 3, status: 'confirmed', ship_status: 'shipped', remark: '演示全渠道订单' });
      await ins('omni_order_item', { omni_order_id: omId, sku_id: s1.id, sku_code: s1.sku_code, style_no: s1.style_no, color: s1.color, size: s1.size, quantity: 2, price: p1, amount: p1 * 2 });
      await ins('omni_order_item', { omni_order_id: omId, sku_id: s2.id, sku_code: s2.sku_code, style_no: s2.style_no, color: s2.color, size: s2.size, quantity: 1, price: p2, amount: p2 });
      report.omni = { omId };
    }
  }

  // ============ 8) 生产工单（领料 / 完工） ============
  {
    const woNo = 'SEED-WO-2026-001';
    let woId = await getId('production_work_order', 'order_no', woNo);
    if (!woId) {
      const st = styles[0], sup = SUP(1) || SUP(0), w = W(3) || W(0);
      woId = await ins('production_work_order', { order_no: woNo, style_id: st.id, style_no: st.style_no, quantity: 200, supplier_id: sup.id, factory_name: sup.name, plan_start_date: date(15), plan_finish_date: date(2), actual_start_date: date(12), actual_finish_date: date(1), status: 'completed' });
      await ins('production_material_issue', { issue_no: 'SEED-ISSUE-2026-001', work_order_id: woId, work_order_no: woNo, warehouse_id: w.id, issue_date: date(10), receiver: '车间-张', status: 'completed' });
      await ins('production_finish_receipt', { receipt_no: 'SEED-FIN-2026-001', work_order_id: woId, work_order_no: woNo, warehouse_id: w.id, receipt_date: date(1), finished_qty: 195, defective_qty: 5, status: 'completed' });
      report.production = { woId };
    }
  }

  console.log('== 种子完成 ==');
  console.log(JSON.stringify(report, null, 2));
  const tables = ['sales_order', 'sales_outbound', 'sales_return', 'receivable', 'finance_receipt', 'purchase_order', 'purchase_inbound', 'payable', 'finance_payment', 'retail_order', 'pos_session', 'inventory_stock', 'inventory_transfer', 'replenish_plan', 'price_list', 'omni_order', 'production_work_order'];
  console.log('== 现有行数 ==');
  for (const t of tables) {
    const r = await sql`SELECT count(*)::int AS c FROM ${sql(t)}`;
    console.log(`  ${t}: ${r[0].c}`);
  }
  await sql.end();
})().catch(async (e) => {
  console.error('SEED ERROR:', e.message);
  await sql.end();
  process.exit(1);
});
