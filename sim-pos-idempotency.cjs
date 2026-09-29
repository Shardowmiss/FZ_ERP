// 验证 POS 收银幂等：同一 idempotencyKey 的重复/并发结算，内层业务（settle）只执行一次。
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { PosService } = require('./dist/server/modules/pos/pos.service.js');

const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(URL);
const db = drizzle(client);

let settleCount = 0;
let draftCount = 0;

const rbac = { getUserDataScope: async () => ({ type: 'all' }) };
const pricing = {
  quote: async (q) => ({
    items: q.items.map((i) => ({ skuId: i.skuId || 'x', quantity: i.quantity, finalPrice: 100, tagPrice: 120 })),
    discountAmount: 0,
    subtotal: 100 * q.items.length,
  }),
};
const retail = {
  createDraftRetail: async () => {
    draftCount += 1;
    return { id: 'draft-' + draftCount };
  },
  settleRetailOrder: async () => {
    settleCount += 1;
    return { orderId: 'RO-' + settleCount, settled: true, ts: Date.now() };
  },
};
const money = { round2: (x) => Math.round(x * 100) / 100 };

const svc = new PosService(db, rbac, retail, pricing, money);

const storeId = '86fc6904-4ab9-485f-9862-73ec1c0a0809';
const baseDto = {
  storeId,
  items: [{ skuCode: 'ST-SPRING-红-S', quantity: 2 }],
  cashierName: 'tester',
  payMethods: [{ method: 'cash', amount: 200 }],
  receivedAmount: 200,
};

(async () => {
  let failures = 0;

  // 1) 顺序重复：相同 key 调两次
  const k1 = 'SIM-SEQ-' + Date.now();
  const r1 = await svc.checkout({ ...baseDto, idempotencyKey: k1 }, 'u1');
  const r2 = await svc.checkout({ ...baseDto, idempotencyKey: k1 }, 'u1');
  const seqSettle = settleCount;
  const seqDraft = draftCount;
  // jsonb 回写会重排 key 顺序，故用顺序无关的深比较
  const norm = (o) => JSON.stringify(o, Object.keys(o ?? {}).sort());
  const seqSame = norm(r1) === norm(r2) && r1.orderId === r2.orderId;
  console.log('[SEQ] settleCalls=%d draftCalls=%d sameResult=%s', seqSettle, seqDraft, seqSame);
  console.log('[SEQ] r1=', JSON.stringify(r1));
  console.log('[SEQ] r2=', JSON.stringify(r2), 'typeof=', typeof r2);
  if (!(seqSame && seqSettle === 1 && seqDraft === 1)) failures += 1;

  // 2) 并发同 key：12 并发，仅 1 次真正结算，其余返回同一结果
  settleCount = 0;
  draftCount = 0;
  const k2 = 'SIM-CONC-' + Date.now();
  const N = 12;
  const results = await Promise.all(
    Array.from({ length: N }, () => svc.checkout({ ...baseDto, idempotencyKey: k2 }, 'u1').catch((e) => ({ err: e.message }))),
  );
  const ok = results.filter((r) => r && r.orderId);
  const distinctOrders = new Set(results.map((r) => (r && r.orderId) || null));
  const errs = results.filter((r) => r && r.err);
  const anyErr = errs.length > 0;
  console.log('[CONC] N=%d settleCalls=%d okCount=%d distinctOrderIds=%d errCount=%d', N, settleCount, ok.length, distinctOrders.size, errs.length);
  if (errs.length) console.log('[CONC] errors=', JSON.stringify(errs.map((e) => e.err)));
  if (!(settleCount === 1 && ok.length === N && distinctOrders.size === 1 && !anyErr)) failures += 1;

  // 3) 表行状态核对
  const row = await client`SELECT status, biz_type FROM pos_idempotency WHERE key = ${k2} LIMIT 1`;
  console.log('[TABLE] k2 row =', JSON.stringify(row[0]));
  if (row[0] && row[0].status !== 'done') failures += 1;

  // 4) 不同 key 不互相干扰
  const k3 = 'SIM-OTHER-' + Date.now();
  await svc.checkout({ ...baseDto, idempotencyKey: k3 }, 'u1');
  const r3 = await svc.checkout({ ...baseDto, idempotencyKey: k3 }, 'u1');
  if (JSON.stringify(r3).indexOf('RO-') === -1) failures += 1;
  console.log('[DIFF-KEY] repeated same key returns result ok=%s', !!r3.orderId);

  console.log(failures === 0 ? '\n✅ POS 幂等验证 PASS' : `\n❌ POS 幂等验证 FAIL (failures=${failures})`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
