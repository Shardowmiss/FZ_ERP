#!/usr/bin/env node
/**
 * scripts/seed-quarter-2026aw.cjs
 * -----------------------------------------------------------------------------
 * 2026 秋冬订货会 → 成衣采购(外包加工) → 配货 → 店铺零售 全链路种子数据。
 *
 * 目标：初始化一批信息齐全的新商品款式，并走通「订货会→预订单→成衣采购入库到中心仓
 *      →配货到门店仓→店铺零售」完整业务链，单据量贴近真实服装企业一个季度(Q3 7–9 月)
 *      的业绩规模（标准档：10 新款 / ~140 SKU / 15 门店预订单 / ~25 门店配货 / ~700 零售单）。
 *
 * 运行：node scripts/seed-quarter-2026aw.cjs   （依赖 postgres.js，连接 erp_db）
 * 幂等：开头按前缀清理旧种子数据，可重复执行；系统字段(_created_at/_updated_by 等)省略由 DB 默认值填充。
 *
 * 关键约束（已对照 server/database/schema.ts 核实）：
 *   - 插入对象 MUST 用 snake_case 键（postgres.js 把键名原样当列名）。
 *   - 库存自洽：中心仓余量 = 入库量 − Σ配货量 ≥ 0；门店仓余量 = 配货量 − Σ零售量 ≥ 0。
 *   - inventory_stock 唯一键 (sku_id, warehouse_id)，每 (sku,仓库) 一行。
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const postgres = require(path.join(__dirname, '..', 'node_modules', 'postgres'));

const conn = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const sql = postgres(conn, { max: 1 });

// ----------------------------------------------------------------- 工具函数
const ins = async (table, obj) => { await sql`INSERT INTO ${sql(table)} ${sql(obj)}`; };
const getId = async (table, col, val) => {
  const r = await sql`SELECT id FROM ${sql(table)} WHERE ${sql(col)} = ${val} LIMIT 1`;
  return r[0] ? r[0].id : null;
};
const n2 = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2); // 金额 → 2 位小数字符串

// 可复现随机数（固定种子，保证重跑结果一致、便于核对）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260917);
const rint = (lo, hi) => Math.floor(rng() * (hi - lo + 1)) + lo;
const rpick = (arr) => arr[Math.floor(rng() * arr.length)];

// 最大余数法：把 total 按 weights 分配为整数数组，且各项求和 === total
function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const floor = weights.map((w) => Math.floor((total * w) / sum));
  let rem = total - floor.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, f: (total * w) / sum - Math.floor((total * w) / sum) }))
    .sort((a, b) => b.f - a.f);
  for (let k = 0; k < rem; k++) floor[order[k % order.length].i]++;
  return floor;
}
// 从 0..n-1 中取 k 个不重复下标
function sampleIndices(n, k) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k).sort((a, b) => a - b);
}

// ----------------------------------------------------------------- 主数据配置
// 中心仓（成衣入库到此）：中央总仓(finished)
const CENTRAL_WH_ID = '86acab06-85e7-4ec7-b86d-86597b936e8e';
const CENTRAL_WH_NAME = '中央总仓';
// 复用现有色组/尺组
const COLOR_GROUP_ID = '477db48e-9a3c-4d63-b9d2-7246762bc44a'; // 基础色组
const SIZE_GROUP_ID = 'f0745a6f-f5b6-47fb-aa8e-a7829fddf20c'; // 标准尺码
// 成衣外包加工厂（供应商，轮询分配给各款）
const SUPPLIERS = [
  { id: '63803d1e-6a6d-4dd3-97db-4ee47e4676fd', name: '中山嘉禾服装制造有限公司' },
  { id: '0718195f-e880-4eee-97d0-7f5a1105e050', name: '东莞盛隆印染加工厂' },
  { id: '7fdc7216-067a-4539-aaf3-7f32902436e0', name: '361°（广州）品牌总代理' },
];
// 新增真实颜色（白/黑/灰/藏青/卡其/杏/红/蓝）
const COLORS = [
  { code: 'WH', name: '白', hex: '#FFFFFF' },
  { code: 'BK', name: '黑', hex: '#222222' },
  { code: 'GY', name: '灰', hex: '#9CA3AF' },
  { code: 'NV', name: '藏青', hex: '#1E3A5F' },
  { code: 'KH', name: '卡其', hex: '#C3B091' },
  { code: 'AP', name: '杏', hex: '#F4C2A1' },
  { code: 'RD', name: '红', hex: '#C0392B' },
  { code: 'BL', name: '蓝', hex: '#2E5AAC' },
];
// 新增尺码（XS/XXL 为新加，S/M/L/XL 复用既有）
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SIZE_NAME = { XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XXL', Y: 'Y', Z: 'Z', 均码: '均码' };

// 10 个 2026 秋冬新款（信息齐全）。colors/sizes 子集决定 SKU 矩阵（每款 ~12–16 → 合计 ~140）
const STYLES = [
  { no: 'AW26-001', name: '羊毛混纺双面大衣', category: '女装', subCategory: '大衣', tag: 899, cost: 330, supply: 470,
    colors: ['BK', 'GY', 'NV', 'KH', 'AP'], sizes: ['M', 'L', 'XL'] },
  { no: 'AW26-002', name: '轻量短款羽绒服', category: '男装', subCategory: '羽绒服', tag: 1099, cost: 420, supply: 580,
    colors: ['BK', 'NV', 'RD'], sizes: ['S', 'M', 'L', 'XL'] },
  { no: 'AW26-003', name: '慵懒风针织开衫', category: '女装', subCategory: '针织', tag: 459, cost: 150, supply: 230,
    colors: ['WH', 'GY', 'AP', 'KH'], sizes: ['M', 'L', 'XL'] },
  { no: 'AW26-004', name: '加绒连帽卫衣', category: '休闲', subCategory: '卫衣', tag: 359, cost: 120, supply: 180,
    colors: ['BK', 'GY', 'RD', 'BL'], sizes: ['S', 'M', 'L', 'XL'] },
  { no: 'AW26-005', name: '弹力灯芯绒休闲裤', category: '男装', subCategory: '裤装', tag: 299, cost: 95, supply: 150,
    colors: ['KH', 'NV', 'BK', 'BL'], sizes: ['S', 'M', 'L', 'XL'] },
  { no: 'AW26-006', name: '经典英伦风衣', category: '外套', subCategory: '风衣', tag: 699, cost: 250, supply: 360,
    colors: ['BK', 'KH', 'GY', 'NV'], sizes: ['S', 'M', 'L', 'XL'] },
  { no: 'AW26-007', name: '半高领羊毛毛衣', category: '女装', subCategory: '针织', tag: 399, cost: 130, supply: 200,
    colors: ['WH', 'BK', 'GY', 'RD'], sizes: ['M', 'L', 'XL'] },
  { no: 'AW26-008', name: '摇粒绒拉链外套', category: '休闲', subCategory: '外套', tag: 329, cost: 110, supply: 170,
    colors: ['BK', 'GY', 'BL'], sizes: ['S', 'M', 'L', 'XL'] },
  { no: 'AW26-009', name: '保暖中长款棉服', category: '男装', subCategory: '棉服', tag: 599, cost: 220, supply: 320,
    colors: ['BK', 'NV', 'RD', 'KH'], sizes: ['M', 'L', 'XL'] },
  { no: 'AW26-010', name: '修身商务西装外套', category: '男装', subCategory: '西装', tag: 799, cost: 290, supply: 420,
    colors: ['BK', 'GY', 'NV', 'BL'], sizes: ['S', 'M', 'L', 'XL'] },
];

const PAY_METHODS = ['wechat', 'alipay', 'cash', 'bankcard', 'member_card'];
const CASHIERS = ['店员A', '店员B', '店员C', '店员D', '店员E', '店员F'];

// ----------------------------------------------------------------- 主流程
async function main() {
  console.log('[1/8] 清理旧种子数据（按前缀幂等）...');
  await sql`DELETE FROM retail_order_item WHERE sku_code LIKE 'AW26%'`;
  await sql`DELETE FROM retail_order WHERE retail_no LIKE 'AW26RT%'`;
  await sql`DELETE FROM allocation_item WHERE sku_code LIKE 'AW26%'`;
  await sql`DELETE FROM allocation_order WHERE allocation_no LIKE 'AW26AL%'`;
  await sql`DELETE FROM garment_purchase_inbound_sku WHERE sku_code LIKE 'AW26%'`;
  await sql`DELETE FROM garment_purchase_inbound WHERE inbound_no LIKE 'AW26GPI%'`;
  await sql`DELETE FROM garment_purchase_order WHERE order_no LIKE 'AW26GPO%'`;
  await sql`DELETE FROM pre_order_item WHERE sku_code LIKE 'AW26%'`;
  await sql`DELETE FROM pre_order WHERE pre_order_no LIKE 'AW26PO%'`;
  await sql`DELETE FROM trade_show WHERE show_no LIKE 'AW26%'`;
  await sql`DELETE FROM inventory_stock WHERE sku_code LIKE 'AW26%'`;
  await sql`DELETE FROM sku WHERE sku_code LIKE 'AW26%'`;
  await sql`DELETE FROM style WHERE style_no LIKE 'AW26%'`;

  console.log('[2/8] 新增颜色/尺码（按 code 幂等 upsert）...');
  const colorIdByCode = {};
  for (const c of COLORS) {
    let id = await getId('color', 'code', c.code);
    if (!id) {
      id = crypto.randomUUID();
      await ins('color', { id, code: c.code, name: c.name, hex: c.hex, sort_order: rint(1, 99), status: 'active' });
    }
    colorIdByCode[c.code] = id;
  }
  const sizeIdByName = {};
  for (const s of SIZES) {
    let id = await getId('size', 'code', s);
    if (!id) {
      id = crypto.randomUUID();
      await ins('size', { id, code: s, name: SIZE_NAME[s] || s, sort_order: rint(1, 99), status: 'active' });
    }
    sizeIdByName[s] = id;
  }

  console.log('[3/8] 取真实门店/经销商/仓库（前 25 家用于配货，前 15 家参与预订单）...');
  const stores = await sql`
    SELECT s.id AS id, s.code AS code, s.name AS name,
           s.dealer_id AS dealer_id, d.name AS dealer_name,
           s.warehouse_id AS warehouse_id, w.name AS warehouse_name
    FROM store s
    JOIN dealer d ON s.dealer_id = d.id
    JOIN warehouse w ON s.warehouse_id = w.id
    ORDER BY s.code
    LIMIT 25`;
  if (stores.length < 25) throw new Error('门店不足 25 家，请检查数据');
  const preOrderStores = stores.slice(0, 15);
  const allocStores = stores; // 全部 25 家配货

  // ----------------------------------------------------------- 新品 + SKU 矩阵
  console.log('[4/8] 新建 10 个款式 + SKU 矩阵...');
  const skuList = []; // 每个: {id, styleId, styleNo, code, color, colorId, size, sizeId, cost, tag, supply}
  const produced = {}; // skuId -> 入库(生产)数量
  for (let si = 0; si < STYLES.length; si++) {
    const st = STYLES[si];
    const styleId = crypto.randomUUID();
    await ins('style', {
      id: styleId,
      style_no: st.no,
      name: st.name,
      category: st.category,
      sub_category: st.subCategory,
      season: 'autumn-winter',
      wave: '2026AW',
      year: '2026',
      brand: 'AW2026',
      fit: 'regular',
      tag_price: String(st.tag),
      cost_price: String(st.cost),
      supply_price: String(st.supply),
      color_group_id: COLOR_GROUP_ID,
      size_group_id: SIZE_GROUP_ID,
      status: 'active',
      lifecycle_status: 'active',
      attributes: { fabric: '参见吊牌', season: '2026AW', gender: st.category },
      remark: `2026 秋冬新品·${st.name}`,
    });
    for (const cCode of st.colors) {
      for (const sCode of st.sizes) {
        const skuId = crypto.randomUUID();
        const skuCode = `${st.no}-${cCode}-${sCode}`;
        const colorName = COLORS.find((c) => c.code === cCode).name;
        await ins('sku', {
          id: skuId,
          sku_code: skuCode,
          style_id: styleId,
          style_no: st.no,
          color: colorName,
          size: sCode,
          color_id: colorIdByCode[cCode],
          size_id: sizeIdByName[sCode],
          barcode: skuCode,
          cost_price: String(st.cost),
          tag_price: String(st.tag),
          supply_price: String(st.supply),
          status: 'active',
        });
        skuList.push({
          id: skuId, styleId, styleNo: st.no, code: skuCode,
          color: colorName, colorId: colorIdByCode[cCode],
          size: sCode, sizeId: sizeIdByName[sCode],
          cost: st.cost, tag: st.tag, supply: st.supply,
        });
        produced[skuId] = rint(8, 45); // 生产量
      }
    }
  }
  console.log(`      款式 ${STYLES.length} 个 / SKU ${skuList.length} 个 / 生产总量 ${Object.values(produced).reduce((a, b) => a + b, 0)} 件`);

  // ----------------------------------------------------------- 订货会 + 预订单
  console.log('[5/8] 创建 2026 秋冬订货会 + 15 家门店预订单...');
  const showId = crypto.randomUUID();
  const showNo = 'AW26-TS-2026AW';
  const showName = '2026 秋冬订货会';
  await ins('trade_show', {
    id: showId, show_no: showNo, name: showName,
    year: '2026', season: 'autumn-winter',
    start_date: '2026-04-10', end_date: '2026-04-18',
    status: 'active', remark: '2026 秋冬新品订货会（系统种子数据）',
  });

  const skuById = Object.fromEntries(skuList.map((s) => [s.id, s]));
  const skusByStyle = {};
  for (const s of skuList) (skusByStyle[s.styleId] = skusByStyle[s.styleId] || []).push(s);

  // 预订单：每家门店预订单覆盖 3–5 个款式
  let poCount = 0, poiCount = 0;
  const preQtyByStoreSku = {}; // storeId -> skuId -> 预测量（用于配货基线）
  for (const store of preOrderStores) {
    const styleIds = sampleIndices(STYLES.length, rint(3, 5)).map((i) => {
      // 找到该 style 的 styleId
      const st = STYLES[i];
      return skuList.find((s) => s.styleNo === st.no).styleId;
    });
    for (const styleId of styleIds) {
      const poId = crypto.randomUUID();
      const poNo = `AW26PO-${store.code}-${skuById[skusByStyle[styleId][0].id].styleNo}`;
      const styleNo = skuById[skusByStyle[styleId][0].id].styleNo;
      const styleName = STYLES.find((s) => s.no === styleNo).name;
      const items = [];
      let totalQty = 0;
      for (const sku of skusByStyle[styleId]) {
        const q = rint(2, Math.max(3, Math.round(produced[sku.id] * 0.45))); // 预测 ~45%
        if (q <= 0) continue;
        items.push({ sku, q });
        preQtyByStoreSku[store.id] = preQtyByStoreSku[store.id] || {};
        preQtyByStoreSku[store.id][sku.id] = (preQtyByStoreSku[store.id][sku.id] || 0) + q;
        totalQty += q;
      }
      if (items.length === 0) continue;
      await ins('pre_order', {
        id: poId, pre_order_no: poNo,
        trade_show_id: showId, trade_show_name: showName,
        submitter_type: store.dealer_name === '总部' ? 'direct' : 'dealer',
        dealer_id: store.dealer_id, dealer_name: store.dealer_name,
        store_id: store.id, store_name: store.name,
        style_id: styleId, style_no: styleNo, style_name: styleName,
        total_qty: String(totalQty), status: 'confirmed',
        submit_date: '2026-04-15', confirm_date: '2026-04-20',
        remark: '订货会门店预提报',
      });
      poCount++;
      for (const { sku, q } of items) {
        await ins('pre_order_item', {
          pre_order_id: poId, sku_id: sku.id, sku_code: sku.code,
          color: sku.color, size: sku.size, color_id: sku.colorId, size_id: sku.sizeId,
          qty: String(q),
        });
        poiCount++;
      }
    }
  }
  console.log(`      订货会 ${showName} / 预订单 ${poCount} 张 / 预订单明细 ${poiCount} 行`);

  // ----------------------------------------------------------- 成衣采购 + 入库（中心仓）
  console.log('[6/8] 成衣采购订单 + 采购入库到中心仓（中央总仓）...');
  let gpoCount = 0, gpiCount = 0;
  for (let si = 0; si < STYLES.length; si++) {
    const st = STYLES[si];
    const styleId = skuList.find((s) => s.styleNo === st.no).styleId;
    const sup = SUPPLIERS[si % SUPPLIERS.length];
    const orderId = crypto.randomUUID();
    const orderNo = `AW26GPO-${st.no}`;
    const inboundId = crypto.randomUUID();
    const inboundNo = `AW26GPI-${st.no}`;
    let totQty = 0, totAmt = 0;
    const skus = skusByStyle[styleId];
    const orderSkus = [];
    const inboundSkus = [];
    for (const sku of skus) {
      const q = produced[sku.id];
      const price = sku.cost;
      const amt = q * price;
      totQty += q; totAmt += amt;
      orderSkus.push({
        order_id: orderId, style_id: styleId, style_no: st.no,
        sku_id: sku.id, color: sku.color, size: sku.size,
        color_id: sku.colorId, size_id: sku.sizeId,
        quantity: String(q), price: String(price), amount: String(amt), received_qty: String(q),
      });
      inboundSkus.push({
        inbound_id: inboundId, order_sku_id: null, style_id: styleId, style_no: st.no,
        sku_id: sku.id, color: sku.color, size: sku.size,
        color_id: sku.colorId, size_id: sku.sizeId,
        quantity: String(q), price: String(price), amount: String(amt),
        accepted_qty: String(q), sku_code: sku.code, batch_no: `${st.no}-B1`,
      });
    }
    // 先插父表（采购订单 / 采购入库），再插子表（Sku 明细），满足外键顺序
    await ins('garment_purchase_order', {
      id: orderId, order_no: orderNo, supplier_id: sup.id, supplier_name: sup.name,
      order_date: '2026-05-06', expect_date: '2026-06-10', brand: 'AW2026', buyer: '采购部',
      total_amount: String(totAmt), total_qty: String(totQty), status: 'completed',
      remark: `2026 秋冬 ${st.name} 成衣外包加工采购`,
    });
    await ins('garment_purchase_inbound', {
      id: inboundId, inbound_no: inboundNo, order_id: orderId, order_no: orderNo,
      supplier_id: sup.id, supplier_name: sup.name,
      warehouse_id: CENTRAL_WH_ID, warehouse_name: CENTRAL_WH_NAME,
      inbound_date: '2026-06-15', total_amount: String(totAmt), total_qty: String(totQty),
      status: 'completed', remark: '成衣到货入库（中心仓）',
    });
    for (const os of orderSkus) await ins('garment_purchase_order_sku', os);
    for (const ib of inboundSkus) await ins('garment_purchase_inbound_sku', ib);
    gpoCount++; gpiCount++;
  }
  console.log(`      采购订单 ${gpoCount} / 采购入库 ${gpiCount}（均入 ${CENTRAL_WH_NAME}）`);

  // ----------------------------------------------------------- 配货（中心仓 → 门店仓）
  console.log('[7/8] 配货到 25 家门店仓（库存自洽）...');
  const alloc = {}; // storeId -> skuId -> qty
  const allocByWh = {}; // warehouseId -> skuId -> 配货量（聚合：多门店可能共用同一仓库）
  const whNameById = {}; // warehouseId -> warehouseName
  const allocTotal = {}; // skuId -> 配货总量
  let aloCount = 0, aliCount = 0;
  for (let si = 0; si < STYLES.length; si++) {
    const st = STYLES[si];
    const styleId = skuList.find((s) => s.styleNo === st.no).styleId;
    const styleName = st.name;
    const aloId = crypto.randomUUID();
    const aloNo = `AW26AL-${st.no}`;
    const skus = skusByStyle[styleId];
    let aloTotalQty = 0;
    const items = [];
    for (const sku of skus) {
      const totalAlloc = Math.round(produced[sku.id] * 0.78);
      if (totalAlloc <= 0) continue;
      const k = Math.min(allocStores.length, Math.max(6, Math.round(totalAlloc / 2)));
      const chosen = sampleIndices(allocStores.length, k);
      const weights = chosen.map(() => 0.5 + rng());
      const shares = distribute(totalAlloc, weights);
      for (let j = 0; j < chosen.length; j++) {
        const q = shares[j];
        if (q <= 0) continue;
        const store = allocStores[chosen[j]];
        alloc[store.id] = alloc[store.id] || {};
        alloc[store.id][sku.id] = (alloc[store.id][sku.id] || 0) + q;
        allocByWh[store.warehouse_id] = allocByWh[store.warehouse_id] || {};
        allocByWh[store.warehouse_id][sku.id] = (allocByWh[store.warehouse_id][sku.id] || 0) + q;
        whNameById[store.warehouse_id] = store.warehouse_name;
        allocTotal[sku.id] = (allocTotal[sku.id] || 0) + q;
        aloTotalQty += q;
        // 预测量（若有）作为 preQty 基线
        const preQ = (preQtyByStoreSku[store.id] && preQtyByStoreSku[store.id][sku.id]) || 0;
        items.push({
          allocation_id: aloId, pre_order_id: null,
          submitter_type: store.dealer_name === '总部' ? 'direct' : 'dealer',
          dealer_id: store.dealer_id, dealer_name: store.dealer_name,
          store_id: store.id, store_name: store.name,
          sku_id: sku.id, sku_code: sku.code, color: sku.color, size: sku.size,
          color_id: sku.colorId, size_id: sku.sizeId,
          pre_qty: String(preQ), allocated_qty: String(q),
          generated_doc_type: 'allocation', generated_doc_no: aloNo,
        });
      }
    }
    if (items.length === 0) continue;
    await ins('allocation_order', {
      id: aloId, allocation_no: aloNo, trade_show_id: showId, trade_show_name: showName,
      style_id: styleId, style_no: st.no, style_name: styleName,
      total_arrived_qty: String(aloTotalQty), total_allocated_qty: String(aloTotalQty),
      status: 'completed', remark: '订货会配货下发',
    });
    aloCount++;
    for (const it of items) { await ins('allocation_item', it); aliCount++; }
  }
  console.log(`      配货单 ${aloCount} / 配货明细 ${aliCount} 行`);

  // ----------------------------------------------------------- 门店零售（Q3 7–9 月）
  console.log('[8/8] 生成 Q3(7–9 月)门店零售单（库存自洽扣减）...');
  const retail = {}; // storeId -> skuId -> 已售
  const retailByWh = {}; // warehouseId -> skuId -> 已售（聚合）
  const storePlacements = {}; // storeId -> [{sku, qty, dealPrice}]
  let totalRetailUnits = 0;
  for (const store of allocStores) {
    const got = alloc[store.id] || {};
    const skuIds = Object.keys(got);
    if (skuIds.length === 0) continue;
    const unitsAtStore = skuIds.reduce((a, sid) => a + got[sid], 0);
    const target = Math.round(unitsAtStore * (0.6 + rng() * 0.3)); // 售出 60%–90%
    const pool = skuIds.map((sid) => ({ sid, cap: got[sid] }));
    let placed = 0;
    const placements = [];
    let guard = 0;
    while (placed < target && guard++ < 100000) {
      const avail = pool.filter((p) => p.cap > 0);
      if (avail.length === 0) break;
      // 按剩余容量加权抽取
      const sumCap = avail.reduce((a, p) => a + p.cap, 0);
      let r = rng() * sumCap, pick = avail[0];
      for (const p of avail) { r -= p.cap; if (r <= 0) { pick = p; break; } }
      const q = Math.min(rint(1, 3), pick.cap);
      pick.cap -= q; placed += q;
      const sku = skuById[pick.sid];
      const discount = 0.75 + rng() * 0.25; // 7.5–10 折
      const dealPrice = Math.round(sku.tag * discount);
      retail[store.id] = retail[store.id] || {};
      retail[store.id][pick.sid] = (retail[store.id][pick.sid] || 0) + q;
      retailByWh[store.warehouse_id] = retailByWh[store.warehouse_id] || {};
      retailByWh[store.warehouse_id][pick.sid] = (retailByWh[store.warehouse_id][pick.sid] || 0) + q;
      placements.push({ sku, qty: q, dealPrice, tagPrice: sku.tag });
    }
    storePlacements[store.id] = placements;
    totalRetailUnits += placed;
  }

  // 组装零售单：把每店 placements 切成 1–4 行的订单，sale_date 落在 2026-07-01~09-30
  const orderRows = [];
  const itemRows = [];
  const start = new Date('2026-07-01').getTime();
  const end = new Date('2026-09-30').getTime();
  let retailOrderNo = 0;
  for (const store of allocStores) {
    const placements = storePlacements[store.id] || [];
    if (placements.length === 0) continue;
    let i = 0;
    while (i < placements.length) {
      const cnt = rint(1, 4);
      const chunk = placements.slice(i, i + cnt);
      i += cnt;
      retailOrderNo++;
      const roId = crypto.randomUUID();
      const roNo = `AW26RT-${String(retailOrderNo).padStart(5, '0')}`;
      const saleDate = new Date(start + Math.floor(rng() * (end - start))).toISOString().slice(0, 10);
      let totalAmt = 0, tagAmt = 0, itemCount = 0;
      const method = rpick(PAY_METHODS);
      for (const p of chunk) {
        const lineAmt = p.dealPrice * p.qty;
        totalAmt += lineAmt; tagAmt += p.tagPrice * p.qty; itemCount += p.qty;
        itemRows.push({
          retail_id: roId, sku_id: p.sku.id, sku_code: p.sku.code,
          style_no: p.sku.styleNo, color: p.sku.color, size: p.sku.size,
          color_id: p.sku.colorId, size_id: p.sku.sizeId,
          quantity: String(p.qty), tag_price: String(p.tagPrice),
          deal_price: String(p.dealPrice),
          discount_rate: n2(p.dealPrice / p.tagPrice),
          line_amount: String(lineAmt),
        });
      }
      const discountAmt = Math.round(tagAmt - totalAmt);
      const memberId = rng() < 0.3 ? `AW26M${rint(1000, 9999)}` : null;
      orderRows.push({
        id: roId, retail_no: roNo, store_id: store.id, store_name: store.name,
        sale_date: saleDate, cashier_name: rpick(CASHIERS), member_id: memberId,
        source: 'store_pos',
        total_amount: n2(totalAmt), discount_amount: n2(discountAmt),
        receivable_amount: n2(totalAmt), received_amount: n2(totalAmt),
        change_amount: '0', pay_methods: [{ method, amount: n2(totalAmt) }],
        item_count: String(itemCount), status: 'completed',
        remark: 'Q3 门店零售',
      });
    }
  }
  await bulkInsert('retail_order', orderRows);
  await bulkInsert('retail_order_item', itemRows);
  console.log(`      零售单 ${orderRows.length} 张 / 零售明细 ${itemRows.length} 行 / 零售总件数 ${totalRetailUnits}`);

  // ----------------------------------------------------------- 库存快照（自洽，按仓库聚合）
  console.log('[9/9] 生成 inventory_stock 库存快照（中心仓 + 门店仓，按仓库聚合避免重复）...');
  const stockRows = [];
  // 中心仓：剩余 = 生产 − 配货总量（配货均发往门店仓）
  for (const sku of skuList) {
    const leftover = produced[sku.id] - (allocTotal[sku.id] || 0);
    if (leftover <= 0) continue;
    stockRows.push(stockRow(sku, CENTRAL_WH_ID, CENTRAL_WH_NAME, leftover, sku.cost));
  }
  // 门店仓：按 warehouse_id 聚合（多门店可共用一仓），剩余 = 配货 − 零售
  const storeWhIds = [...new Set(allocStores.map((s) => s.warehouse_id))];
  for (const whId of storeWhIds) {
    if (whId === CENTRAL_WH_ID) continue;
    const got = allocByWh[whId] || {};
    const sold = retailByWh[whId] || {};
    const whName = whNameById[whId] || whId;
    for (const sid of Object.keys(got)) {
      const leftover = got[sid] - (sold[sid] || 0);
      if (leftover <= 0) continue;
      stockRows.push(stockRow(skuById[sid], whId, whName, leftover, skuById[sid].cost));
    }
  }
  await bulkInsert('inventory_stock', stockRows);
  console.log(`      库存行 ${stockRows.length} 条（中心仓 ${stockRows.filter((r) => r.warehouse_id === CENTRAL_WH_ID).length} 款 / 门店仓 ${stockRows.length - stockRows.filter((r) => r.warehouse_id === CENTRAL_WH_ID).length} 行）`);

  // ----------------------------------------------------------- 自洽校验
  console.log('\n========== 数据自洽校验 ==========');
  let bad = 0;
  for (const sku of skuList) {
    const centralLeft = produced[sku.id] - (allocTotal[sku.id] || 0);
    if (centralLeft < 0) { console.log(`  ✗ 中心仓负库存 ${sku.code}: ${centralLeft}`); bad++; }
    for (const store of allocStores) {
      const g = (alloc[store.id] && alloc[store.id][sku.id]) || 0;
      const s = (retail[store.id] && retail[store.id][sku.id]) || 0;
      if (s > g) { console.log(`  ✗ 门店超卖 ${store.code} ${sku.code}: 售${s}>配${g}`); bad++; }
    }
  }
  console.log(bad === 0 ? '  ✓ 全部通过：中心仓余量≥0，门店无超卖' : `  ✗ 发现 ${bad} 处不一致`);
  console.log('==================================\n');
  console.log('种子数据写入完成。');
}

function stockRow(sku, whId, whName, qty, unitPrice) {
  return {
    sku_id: sku.id, sku_code: sku.code, style_no: sku.styleNo,
    color: sku.color, size: sku.size, color_id: sku.colorId, size_id: sku.sizeId,
    warehouse_id: whId, warehouse_name: whName,
    quantity: String(qty), in_transit_qty: '0',
    unit_price: String(unitPrice), amount: n2(qty * unitPrice),
  };
}

// 批量插入（postgres.js 对象数组形式：列名取自首个对象键）
async function bulkInsert(table, rows) {
  if (!rows.length) return;
  const CH = 300;
  for (let i = 0; i < rows.length; i += CH) {
    const ch = rows.slice(i, i + CH);
    await sql`INSERT INTO ${sql(table)} ${sql(ch)}`;
  }
}

main()
  .catch((e) => { console.error('种子脚本失败:', e); process.exitCode = 1; })
  .finally(() => { sql.end(); });
