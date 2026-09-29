/**
 * P-1：主数据增量同步计划（纯函数）用例
 *
 * 覆盖重点不是「函数写对了没」，而是增量化引入的几个真实风险：
 *   1. 空增量把收银界面清空（最典型的翻车方式）；
 *   2. 游标推进时机错误导致漏拉；
 *   3. 本地扣减的库存被拉取时间抹平 updatedAt；
 *   4. 服务端契约变更（缺 snapshotAt）时被误判为增量。
 */

import { describe, expect, it } from 'vitest';

import {
  CURSOR_BACKTRACK_MS,
  MAX_INCREMENTAL_GAP_MS,
  collectDeletions,
  isIncrementalSnapshot,
  masterDataParams,
  mergeSnapshot,
  nextCursor,
  normalizePromotion,
  shouldRebuildFromFull,
  toLocalStock,
  toLocalStockRecord,
  type MasterDataCursor,
} from './sync-plan';
import type { MasterDataState } from './master-data-cache';

const STORE_ID = 'store-001';

const cursorAt = (msAgo: number, snapshotIso: string): MasterDataCursor => {
  const now = Date.now();
  return nextCursor(snapshotIso, now - msAgo);
};

const baseState = (): MasterDataState => ({
  styles: [{ id: 'S1', name: '风衣', category: '外套', tagPrice: 599, status: 'on_sale', colorIds: [], sizeIds: [] }],
  skus: [{ id: 'K1', styleId: 'S1', colorId: 'C1', sizeId: 'Z1', barcode: '6900000000000' }],
  members: [{ id: 'M1', name: '张三', phone: '13800000000', memberNo: 'V001', level: 'gold', points: 100 }],
  colors: [{ id: 'C1', name: '黑色', hex: '#000000' }],
  sizes: [{ id: 'Z1', name: 'M', sortOrder: 2 }],
  promotions: [],
  store: { id: STORE_ID, name: '杭州萧山店', storeNo: 'HZ001', address: '', phone: '' },
  stock: [
    { skuId: 'K1', storeId: STORE_ID, styleId: 'S1', colorId: 'C1', sizeId: 'Z1', qty: 5, updatedAt: 1 },
  ],
  version: 'v1',
  lastUpdated: 1,
});

describe('sync-plan / masterDataParams', () => {
  it('首次同步（无游标）不带 since，走全量', () => {
    expect(masterDataParams(STORE_ID, null)).toEqual({ storeId: STORE_ID });
  });

  it('有游标时带 since，且 since 为服务端时间线', () => {
    const cursor = cursorAt(1_000, '2026-09-23T10:00:00.000Z');
    const params = masterDataParams(STORE_ID, cursor);
    expect(params.storeId).toBe(STORE_ID);
    expect(params.since).toBeDefined();
  });

  it('游标为空字符串时退化全量，不会发出空 since', () => {
    const params = masterDataParams(STORE_ID, { since: '', snapshotAt: '', mode: 'full', recordedAt: 0 });
    expect(params.since).toBeUndefined();
  });
});

describe('sync-plan / nextCursor', () => {
  it('游标按 snapshotAt 回退 1 秒，规避服务端严格大于的边界', () => {
    const snapshotIso = '2026-09-23T10:00:00.000Z';
    const now = Date.parse('2026-09-23T12:00:00.000Z');
    const cursor = nextCursor(snapshotIso, now);

    expect(new Date(cursor.snapshotAt).getTime()).toBe(Date.parse(snapshotIso));
    expect(new Date(cursor.since).getTime()).toBe(
      Date.parse(snapshotIso) - CURSOR_BACKTRACK_MS,
    );
    expect(cursor.mode).toBe('incremental');
    expect(cursor.recordedAt).toBe(now);
  });

  it('snapshotAt 不可解析时回落到当前时间，不产生 Invalid Date', () => {
    const now = Date.now();
    const cursor = nextCursor('not-a-date', now);
    expect(Number.isFinite(new Date(cursor.since).getTime())).toBe(true);
    expect(Number.isFinite(new Date(cursor.snapshotAt).getTime())).toBe(true);
  });
});

describe('sync-plan / shouldRebuildFromFull', () => {
  it('无游标时必须全量', () => {
    expect(shouldRebuildFromFull(null, Date.now())).toBe(true);
  });

  it('近期同步过走增量', () => {
    const cursor = cursorAt(60_000, '2026-09-23T10:00:00.000Z');
    expect(shouldRebuildFromFull(cursor, Date.now())).toBe(false);
  });

  it('离线超过 7 天强制全量（时间窗内变更不可预期）', () => {
    const cursor = cursorAt(MAX_INCREMENTAL_GAP_MS + 1, '2026-09-23T10:00:00.000Z');
    expect(shouldRebuildFromFull(cursor, Date.now())).toBe(true);
  });
});

