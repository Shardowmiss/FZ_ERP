/**
 * 月结（month-close）多租户隔离回归 sim —— 路线 C（纯读时过滤，零迁移）
 *
 * 验证 GET /api/finance/month-close 下三个只读接口在三种安全态下行为正确：
 *   1) 超管 / 单租户放行态：scope 未配置（undefined） -> 返回全局存储汇总（改造前一致）
 *   2) 受限经销商态：scope.type==='dealer' 且 dealerIds=[D1] -> 仅可见 D1 仓库(W1)数据
 *   3) 已配置但无可见范围态：dealerIds=[] -> 明细空集、头汇总 0、应收应付 0（默认拒绝）
 *
 * 覆盖：list / getById 头汇总读时派生、getDetail 明细 viaWarehouse 过滤、
 *       应收经 receivable→customer→partner 反查、应付经 payable→supplier→partner 反查。
 *
 * 运行：node sim-month-close-scope.cjs   （需 dev/postgres 在 localhost:5434 运行）
 */
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq } = require('drizzle-orm');
const { randomUUID } = require('crypto');
const S = require('./dist/server/database/schema.js');
const { MonthCloseService } = require('./dist/server/modules/finance/month-close/month-close.service.js');
const { RequestContext } = require('./dist/server/common/context/request-context.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });
const service = new MonthCloseService(db);

let pass = 0;
let fail = 0;
const notes = [];
function assert(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

// 测试固定 id，便于精确清理
const D1 = randomUUID();
const W1 = randomUUID(); // 归属 D1
const W2 = randomUUID(); // 无经销商映射
const C1 = randomUUID(); // 客户，partner=D1
const C2 = randomUUID(); // 客户，partner=NULL
const S1 = randomUUID(); // 供应商，partner=D1
const S2 = randomUUID(); // 供应商，partner=NULL
const R1 = randomUUID();
const R2 = randomUUID();
const P1 = randomUUID();
const P2 = randomUUID();
const RP1 = randomUUID();
const RP2 = randomUUID();
const PP1 = randomUUID();
const PP2 = randomUUID();
const MC1 = randomUUID();
const TEST_MONTH = '2026-04';

async function seed() {
  // 经销商 + 仓库
  await db.insert(S.dealer).values({ id: D1, code: 'SIM-D1', name: 'SIM经销商D1', partnerType: 'branch' });
  await db.insert(S.warehouse).values([
    { id: W1, code: 'SIM-W1', name: 'SIM仓库W1', type: 'main', dealerId: D1 },
    { id: W2, code: 'SIM-W2', name: 'SIM仓库W2', type: 'main' }, // dealerId 缺省 NULL
  ]);

  // 库存流水：期初(2026-03, before 04-01) + 本期出入库(2026-04)
  // 注意：_created_at 是 lark-apaas 系统字段（DB 默认 CURRENT_TIMESTAMP，框架层会忽略应用层显式值），
  // 故用原始 SQL 显式写入过去时间戳，确保 close() 的期初/本期划分正确。
  const flows = [
    ['in', 'opening', 100, 10, W1, 'SIM仓库W1', '2026-03-15T10:00:00Z'],
    ['in', 'opening', 50, 10, W2, 'SIM仓库W2', '2026-03-15T10:00:00Z'],
    ['in', 'purchase', 30, 10, W1, 'SIM仓库W1', '2026-04-15T10:00:00Z'],
    ['in', 'purchase', 20, 10, W2, 'SIM仓库W2', '2026-04-15T10:00:00Z'],
    ['out', 'sale', 10, 10, W1, 'SIM仓库W1', '2026-04-20T10:00:00Z'],
    ['out', 'sale', 5, 10, W2, 'SIM仓库W2', '2026-04-20T10:00:00Z'],
  ];
  for (const [direction, flowType, qty, price, wh, whName, ca] of flows) {
    await client.unsafe(
      `INSERT INTO inventory_flow (id, flow_type, biz_no, direction, item_type, warehouse_id, warehouse_name, quantity, unit_price, style_no, _created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
      [randomUUID(), flowType, `SIM-${randomUUID().slice(0, 8)}`, direction, 'sku', wh, whName, String(qty), String(price), 'SIM-MC-STYLE', ca],
    );
  }

  // 客户 / 供应商（C1/S1 归属 D1，C2/S2 无映射）
  await db.insert(S.customer).values([
    { id: C1, code: 'SIM-C1', name: 'SIM客户C1', partnerId: D1 },
    { id: C2, code: 'SIM-C2', name: 'SIM客户C2' },
  ]);
  await db.insert(S.supplier).values([
    { id: S1, code: 'SIM-S1', name: 'SIM供应商S1', partnerId: D1 },
    { id: S2, code: 'SIM-S2', name: 'SIM供应商S2' },
  ]);

  // 应收 / 应付 + 4 月付款
  await db.insert(S.receivable).values([
    { id: R1, receivableNo: 'SIM-R1', customerId: C1, customerName: 'SIM客户C1', bizType: 'sale', bizNo: 'B1', amount: '1000', receivedAmount: '1000', balance: '0', status: 'paid' },
    { id: R2, receivableNo: 'SIM-R2', customerId: C2, customerName: 'SIM客户C2', bizType: 'sale', bizNo: 'B2', amount: '2000', receivedAmount: '2000', balance: '0', status: 'paid' },
  ]);
  await db.insert(S.payable).values([
    { id: P1, payableNo: 'SIM-P1', supplierId: S1, supplierName: 'SIM供应商S1', bizType: 'purchase', bizNo: 'B1', amount: '500', paidAmount: '500', balance: '0', status: 'paid' },
    { id: P2, payableNo: 'SIM-P2', supplierId: S2, supplierName: 'SIM供应商S2', bizType: 'purchase', bizNo: 'B2', amount: '800', paidAmount: '800', balance: '0', status: 'paid' },
  ]);
  await db.insert(S.receivablePayment).values([
    { id: RP1, receivableId: R1, paymentDate: '2026-04-15', amount: '1000', paymentMethod: 'bank' },
    { id: RP2, receivableId: R2, paymentDate: '2026-04-20', amount: '2000', paymentMethod: 'bank' },
  ]);
  await db.insert(S.payablePayment).values([
    { id: PP1, payableId: P1, paymentDate: '2026-04-10', amount: '500', paymentMethod: 'bank' },
    { id: PP2, payableId: P2, paymentDate: '2026-04-12', amount: '800', paymentMethod: 'bank' },
  ]);

  // 月结头（open），供 close() 执行
  await db.insert(S.monthClose).values({ id: MC1, month: TEST_MONTH, status: 'open' });
  // 执行月结（中央财务写，超管全局语义，不受作用域影响）
  await service.close(MC1, 'sim-user');
}

async function cleanup() {
  // 子表先于父表删除（显式 id，精确清理，避免误删生产数据）
  await db.delete(S.receivablePayment).where(eq(S.receivablePayment.id, RP1));
  await db.delete(S.receivablePayment).where(eq(S.receivablePayment.id, RP2));
  await db.delete(S.payablePayment).where(eq(S.payablePayment.id, PP1));
  await db.delete(S.payablePayment).where(eq(S.payablePayment.id, PP2));
  await db.delete(S.receivable).where(eq(S.receivable.id, R1));
  await db.delete(S.receivable).where(eq(S.receivable.id, R2));
  await db.delete(S.payable).where(eq(S.payable.id, P1));
  await db.delete(S.payable).where(eq(S.payable.id, P2));
  await db.delete(S.customer).where(eq(S.customer.id, C1));
  await db.delete(S.customer).where(eq(S.customer.id, C2));
  await db.delete(S.supplier).where(eq(S.supplier.id, S1));
  await db.delete(S.supplier).where(eq(S.supplier.id, S2));
  await db.delete(S.inventoryFlow).where(eq(S.inventoryFlow.warehouseId, W1));
  await db.delete(S.inventoryFlow).where(eq(S.inventoryFlow.warehouseId, W2));
  await db.delete(S.monthClose).where(eq(S.monthClose.id, MC1));
  await db.delete(S.warehouse).where(eq(S.warehouse.id, W1));
  await db.delete(S.warehouse).where(eq(S.warehouse.id, W2));
  await db.delete(S.dealer).where(eq(S.dealer.id, D1));
}

// 期望全局（超管）汇总
const GLOBAL = { opQ: 150, opA: 1500, inQ: 50, inA: 500, outQ: 15, outA: 150, clQ: 185, clA: 1850 };
// 期望受限（仅 W1）汇总
const W1ONLY = { opQ: 100, opA: 1000, inQ: 30, inA: 300, outQ: 10, outA: 100, clQ: 120, clA: 1200 };

function near(a, b, eps = 1e-6) { return Math.abs(Number(a) - b) < eps; }

async function run() {
  console.log('\n[Setup] 种子数据 + 执行月结 close()');
  await seed();
  console.log('  ✓ close() 完成，月结明细已生成');

  console.log('\n[视角 1] 超管 / 单租户放行（scope 未配置 -> 全局存储汇总）');
  // 无 RequestContext -> getDealerScope() 返回 undefined -> 全量
  const adminDetail = await service.getDetail(MC1);
  const adminById = await service.getById(MC1);
  const adminList = await service.list();
  const adminRow = adminList.find((r) => r.id === MC1);
  const adminWhs = [...new Set(adminDetail.opening.concat(adminDetail.inboundByType, adminDetail.outboundByType, adminDetail.closing).map((d) => d.warehouseId))];
  assert('明细包含 W1 与 W2（跨租户对超管可见）', adminWhs.includes(W1) && adminWhs.includes(W2), adminWhs);
  assert('头 openingQty == 全局 150', near(adminById.openingQty, GLOBAL.opQ), adminById.openingQty);
  assert('头 closingQty == 全局 185', near(adminById.closingQty, GLOBAL.clQ), adminById.closingQty);
  assert('list 行 openingQty == 全局 150', near(adminRow.openingQty, GLOBAL.opQ), adminRow.openingQty);
  assert('应收发生额 == 全月 3000（R1+R2）', near(adminDetail.receivableAmount, 3000), adminDetail.receivableAmount);
  assert('应付发生额 == 全月 1300（P1+P2）', near(adminDetail.payableAmount, 1300), adminDetail.payableAmount);

  console.log('\n[视角 2] 受限经销商（dealerIds=[D1] -> 仅 W1）');
  const dScope = { type: 'dealer', dealerIds: [D1] };
  const resDetail = await RequestContext.run({ dealerScope: dScope }, () => service.getDetail(MC1));
  const resById = await RequestContext.run({ dealerScope: dScope }, () => service.getById(MC1));
  const resList = await RequestContext.run({ dealerScope: dScope }, () => service.list());
  const resRow = resList.find((r) => r.id === MC1);
  const resWhs = [...new Set(resDetail.opening.concat(resDetail.inboundByType, resDetail.outboundByType, resDetail.closing).map((d) => d.warehouseId))];
  assert('明细仅含 W1（W2 被 viaWarehouse 过滤）', resWhs.length === 1 && resWhs[0] === W1, resWhs);
  assert('明细不含 W2（无跨租户泄漏）', !resWhs.includes(W2), resWhs);
  assert('头 openingQty == 120? 仅 W1=100', near(resById.openingQty, W1ONLY.opQ), resById.openingQty);
  assert('头 closingQty == W1=120', near(resById.closingQty, W1ONLY.clQ), resById.closingQty);
  assert('list 行 openingQty == W1=100（派生≠全局150）', near(resRow.openingQty, W1ONLY.opQ), resRow.openingQty);
  assert('应收发生额 == 仅 D1 客户 1000', near(resDetail.receivableAmount, 1000), resDetail.receivableAmount);
  assert('应付发生额 == 仅 D1 供应商 500', near(resDetail.payableAmount, 500), resDetail.payableAmount);
  // 派生一致性：头 openingQty == 明细 opening 之和
  const detailOpenSum = resDetail.opening.reduce((s, d) => s + d.qty, 0);
  assert('头 openingQty == 明细 opening 之和', near(resById.openingQty, detailOpenSum), { head: resById.openingQty, sum: detailOpenSum });

  console.log('\n[视角 3] 已配置但无可见范围（dealerIds=[] -> 默认拒绝，全 0）');
  const emptyScope = { type: 'dealer', dealerIds: [] };
  const emptyDetail = await RequestContext.run({ dealerScope: emptyScope }, () => service.getDetail(MC1));
  const emptyById = await RequestContext.run({ dealerScope: emptyScope }, () => service.getById(MC1));
  assert('明细空集（1=0 过滤）', emptyDetail.opening.length === 0 && emptyDetail.inboundByType.length === 0 && emptyDetail.outboundByType.length === 0 && emptyDetail.closing.length === 0, emptyDetail);
  assert('头汇总全 0', near(emptyById.openingQty, 0) && near(emptyById.closingQty, 0) && near(emptyById.inboundAmount, 0), emptyById);
  assert('应收发生额 == 0', near(emptyDetail.receivableAmount, 0), emptyDetail.receivableAmount);
  assert('应付发生额 == 0', near(emptyDetail.payableAmount, 0), emptyDetail.payableAmount);

  console.log('\n[视角 4] 关闭后 close() 仍返回全局存储值（写语义不变）');
  const afterClose = await service.getById(MC1);
  assert('close 后头 openingQty == 全局 150（不受作用域影响）', near(afterClose.openingQty, GLOBAL.opQ), afterClose.openingQty);
}

run()
  .then(async () => {
    console.log('\n[Cleanup] 清理种子数据');
    await cleanup();
  })
  .catch(async (e) => {
    console.error('\n!! sim 运行异常：', e);
    try { await cleanup(); } catch (_) {}
    fail++;
  })
  .finally(async () => {
    await client.end();
    console.log(`\n==== 结果：pass=${pass} fail=${fail} ====`);
    process.exit(fail === 0 ? 0 : 1);
  });
