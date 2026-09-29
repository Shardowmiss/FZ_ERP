/**
 * 数据隔离（多租户经销商作用域）回归 sim
 *
 * 验证零侵入经销商隔离逻辑 buildDealerScopeCondition 在三种安全态下行为正确：
 *   1) 超管 / 单租户放行态：scope.type==='all' -> 不加任何过滤（全量可见）
 *   2) 受限用户态：scope.type==='dealer' 且 dealerIds 非空 -> 仅可见所属经销商数据（IN 子查询反查）
 *   3) 已配置但无可见范围态：dealerIds 为空 -> 返回 1=0（拒绝，查不到任何跨租户数据）
 *
 * 并用真实数据库验证「作用域 SQL 在物理层面确实只返回本经销商数据，无跨租户泄漏」。
 *
 * 运行：node sim-data-scope.cjs   （需 dev/postgres 在 localhost:5434 运行）
 */
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql, eq, and } = require('drizzle-orm');
const { buildDealerScopeCondition } = require('./dist/server/common/data-scope/dealer-scope.js');
const S = require('./dist/server/database/schema.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });

let pass = 0;
let fail = 0;
const notes = [];
function assert(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  \u2713', name);
  } else {
    fail++;
    console.log('  \u2717 FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

/** 抽取 WHERE 后的谓词片段（用真实 drizzle postgres-js 方言渲染），便于嵌入手写 count 查询。 */
function predicate(cond, table) {
  const q = db.select({ one: sql`1` }).from(table).where(cond).toSQL();
  const idx = q.sql.toLowerCase().indexOf(' where ');
  return { sql: idx >= 0 ? q.sql.slice(idx + 7) : '1=1', params: q.params };
}

/** 手写 count(*) 查询（显式别名 c，规避 drizzle 对原始 sql 表达式丢弃列别名的问题）。 */
async function countWhere(tableName, pred, params) {
  const rows = await client.unsafe(`SELECT count(*)::int AS c FROM ${tableName} WHERE ${pred.sql}`, params);
  return rows[0].c;
}

async function run() {
  // ============ Part A：安全决策规则 + SQL 形状（不依赖数据） ============
  console.log('\n[Part A] 决策规则与隔离 SQL 形状');
  const allScope = { type: 'all', dealerIds: [] };
  const scopedScope = { type: 'dealer', dealerIds: ['DEALER-X'] };
  const rejectScope = { type: 'dealer', dealerIds: [] };

  const allCond = buildDealerScopeCondition(allScope, { kind: 'viaWarehouse', column: S.inventoryStock.warehouseId });
  assert('scope=all -> 返回 undefined（不加过滤）', allCond === undefined, allCond);

  const rejCond = buildDealerScopeCondition(rejectScope, { kind: 'viaWarehouse', column: S.inventoryStock.warehouseId });
  assert('scope=dealer 且 dealerIds=[] -> 拒绝（1=0）', rejCond != null && predicate(rejCond, S.inventoryStock).sql.replace(/\s+/g, ' ').trim() === '1=0', predicate(rejCond, S.inventoryStock).sql);

  const vw = predicate(buildDealerScopeCondition(scopedScope, { kind: 'viaWarehouse', column: S.inventoryStock.warehouseId }), S.inventoryStock);
  assert('viaWarehouse 引用 warehouse + dealer_id + IN 子查询', /FROM\s+"?warehouse"?/i.test(vw.sql) && /"dealer_id"/.test(vw.sql) && /IN/.test(vw.sql), vw.sql);
  assert('viaWarehouse 参数 = 经销商 id', vw.params.length === 1 && vw.params[0] === 'DEALER-X', vw.params);

  const vc = predicate(buildDealerScopeCondition(scopedScope, { kind: 'viaCustomer', column: S.salesOrder.customerId }), S.salesOrder);
  assert('viaCustomer 引用 customer + partner_id', /FROM\s+"?customer"?/i.test(vc.sql) && /"partner_id"/.test(vc.sql), vc.sql);

  const vs = predicate(buildDealerScopeCondition(scopedScope, { kind: 'viaSupplier', column: S.purchaseOrder.supplierId }), S.purchaseOrder);
  assert('viaSupplier 引用 supplier + partner_id', /FROM\s+"?supplier"?/i.test(vs.sql) && /"partner_id"/.test(vs.sql), vs.sql);

  const ve = predicate(buildDealerScopeCondition(scopedScope, { kind: 'viaWarehouseEither', from: S.inventoryTransfer.fromWarehouseId, to: S.inventoryTransfer.toWarehouseId }), S.inventoryTransfer);
  const whCount = (ve.sql.match(/FROM\s+"?warehouse"?/gi) || []).length;
  assert('viaWarehouseEither 含 OR 与两个 warehouse 子查询', /OR/i.test(ve.sql) && whCount === 2, { whCount, sql: ve.sql });

  const dc = predicate(buildDealerScopeCondition(scopedScope, { kind: 'dealerColumn', column: S.warehouse.dealerId }), S.warehouse);
  assert('dealerColumn 直接列 IN (...)', /IN\s*\(/.test(dc.sql) && dc.params[0] === 'DEALER-X', dc.sql);

  // ============ Part B：真实数据库强制校验（物理隔离） ============
  console.log('\n[Part B] 真实数据库强制校验（物理隔离）');

  const totalSO = (await client`SELECT count(*)::int AS c FROM sales_order`)[0].c;
  const totalInv = (await client`SELECT count(*)::int AS c FROM inventory_stock`)[0].c;
  const totalTr = (await client`SELECT count(*)::int AS c FROM inventory_transfer`)[0].c;
  assert('sales_order 有数据（主用例）', totalSO > 0, totalSO);

  // B1 超管全量 == total（用 predicate 的 1=1）
  const allPred = predicate(allCond, S.salesOrder);
  const allCount = await countWhere('sales_order', allPred, allPred.params);
  assert('超管/全量态 count == total(sales_order)', allCount === totalSO, { allCount, totalSO });

  // 选库存最多的经销商 D1（用于 inventory_stock，数据稀疏）
  const invDealers = await client`SELECT w.dealer_id AS d, count(*)::int AS c FROM inventory_stock s JOIN warehouse w ON w.id = s.warehouse_id GROUP BY w.dealer_id ORDER BY c DESC LIMIT 1`;
  const D1 = invDealers[0] ? invDealers[0].d : null;

  // 选销售单最多的经销商 DC（主用例，数据充分）
  const soDealers = await client`SELECT c.partner_id AS d, count(*)::int AS c FROM sales_order so JOIN customer c ON c.id = so.customer_id GROUP BY c.partner_id ORDER BY c DESC LIMIT 1`;
  const DC = soDealers[0] ? soDealers[0].d : null;
  console.log('  经销商 D1(库存)=', D1, ' DC(销售单)=', DC);

  // B2 受限[DC] viaCustomer 仅见本经销商客户销售单
  if (DC) {
    const condC = buildDealerScopeCondition({ type: 'dealer', dealerIds: [DC] }, { kind: 'viaCustomer', column: S.salesOrder.customerId });
    const predC = predicate(condC, S.salesOrder);
    const scopedC = await countWhere('sales_order', predC, predC.params);
    const expC = (await client.unsafe(`SELECT count(*)::int AS c FROM sales_order so JOIN customer c ON c.id = so.customer_id WHERE c.partner_id = $1`, [DC]))[0].c;
    assert('受限[DC] 销售单 count == customer.partner_id=DC 的 join 数', scopedC === expC, { scopedC, expC });
    assert('受限[DC] 实际过滤到子集（count < total）', scopedC < totalSO, { scopedC, totalSO });
    // 命中的经销商集合恰好 == [DC]
    const ds = await client.unsafe(`SELECT DISTINCT c.partner_id AS d FROM sales_order JOIN customer c ON c.id = sales_order.customer_id WHERE ${predC.sql}`, predC.params);
    const dealers = ds.map((r) => r.d).sort();
    assert('受限[DC] 命中的经销商集合 == [DC]（无跨租户泄漏）', dealers.length === 1 && dealers[0] === DC, dealers);
  } else {
    notes.push('sales_order 无按经销商分布的客户数据，viaCustomer 物理校验跳过');
  }

  // B3 inventory_stock 受限[D1]（数据稀疏，仅校验形态：== expected 且拒绝态=0）
  if (D1) {
    const condI = buildDealerScopeCondition({ type: 'dealer', dealerIds: [D1] }, { kind: 'viaWarehouse', column: S.inventoryStock.warehouseId });
    const predI = predicate(condI, S.inventoryStock);
    const scopedI = await countWhere('inventory_stock', predI, predI.params);
    const expI = (await client.unsafe(`SELECT count(*)::int AS c FROM inventory_stock s JOIN warehouse w ON w.id = s.warehouse_id WHERE w.dealer_id = $1`, [D1]))[0].c;
    assert('受限[D1] 库存 count == warehouse.dealer_id=D1 的 join 数', scopedI === expI, { scopedI, expI });
  }

  // B4 拒绝态（已配置无范围）-> 空集（对 sales_order 验证，数据充分）
  const rejPred = predicate(buildDealerScopeCondition({ type: 'dealer', dealerIds: [] }, { kind: 'viaCustomer', column: S.salesOrder.customerId }), S.salesOrder);
  const rejCount = await countWhere('sales_order', rejPred, rejPred.params);
  assert('拒绝态(已配置无范围) count == 0', rejCount === 0, rejCount);

  // B5 inventory_transfer 受限[DT] viaWarehouseEither（任一端仓库归属该经销商即可见）
  if (totalTr > 0) {
    const trTop = await client`SELECT w.dealer_id AS d, count(*)::int AS c FROM inventory_transfer t JOIN warehouse w ON w.id = t.from_warehouse_id OR w.id = t.to_warehouse_id GROUP BY w.dealer_id ORDER BY c DESC LIMIT 1`;
    const DT = trTop[0] ? trTop[0].d : null;
    if (DT) {
      const condT = buildDealerScopeCondition({ type: 'dealer', dealerIds: [DT] }, { kind: 'viaWarehouseEither', from: S.inventoryTransfer.fromWarehouseId, to: S.inventoryTransfer.toWarehouseId });
      const predT = predicate(condT, S.inventoryTransfer);
      const scopedT = await countWhere('inventory_transfer', predT, predT.params);
      const expT = (await client.unsafe(`SELECT count(*)::int AS c FROM inventory_transfer t WHERE EXISTS (SELECT 1 FROM warehouse w WHERE w.id IN (t.from_warehouse_id, t.to_warehouse_id) AND w.dealer_id = $1)`, [DT]))[0].c;
      assert('受限[DT] 调拨单 count == EXISTS(任一端仓库.dealer_id=DT)', scopedT === expT, { scopedT, expT });
      assert('受限[DT] 实际过滤到子集（count < total）', scopedT < totalTr, { scopedT, totalTr });
    } else {
      notes.push('inventory_transfer 引用的仓库在 dev 数据中 dealer_id 均为 NULL（共 5 个无主仓库），无法按经销商分组，viaWarehouseEither 物理校验跳过；其 SQL 形状已在 Part A 覆盖');
    }
  }

  // ============ Part C：主数据列表端点的租户隔离（物理校验） ============
  console.log('\n[Part C] 主数据列表端点租户隔离（customer/supplier/warehouse/store/dealer）');
  const mdCases = [
    { name: 'customer', table: 'customer', path: { kind: 'viaCustomer', column: S.customer.id }, ownerCol: 'partner_id' },
    { name: 'supplier', table: 'supplier', path: { kind: 'viaSupplier', column: S.supplier.id }, ownerCol: 'partner_id' },
    { name: 'warehouse', table: 'warehouse', path: { kind: 'dealerColumn', column: S.warehouse.dealerId }, ownerCol: 'dealer_id' },
    { name: 'store', table: 'store', path: { kind: 'dealerColumn', column: S.store.dealerId }, ownerCol: 'dealer_id' },
    { name: 'dealer', table: 'dealer', path: { kind: 'dealerColumn', column: S.dealer.id }, ownerCol: 'id' },
  ];
  for (const c of mdCases) {
    const tblObj =
      c.name === 'customer' ? S.customer :
      c.name === 'supplier' ? S.supplier :
      c.name === 'warehouse' ? S.warehouse :
      c.name === 'store' ? S.store : S.dealer;
    const rows = await client.unsafe(`SELECT ${c.ownerCol} AS d, count(*)::int AS c FROM ${c.table} WHERE ${c.ownerCol} IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 1`);
    const top = rows[0] ? rows[0].d : null;
    if (!top) { notes.push(`${c.table} 无按经销商分布的行数据，主数据隔离物理校验跳过`); continue; }
    const cond = buildDealerScopeCondition({ type: 'dealer', dealerIds: [top] }, c.path);
    const pred = predicate(cond, tblObj);
    const scopedCount = await countWhere(c.table, pred, pred.params);
    const exp = (await client.unsafe(`SELECT count(*)::int AS c FROM ${c.table} WHERE ${c.ownerCol} = $1`, [top]))[0].c;
    assert(`受限[${top}] ${c.table} 列表 count == 本经销商直接查询数`, scopedCount === exp, { scopedCount, exp });
    const owners = await client.unsafe(`SELECT DISTINCT ${c.ownerCol} AS d FROM ${c.table} WHERE ${pred.sql}`, pred.params);
    const ownerSet = owners.map((r) => r.d).sort();
    assert(`受限[${top}] ${c.table} 命中经销商集合 == [${top}]（无跨租户泄漏）`, ownerSet.length === 1 && ownerSet[0] === top, ownerSet);
    const rejP = predicate(buildDealerScopeCondition({ type: 'dealer', dealerIds: [] }, c.path), tblObj);
    const rejC = await countWhere(c.table, rejP, rejP.params);
    assert(`拒绝态 ${c.table} 列表 count == 0`, rejC === 0, rejC);
  }

  // ============ Part D：写操作 IDOR 防护（按 id 越权写被拦截为 NotFound） ============
  console.log('\n[Part D] 写操作 IDOR 防护（调拨单 / 盘点单 的 approve/receive/accept/void/delete）');
  const anyTransfer = await client`SELECT id FROM inventory_transfer LIMIT 1`;
  const aWh = await client`SELECT id, dealer_id FROM warehouse WHERE dealer_id IS NOT NULL LIMIT 1`;
  if (anyTransfer[0] && aWh[0]) {
    const T = anyTransfer[0].id;
    const Dx = aWh[0].dealer_id;
    // 超管态：应能命中目标单据（可操作）
    const allGuardT = and(
      eq(S.inventoryTransfer.id, T),
      buildDealerScopeCondition(allScope, { kind: 'viaWarehouseEither', from: S.inventoryTransfer.fromWarehouseId, to: S.inventoryTransfer.toWarehouseId }),
    );
    const allPredT = predicate(allGuardT, S.inventoryTransfer);
    const allHitT = await countWhere('inventory_transfer', allPredT, allPredT.params);
    assert('写防护：超管态可命中目标调拨单（可操作）', allHitT === 1, allHitT);
    // 受限态（指向其它经销商）：命中 0 行 -> 等同 NotFound -> 越权写被拦截
    const scopedGuardT = and(
      eq(S.inventoryTransfer.id, T),
      buildDealerScopeCondition({ type: 'dealer', dealerIds: [Dx] }, { kind: 'viaWarehouseEither', from: S.inventoryTransfer.fromWarehouseId, to: S.inventoryTransfer.toWarehouseId }),
    );
    const scopedPredT = predicate(scopedGuardT, S.inventoryTransfer);
    const scopedHitT = await countWhere('inventory_transfer', scopedPredT, scopedPredT.params);
    assert('写防护：受限态(其它经销商) 命中 0 行 -> 越权写被拦截(NotFound)', scopedHitT === 0, scopedHitT);
    // 自有调拨单（其仓库归属 Dx）应可命中
    const ownT = await client.unsafe(`SELECT t.id AS id FROM inventory_transfer t JOIN warehouse w ON w.id = t.from_warehouse_id OR w.id = t.to_warehouse_id WHERE w.dealer_id = $1 LIMIT 1`, [Dx]);
    if (ownT[0]) {
      const Ty = ownT[0].id;
      const g = and(eq(S.inventoryTransfer.id, Ty), buildDealerScopeCondition({ type: 'dealer', dealerIds: [Dx] }, { kind: 'viaWarehouseEither', from: S.inventoryTransfer.fromWarehouseId, to: S.inventoryTransfer.toWarehouseId }));
      const p = predicate(g, S.inventoryTransfer);
      const hit = await countWhere('inventory_transfer', p, p.params);
      assert('写防护：受限态(本经销商) 可命中自有调拨单（可操作）', hit === 1, hit);
    }
  } else {
    notes.push('dev 数据缺少调拨单或带经销商仓库，写防护(transfer)物理校验跳过；SQL 形状已在 Part A 覆盖');
  }

  const anyStocktake = await client`SELECT id FROM inventory_stocktake LIMIT 1`;
  if (anyStocktake[0] && aWh[0]) {
    const ST = anyStocktake[0].id;
    const Dx = aWh[0].dealer_id;
    const allGuardS = and(
      eq(S.inventoryStocktake.id, ST),
      buildDealerScopeCondition(allScope, { kind: 'viaWarehouse', column: S.inventoryStocktake.warehouseId }),
    );
    const allPredS = predicate(allGuardS, S.inventoryStocktake);
    const allHitS = await countWhere('inventory_stocktake', allPredS, allPredS.params);
    assert('写防护：超管态可命中目标盘点单（可操作）', allHitS === 1, allHitS);
    const scopedGuardS = and(
      eq(S.inventoryStocktake.id, ST),
      buildDealerScopeCondition({ type: 'dealer', dealerIds: [Dx] }, { kind: 'viaWarehouse', column: S.inventoryStocktake.warehouseId }),
    );
    const scopedPredS = predicate(scopedGuardS, S.inventoryStocktake);
    const scopedHitS = await countWhere('inventory_stocktake', scopedPredS, scopedPredS.params);
    assert('写防护：受限态(其它经销商) 命中 0 行 -> 越权写被拦截(NotFound)', scopedHitS === 0, scopedHitS);
  } else {
    notes.push('dev 数据缺少盘点单或带经销商仓库，写防护(stocktake)物理校验跳过；SQL 形状已在 Part A 覆盖');
  }

  // ============ Part E：本轮新增 IDOR 防护（base 详情 / 销售·采购写 按 id）物理校验 ============
  console.log('\n[Part E] base 详情 + 销售/采购写 按 id 的跨租户拦截（and(eq(id), scope) 命中 0 == NotFound）');

  // E1 采购订单 viaSupplier 物理校验（镜像 B2）
  const poDealers = await client`SELECT s.partner_id AS d, count(*)::int AS c FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id GROUP BY s.partner_id ORDER BY c DESC LIMIT 1`;
  const DP = poDealers[0] ? poDealers[0].d : null;
  if (DP) {
    const condP = buildDealerScopeCondition({ type: 'dealer', dealerIds: [DP] }, { kind: 'viaSupplier', column: S.purchaseOrder.supplierId });
    const predP = predicate(condP, S.purchaseOrder);
    const scopedP = await countWhere('purchase_order', predP, predP.params);
    const expP = (await client.unsafe(`SELECT count(*)::int AS c FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id WHERE s.partner_id = $1`, [DP]))[0].c;
    assert('受限[DP] 采购单 count == supplier.partner_id=DP 的 join 数', scopedP === expP, { scopedP, expP });
    const dealersP = await client.unsafe(`SELECT DISTINCT s.partner_id AS d FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id WHERE ${predP.sql}`, predP.params);
    const setP = dealersP.map((r) => r.d).sort();
    assert('受限[DP] 采购单命中经销商集合 == [DP]（无跨租户泄漏）', setP.length === 1 && setP[0] === DP, setP);
  } else {
    notes.push('purchase_order 无按经销商分布的供应商数据，viaSupplier 物理校验跳过');
  }

  // E2 销售订单：跨租户 id 在 scope[DC] 下命中 0（模拟 detail/voidDoc/delete/audit 的 and(eq(id), scope)）
  if (DC) {
    const otherSO = await client.unsafe(`SELECT so.id AS id FROM sales_order so JOIN customer c ON c.id = so.customer_id WHERE c.partner_id <> $1 LIMIT 1`, [DC]);
    const ownSO = await client.unsafe(`SELECT so.id AS id FROM sales_order so JOIN customer c ON c.id = so.customer_id WHERE c.partner_id = $1 LIMIT 1`, [DC]);
    const crossId = otherSO[0] ? otherSO[0].id : null;
    const ownId = ownSO[0] ? ownSO[0].id : null;
    if (crossId) {
      const g = and(eq(S.salesOrder.id, crossId), buildDealerScopeCondition({ type: 'dealer', dealerIds: [DC] }, { kind: 'viaCustomer', column: S.salesOrder.customerId }));
      const p = predicate(g, S.salesOrder);
      const hit = await countWhere('sales_order', p, p.params);
      assert('销售订单：跨租户 id 在 scope[DC] 下命中 0 -> 详情/写被拦截(NotFound)', hit === 0, hit);
    }
    if (ownId) {
      const g = and(eq(S.salesOrder.id, ownId), buildDealerScopeCondition({ type: 'dealer', dealerIds: [DC] }, { kind: 'viaCustomer', column: S.salesOrder.customerId }));
      const p = predicate(g, S.salesOrder);
      const hit = await countWhere('sales_order', p, p.params);
      assert('销售订单：本租户 id 在 scope[DC] 下命中 1 -> 可操作', hit === 1, hit);
    }
  }

  // E3 采购订单：跨租户 id 在 scope[DP] 下命中 0
  if (DP) {
    const otherPO = await client.unsafe(`SELECT po.id AS id FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id WHERE s.partner_id <> $1 LIMIT 1`, [DP]);
    const ownPO = await client.unsafe(`SELECT po.id AS id FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id WHERE s.partner_id = $1 LIMIT 1`, [DP]);
    const crossId = otherPO[0] ? otherPO[0].id : null;
    const ownId = ownPO[0] ? ownPO[0].id : null;
    if (crossId) {
      const g = and(eq(S.purchaseOrder.id, crossId), buildDealerScopeCondition({ type: 'dealer', dealerIds: [DP] }, { kind: 'viaSupplier', column: S.purchaseOrder.supplierId }));
      const p = predicate(g, S.purchaseOrder);
      const hit = await countWhere('purchase_order', p, p.params);
      assert('采购订单：跨租户 id 在 scope[DP] 下命中 0 -> 详情/写被拦截(NotFound)', hit === 0, hit);
    }
    if (ownId) {
      const g = and(eq(S.purchaseOrder.id, ownId), buildDealerScopeCondition({ type: 'dealer', dealerIds: [DP] }, { kind: 'viaSupplier', column: S.purchaseOrder.supplierId }));
      const p = predicate(g, S.purchaseOrder);
      const hit = await countWhere('purchase_order', p, p.params);
      assert('采购订单：本租户 id 在 scope[DP] 下命中 1 -> 可操作', hit === 1, hit);
    }
  }

  // E4 base 详情：跨租户 customer/warehouse id 在 scope 下命中 0
  const custTop = await client`SELECT partner_id AS d, count(*)::int AS c FROM customer WHERE partner_id IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 1`;
  if (custTop[0]) {
    const CX = custTop[0].d;
    const otherC = await client.unsafe(`SELECT id FROM customer WHERE partner_id <> $1 LIMIT 1`, [CX]);
    const ownC = await client.unsafe(`SELECT id FROM customer WHERE partner_id = $1 LIMIT 1`, [CX]);
    if (otherC[0]) {
      const g = and(eq(S.customer.id, otherC[0].id), buildDealerScopeCondition({ type: 'dealer', dealerIds: [CX] }, { kind: 'viaCustomer', column: S.customer.id }));
      const p = predicate(g, S.customer);
      const hit = await countWhere('customer', p, p.params);
      assert('customer 详情：跨租户 id 在 scope[CX] 下命中 0 -> 拦截(NotFound)', hit === 0, hit);
    }
    if (ownC[0]) {
      const g = and(eq(S.customer.id, ownC[0].id), buildDealerScopeCondition({ type: 'dealer', dealerIds: [CX] }, { kind: 'viaCustomer', column: S.customer.id }));
      const p = predicate(g, S.customer);
      const hit = await countWhere('customer', p, p.params);
      assert('customer 详情：本租户 id 在 scope[CX] 下命中 1 -> 可操作', hit === 1, hit);
    }
  }
  if (D1) {
    const otherW = await client.unsafe(`SELECT id FROM warehouse WHERE dealer_id <> $1 LIMIT 1`, [D1]);
    const ownW = await client.unsafe(`SELECT id FROM warehouse WHERE dealer_id = $1 LIMIT 1`, [D1]);
    if (otherW[0]) {
      const g = and(eq(S.warehouse.id, otherW[0].id), buildDealerScopeCondition({ type: 'dealer', dealerIds: [D1] }, { kind: 'dealerColumn', column: S.warehouse.dealerId }));
      const p = predicate(g, S.warehouse);
      const hit = await countWhere('warehouse', p, p.params);
      assert('warehouse 详情：跨租户 id 在 scope[D1] 下命中 0 -> 拦截(NotFound)', hit === 0, hit);
    }
    if (ownW[0]) {
      const g = and(eq(S.warehouse.id, ownW[0].id), buildDealerScopeCondition({ type: 'dealer', dealerIds: [D1] }, { kind: 'dealerColumn', column: S.warehouse.dealerId }));
      const p = predicate(g, S.warehouse);
      const hit = await countWhere('warehouse', p, p.params);
      assert('warehouse 详情：本租户 id 在 scope[D1] 下命中 1 -> 可操作', hit === 1, hit);
    }
  }

  // ============ Part F：经销商作用域兜底语义对齐（缺陷 #6 验证） ============
  console.log('\n[Part F] 经销商作用域兜底对齐（单租户放行 / 多租户默认拒绝）');
  // 业务库内唯一用户 admin 已被分配 super_admin（命中规则 1 全量），无法验证规则 3（完全未配置）。
  // 故创建临时“完全未配置”用户（无角色、无门店映射）专门用于验证，结束后清理。
  const tmpUser = 'sim_unconfig_tmp_' + Date.now();
  await client.unsafe(
    `INSERT INTO rbac_user (username, name, password_hash, status)
     VALUES ($1, 'sim-tmp', 'x', 'active')
     ON CONFLICT (username) DO NOTHING`,
    [tmpUser],
  );
  const tmpRow = await client.unsafe('SELECT id FROM rbac_user WHERE username = $1', [tmpUser]);
  const tmpId = tmpRow[0] ? tmpRow[0].id : null;
  if (tmpId) {
    const { RbacService } = require('./dist/server/modules/rbac/rbac.service.js');
    try {
      // 直接调用 resolveDealerScope（绕过 getUserDealerScope 的 60s 缓存），确保两种环境各自实时解析
      // F1 单租户（默认，ERP_MULTI_TENANT 未设）：规则 3 -> 全量可见（向后兼容演示/初始化）
      delete process.env.ERP_MULTI_TENANT;
      const rbacST = new RbacService(db);
      const scopeST = await rbacST.resolveDealerScope(tmpId);
      assert('单租户模式：完全未配置用户 -> {type:all}（放行，兼容演示）', scopeST.type === 'all' && scopeST.dealerIds.length === 0, scopeST);

      // F2 多租户（ERP_MULTI_TENANT=true）：规则 3 -> 默认拒绝（与 store 维度 1=0 兜底一致，P0-6 修正）
      process.env.ERP_MULTI_TENANT = 'true';
      const rbacMT = new RbacService(db);
      const scopeMT = await rbacMT.resolveDealerScope(tmpId);
      assert('多租户模式：完全未配置用户 -> {type:dealer, dealerIds:[]}（默认拒绝）', scopeMT.type === 'dealer' && scopeMT.dealerIds.length === 0, scopeMT);

      delete process.env.ERP_MULTI_TENANT;
    } finally {
      await client.unsafe('DELETE FROM rbac_user WHERE id = $1', [tmpId]);
    }
  } else {
    notes.push('临时未配置用户创建失败，Part F 兜底语义物理校验跳过');
  }

  // ============ 收尾 ============
  await client.end();
  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  if (notes.length) {
    console.log('备注：');
    notes.forEach((n) => console.log('  -', n));
  }
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('SIM 运行异常：', e);
  try { client.end(); } catch {}
  process.exit(2);
});
