// 验证 PricingService 的“生效价格表/促销”缓存：首次穿透 DB，二次命中缓存，变更后失效。
const { PricingService } = require('./dist/server/modules/pricing/pricing.service.js');

// Map 支撑的缓存桩，完整实现 get/set/del，便于断言
const store = new Map();
const cache = {
  async get(k) { return store.has(k) ? store.get(k) : undefined; },
  async set(k, v) { store.set(k, v); },
  async del(k) { store.delete(k); return 1; },
};

// 统计 select 调用次数，验证缓存是否避免重复查 DB
let selectCount = 0;
const db = {
  select() {
    selectCount += 1;
    const chain = {
      from() { return { where() { return { orderBy() { return Promise.resolve([]); } } } }; },
    };
    return chain;
  },
};

const rbac = { getUserDataScope: async () => ({ type: 'all' }) };
const money = { round2: (x) => Math.round(x * 100) / 100 };

const svc = new PricingService(db, rbac, money, cache);

const today = new Date().toISOString().slice(0, 10);

(async () => {
  let failures = 0;

  // 1) 首次：缓存未命中 → 查 DB
  const r1 = await svc.fetchActivePriceLists(today);
  const afterFirstSelects = selectCount;
  const cachedKey = `pricing:activeLists:${today}`;
  const inCache = store.has(cachedKey);
  console.log('[1] first-call selects=%d cached?=%s', afterFirstSelects, inCache);
  if (!(afterFirstSelects === 1 && inCache)) failures += 1;

  // 2) 二次：缓存命中 → 不再查 DB
  const r2 = await svc.fetchActivePriceLists(today);
  const afterSecondSelects = selectCount;
  console.log('[2] second-call total selects=%d (expect same as first)', afterSecondSelects);
  if (!(afterSecondSelects === afterFirstSelects)) failures += 1;

  // 3) 促销缓存同样命中
  const p1 = await svc.fetchActivePromotions(today);
  const pBefore = selectCount;
  await svc.fetchActivePromotions(today);
  console.log('[3] promotion second-call extra selects=%d (expect 0)', selectCount - pBefore);
  if (!(selectCount - pBefore === 0)) failures += 1;

  // 4) 失效后再次穿透
  await svc.invalidateActiveCache();
  const cleared = !store.has(cachedKey);
  const r3 = await svc.fetchActivePriceLists(today);
  const afterInvalidateSelects = selectCount;
  console.log('[4] after invalidate: cleared?=%s re-selects=%d', cleared, afterInvalidateSelects - afterSecondSelects);
  if (!(cleared && afterInvalidateSelects > afterSecondSelects)) failures += 1;

  console.log(failures === 0 ? '\n✅ 定价缓存验证 PASS' : `\n❌ 定价缓存验证 FAIL (failures=${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
