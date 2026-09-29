// 验证 P1-c ①「读路径缓存扩展」的四个关键行为：
//   1. 作用域必须进缓存 key（否则超管先访问 → 受限用户命中同键 → 跨租户数据泄露）
//   2. 看板读路径二次访问不再打 DB
//   3. 系统配置：写后立即失效（改配置马上生效）
//   4. 计价参考数据：变更后失效（此前只有 deletePromotion 会失效）
const { DashboardService } = require('./dist/server/modules/dashboard/dashboard.service.js');
const { SystemConfigService } = require('./dist/server/modules/system/config/system-config.service.js');
const { PricingService } = require('./dist/server/modules/pricing/pricing.service.js');
const { RequestContext } = require('./dist/server/common/context/request-context.js');

const store = new Map();
const cache = {
  async get(k) {
    return store.has(k) ? store.get(k) : undefined;
  },
  async set(k, v) {
    store.set(k, v);
  },
  async del(k) {
    store.delete(k);
    return 1;
  },
};

/** 万能链式桩：任何方法调用都返回自身，`then` 触发就绪。用于统计 select 次数。 */
const chainFactory = (onReady) => {
  const chain = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (res, rej) => Promise.resolve().then(() => onReady()).then(res, rej);
        }
        if (prop === 'catch' || prop === 'finally') {
          return (cb) => (prop === 'finally' ? Promise.resolve().then(cb) : Promise.resolve());
        }
        return () => chain;
      },
      apply: () => chain,
    },
  );
  return chain;
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const ALL = { type: 'all', dealerIds: [] };
const D1 = { type: 'dealer', dealerIds: ['D1', 'D2'] };
const D2 = { type: 'dealer', dealerIds: ['D9'] };

const withScope = (scope, fn) =>
  RequestContext.run({ dealerScope: scope, userId: 'u1' }, fn);

(async () => {
  // ---------- 1. 看板：缓存命中 + 作用域分片 ----------
  console.log('\n[1] DashboardService 读路径缓存');
  let selects = 0;
  const db = {
    select() {
      selects += 1;
      return chainFactory(() => []);
    },
  };
  const dash = new DashboardService(db, cache);

  await withScope(ALL, () => dash.getStats());
  const firstSelects = selects;
  await withScope(ALL, () => dash.getStats());
  check('全量作用域下二次访问命中缓存（不再打 DB）', selects === firstSelects, `selects=${selects}`);

  await withScope(D1, () => dash.getStats());
  check('不同经销商作用域生成不同 key（跨租户不串数据）', selects === firstSelects + 9, `selects=${selects}`);

  await withScope(D1, () => dash.getStats());
  const afterSameScope = selects;
  await withScope(D1, () => dash.getStats());
  check('相同作用域二次访问仍命中缓存', selects === afterSameScope, `selects=${selects}`);

  const beforeTopStyles = selects;
  await withScope(D2, () => dash.getTopStyles(10));
  const afterTopStylesFirst = selects;
  await withScope(D2, () => dash.getTopStyles(10));
  check(
    'getTopStyles 同样按作用域分片并命中',
    afterTopStylesFirst > beforeTopStyles && selects === afterTopStylesFirst,
    `第一次穿透 selects=${afterTopStylesFirst}（基线 ${beforeTopStyles}），第二次 selects=${selects}`,
  );

  // ---------- 2. 系统配置：写后立即失效 ----------
  console.log('\n[2] SystemConfigService 配置缓存');
  let cfgSelects = 0;
  let cfgRows = [];
  const cfgDb = {
    select: () => {
      cfgSelects += 1;
      return chainFactory(() => cfgRows);
    },
    insert: () => chainFactory(() => []),
  };
  const cfgSvc = new SystemConfigService(cfgDb, cache);

  await cfgSvc.getConfig();
  const cfgFirst = cfgSelects;
  await cfgSvc.getConfig();
  check('配置的二次读取命中缓存', cfgSelects === cfgFirst, `selects=${cfgSelects}`);

  cfgRows = [{ configKey: 'tablePageSize', configValue: '50' }];
  await cfgSvc.updateConfig({ tablePageSize: 50 }, 'u1');
  const cfgAfterUpdate = await cfgSvc.getConfig();
  check('updateConfig 后立即失效（改完立即生效）', cfgSelects > cfgFirst && cfgAfterUpdate.tablePageSize === 50, `selects=${cfgSelects} value=${cfgAfterUpdate.tablePageSize}`);

  // ---------- 3. 计价：写路径失效覆盖 ----------
  console.log('\n[3] PricingService 参考数据缓存');
  let prSelects = 0;
  const prDb = {
    select: () => {
      prSelects += 1;
      return chainFactory(() => []);
    },
    insert: () => chainFactory(() => [{ id: 'PL1' }]),
    update: () => chainFactory(() => [{ id: 'PL1' }]),
    delete: () => chainFactory(() => [{ id: 'PL1' }]),
  };
  const prSvc = new PricingService(prDb, { getUserDataScope: async () => ALL }, { round2: (x) => x }, cache);
  const today = new Date().toISOString().slice(0, 10);

  await prSvc.fetchActivePriceLists(today);
  const prFirst = prSelects;
  await prSvc.fetchActivePriceLists(today);
  check('生效价格表二次读取命中缓存', prSelects === prFirst, `selects=${prSelects}`);

  await prSvc.createPriceList({ code: 'PL-1', name: '门店价' });
  const afterCreate = store.has(`pricing:activeLists:${today}`);
  check('createPriceList 会失效缓存（此前漏失效）', afterCreate === false);

  await prSvc.fetchActivePriceLists(today);
  check('变更后重新穿透 DB', prSelects > prFirst, `selects=${prSelects}`);

  await prSvc.updatePromotion('PM1', { name: '改' });
  check(
    'updatePromotion 会失效促销缓存',
    store.has(`pricing:activePromos:${today}`) === false,
  );

  await prSvc.updatePriceListItem('PLI1', { price: 10 });
  check(
    'updatePriceListItem 会失效缓存',
    store.has(`pricing:activeLists:${today}`) === false,
  );

  console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