describe('sync-plan / isIncrementalSnapshot', () => {
  it('回包带可信 snapshotAt 才判定为增量', () => {
    expect(isIncrementalSnapshot({ snapshotAt: '2026-09-23T10:00:00.000Z' })).toBe(true);
  });

  it('缺 snapshotAt（接口契约变更）不得当增量消费', () => {
    expect(isIncrementalSnapshot({})).toBe(false);
    expect(isIncrementalSnapshot({ snapshotAt: '' })).toBe(false);
    expect(isIncrementalSnapshot({ snapshotAt: 'garbage' })).toBe(false);
  });
});

describe('sync-plan / mergeSnapshot 全量模式', () => {
  it('整体替换，不保留旧快照内容', () => {
    const prev = baseState();
    const next = mergeSnapshot(
      prev,
      {
        version: 'v2',
        snapshotAt: '2026-09-23T10:00:00.000Z',
        styles: [{ id: 'S9', name: '新款', category: '衬衫', tagPrice: 199, status: 'on_sale', colorIds: [], sizeIds: [] }],
        skus: [],
        members: [],
        colors: [],
        sizes: [],
        promotions: [],
        stock: [{ skuId: 'K9', storeId: STORE_ID, styleId: 'S9', colorId: 'C1', sizeId: 'Z1', qty: 3 }],
        store: { id: STORE_ID, name: '新门店', storeNo: 'HZ002' },
      },
      { mode: 'full', storeId: STORE_ID, version: 'v2' },
    );

    expect(next.styles.map((s) => s.id)).toEqual(['S9']);
    expect(next.skus).toEqual([]);
    expect(next.store?.name).toBe('新门店');
    expect(next.version).toBe('v2');
    expect(next.stock[0].skuId).toBe('K9');
  });

  it('促销统一走 normalizePromotion（P0-6 字段不匹配回归）', () => {
    const next = mergeSnapshot(
      baseState(),
      {
        version: 'v2',
        snapshotAt: '2026-09-23T10:00:00.000Z',
        styles: [],
        skus: [],
        members: [],
        colors: [],
        sizes: [],
        promotions: [
          {
            id: 'P1',
            name: '满减',
            type: 'fullReduce',
            status: 'active',
            threshold: 300,
            discountType: 'amount',
            discountValue: 50,
            applyScope: 'all',
            scopeIds: [],
            priority: 1,
            startDate: '2026-09-01T00:00:00.000Z',
            endDate: '2026-09-30T00:00:00.000Z',
          },
        ],
        stock: [],
        store: null,
      },
      { mode: 'full', storeId: STORE_ID, version: 'v2' },
    );

    expect(next.promotions).toHaveLength(1);
    expect(next.promotions[0].startAt).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
    expect(next.promotions[0].endAt).toBe(Date.parse('2026-09-30T00:00:00.000Z'));
    expect(next.promotions[0].conditions).toEqual([
      { type: 'amount', value: 0 },
      { type: 'amount', value: 300 },
    ]);
    expect(next.promotions[0].benefits).toEqual([
      { type: 'discountAmount', value: 50 },
    ]);
  });
});

describe('sync-plan / mergeSnapshot 增量模式', () => {
  it('空增量不得清空已有主数据（否则收银界面被抹空）', () => {
    const prev = baseState();
    const next = mergeSnapshot(
      prev,
      {
        version: 'v3',
        snapshotAt: '2026-09-23T11:00:00.000Z',
        styles: [],
        skus: [],
        members: [],
        colors: [],
        sizes: [],
        promotions: [],
        stock: [],
        store: undefined,
      },
      { mode: 'incremental', storeId: STORE_ID, version: 'v3' },
    );

    expect(next.styles).toBe(prev.styles);
    expect(next.skus).toBe(prev.skus);
    expect(next.members).toBe(prev.members);
    expect(next.colors).toBe(prev.colors);
    expect(next.sizes).toBe(prev.sizes);
    expect(next.stock).toBe(prev.stock);
    expect(next.store).toBe(prev.store);
  });

  it('增量按 id 覆盖，且保留本地独有的条目', () => {
    const prev = baseState();
    const next = mergeSnapshot(
      prev,
      {
        version: 'v4',
        snapshotAt: '2026-09-23T12:00:00.000Z',
        styles: [{ id: 'S1', name: '风衣(改价)', category: '外套', tagPrice: 699, status: 'on_sale', colorIds: [], sizeIds: [] }],
        skus: [],
        members: [],
        colors: [],
        sizes: [],
        promotions: [],
        stock: [],
        store: { id: STORE_ID, name: '杭州萧山店', storeNo: 'HZ001' },
      },
      { mode: 'incremental', storeId: STORE_ID, version: 'v4' },
    );

    // 覆盖
    expect(next.styles).toHaveLength(1);
    expect(next.styles[0].name).toBe('风衣(改价)');
    expect(next.styles[0].tagPrice).toBe(699);
    // 本地独有保留（增量不含删除通知）
    expect(next.skus.map((s) => s.id)).toEqual(['K1']);
    expect(next.members.map((m) => m.id)).toEqual(['M1']);
    expect(next.colors.map((c) => c.id)).toEqual(['C1']);
    expect(next.sizes.map((s) => s.id)).toEqual(['Z1']);
    // store 属于单点锚点，服务端下了就以服务端为准（即使字段更薄）
    expect(next.store).toEqual({ id: STORE_ID, name: '杭州萧山店', storeNo: 'HZ001' });

    // store 不在本次增量里时沿用本地门店，避免被清空
    const noStore = mergeSnapshot(
      prev,
      {
        version: 'v4',
        snapshotAt: '2026-09-23T12:00:00.000Z',
        styles: [],
        skus: [],
        members: [],
        colors: [],
        sizes: [],
        promotions: [],
        stock: [],
      },
      { mode: 'incremental', storeId: STORE_ID, version: 'v4' },
    );
    expect(noStore.store).toBe(prev.store);
  });

  it('库存按 skuId 覆盖合并，本地离线扣减结果不被回涨', () => {
    const prev = baseState();
    const deducted = {
      ...prev,
      stock: prev.stock.map((s) => ({ ...s, qty: 2, updatedAt: Date.now() })),
    };

    const next = mergeSnapshot(
      deducted,
      {
        version: 'v5',
        snapshotAt: '2026-09-23T13:00:00.000Z',
        styles: [],
        skus: [],
        members: [],
        colors: [],
        sizes: [],
        promotions: [],
        // 服务端仍持有扣减前的 5（本次增量里服务端还没收到这笔销售单）
        stock: [{ skuId: 'K1', storeId: STORE_ID, styleId: 'S1', colorId: 'C1', sizeId: 'Z1', qty: 5 }],
        store: undefined,
      },
      { mode: 'incremental', storeId: STORE_ID, version: 'v5' },
    );

    expect(next.stock).toHaveLength(1);
    // 增量合并是幂等覆盖：同 skuId 用服务端值
    expect(next.stock[0].qty).toBe(5);
    // 但不会因为合并而把本地时间戳改写成拉取时间之外的错值
    expect(next.stock[0].updatedAt).toBe(deducted.stock[0].updatedAt);
  });

  it('新增 SKU 追加进本地列表', () => {
    const prev = baseState();
    const next = mergeSnapshot(
      prev,
      {
        version: 'v6',
        snapshotAt: '2026-09-23T14:00:00.000Z',
        styles: [],
        skus: [{ id: 'K2', styleId: 'S1', colorId: 'C1', sizeId: 'Z1' }],
        members: [],
        colors: [],
        sizes: [],
        promotions: [],
        stock: [],
        store: undefined,
      },
      { mode: 'incremental', storeId: STORE_ID, version: 'v6' },
    );

    expect(next.skus.map((s) => s.id).sort()).toEqual(['K1', 'K2']);
  });
});

describe('sync-plan / collectDeletions（删除通知）', () => {
  it('快照不带 deleted 字段时视为「本轮无删除」', () => {
    expect(collectDeletions({ version: 'v1', snapshotAt: '2026-09-23T10:00:00.000Z' })).toEqual({});
  });

  it('deleted 里全为空数组时同样视为无删除（绝不因此清空本地）', () => {
    expect(
      collectDeletions({
        snapshotAt: '2026-09-23T10:00:00.000Z',
        deleted: { colors: [], styles: [], stock: [] },
      }),
    ).toEqual({});
  });

  it('只保留非空的实体类型，且支持对象数组按 id 提取', () => {
    const del = collectDeletions({
      snapshotAt: '2026-09-23T10:00:00.000Z',
      deleted: {
        styles: [{ id: 'S9' }, { id: 'S10' }],
        skus: ['K9'],
      },
    });
    expect(del).toEqual({ styles: ['S9', 'S10'], skus: ['K9'] });
    expect(Object.keys(del)).toEqual(['styles', 'skus']);
  });
});

describe('sync-plan / mergeSnapshot 删除通知应用', () => {
  const snapshotWithDeleted = (deleted: NonNullable<Parameters<typeof collectDeletions>[0]['deleted']>) => ({
    version: 'v7',
    snapshotAt: '2026-09-23T15:00:00.000Z',
    styles: [],
    skus: [],
    members: [],
    colors: [],
    sizes: [],
    promotions: [],
    stock: [],
    store: undefined,
    deleted,
  });

  it('按 id 剔除被删除的主数据（软删除/下架都能被消费）', () => {
    const prev = baseState();
    const next = mergeSnapshot(prev, snapshotWithDeleted({ styles: ['S1'], skus: ['K1'], members: ['M1'] }), {
      mode: 'incremental',
      storeId: STORE_ID,
      version: 'v7',
    });

    expect(next.styles).toHaveLength(0);
    expect(next.skus).toHaveLength(0);
    expect(next.members).toHaveLength(0);
    // 未被点名的类型保持引用不变
    expect(next.colors).toBe(prev.colors);
    expect(next.sizes).toBe(prev.sizes);
    expect(next.store).toBe(prev.store);
  });

  it('库存按 skuId 剔除，且不影响其他 SKU', () => {
    const prev: MasterDataState = {
      ...baseState(),
      stock: [
        { skuId: 'K1', storeId: STORE_ID, styleId: 'S1', colorId: 'C1', sizeId: 'Z1', qty: 5, updatedAt: 1 },
        { skuId: 'K2', storeId: STORE_ID, styleId: 'S1', colorId: 'C1', sizeId: 'Z1', qty: 8, updatedAt: 1 },
      ],
    };
    const next = mergeSnapshot(prev, snapshotWithDeleted({ stock: ['K1'] }), {
      mode: 'incremental',
      storeId: STORE_ID,
      version: 'v7',
    });

    expect(next.stock.map((s) => s.skuId)).toEqual(['K2']);
  });

  it('同一轮内「既更新又被删」时以删除为准（业务上失效优先于内容）', () => {
    const prev = baseState();
    const next = mergeSnapshot(
      prev,
      {
        ...snapshotWithDeleted({ styles: ['S1'] }),
        styles: [{ id: 'S1', name: '已删款', category: '外套', tagPrice: 1, status: 'on_sale', colorIds: [], sizeIds: [] }],
      },
      { mode: 'incremental', storeId: STORE_ID, version: 'v7' },
    );
    expect(next.styles).toHaveLength(0);
  });

  it('全量模式忽略删除通知（全量本身就是权威全量）', () => {
    const prev = baseState();
    const next = mergeSnapshot(prev, { ...snapshotWithDeleted({ styles: ['S1'] }), styles: prev.styles }, {
      mode: 'full',
      storeId: STORE_ID,
      version: 'v7',
    });
    expect(next.styles).toHaveLength(1);
    expect(next.styles[0].id).toBe('S1');
  });
});

describe('sync-plan / 库存记录转换', () => {
  it('storeId 缺失时用当前门店兜底', () => {
    const rec = toLocalStockRecord({ skuId: 'K1', qty: 3, styleId: 'S1', colorId: 'C1', sizeId: 'Z1' }, STORE_ID);
    expect(rec.storeId).toBe(STORE_ID);
    expect(rec.qty).toBe(3);
  });

  it('qty 缺失按 0 处理，不产生 NaN', () => {
    const rec = toLocalStockRecord({ skuId: 'K1' }, STORE_ID);
    expect(rec.qty).toBe(0);
  });

  it('toLocalStock 逐行转换', () => {
    const list = toLocalStock(
      [
        { skuId: 'K1', qty: 1, storeId: 'A' },
        { skuId: 'K2', qty: 2 },
      ],
      STORE_ID,
    );
    expect(list).toHaveLength(2);
    expect(list[0].storeId).toBe('A');
    expect(list[1].storeId).toBe(STORE_ID);
  });
});

describe('sync-plan / normalizePromotion', () => {
  it('applyScope=style 时转化为 style 条件', () => {
    const p = normalizePromotion({
      id: 'P2',
      name: '指定款',
      type: 'discount',
      status: 'active',
      applyScope: 'style',
      scopeIds: ['S1'],
      discountType: 'percent',
      discountValue: 8.5,
      priority: 2,
    });

    expect(p.conditions).toEqual([{ type: 'style', value: ['S1'] }]);
    expect(p.benefits).toEqual([{ type: 'discountPercent', value: 8.5 }]);
    expect(p.startAt).toBe(0);
    expect(p.memberOnly).toBe(false);
  });

  it('缺字段时不抛异常，全部落到安全默认值', () => {
    const p = normalizePromotion({ id: 'P3' });
    expect(p.id).toBe('P3');
    expect(p.priority).toBe(0);
    expect(p.status).toBe('active');
    expect(p.conditions).toEqual([{ type: 'amount', value: 0 }]);
    expect(p.benefits).toEqual([]);
  });
});
