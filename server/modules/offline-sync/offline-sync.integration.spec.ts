import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { eq } from 'drizzle-orm';
import {
  posStore,
  posStyle,
  posColor,
  posSize,
  posSku,
  posStock,
  posPromotion,
  posMember,
} from '@server/database/schema';
import { OfflineSyncService } from './offline-sync.service';
import { restoreSoftDeleted, softDelete } from '@server/database/soft-delete';

/**
 * P-1：主数据增量下发（服务端契约）
 *
 * 客户端已改为「带 since 拉增量」，服务端这条过滤链就成了收益的来源：
 *   1. 不带 since → 全量；
 *   2. 带 since   → 只下发 updatedAt 晚于 since 的行（真正的增量收益）；
 *   3. 非法 since → 不得 500，退化为全量（收银机时钟漂移/手工造脏值常见）；
 *   4. 软删行不得混入增量（增量本就不带删除通知，混进来等于下发脏数据）；
 *   5. store 是本店锚点，任何情况下都要下发，否则离线开单会丢门店信息。
 */
const STORE = 'ST-DELTA';

/** 所有历史数据的「最后更新时间」统一压到过去，使增量断言不依赖真实等待 */
const OLD = new Date('2020-01-01T00:00:00Z');
const OLD_SINCE = '2020-06-01T00:00:00.000Z';

const styleRow = (id: string, name: string) => ({
  id,
  name,
  category: '上衣',
  colorIds: ['C1'],
  sizeIds: ['SZ1'],
  tagPrice: 10000,
  costPrice: 4000,
  status: 'on_sale',
});

describe('OfflineSyncService.getMasterData 增量契约', () => {
  let t: TestDb;
  let svc: OfflineSyncService;

  beforeAll(async () => {
    t = await setupTestDb();
    // getMasterData 不依赖其余业务 service，这里给空桩即可
    svc = new OfflineSyncService(
      t.db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await t.db.insert(posStore).values({ id: STORE, name: '增量测试店', code: STORE });
    await t.db
      .insert(posColor)
      .values({ id: 'C1', name: '黑', hex: '#000000', updatedAt: OLD });
    await t.db.insert(posSize).values({ id: 'SZ1', sortOrder: 1, updatedAt: OLD });
    await t.db
      .insert(posStyle)
      .values({ ...styleRow('S1', 'T恤'), updatedAt: OLD });
    await t.db.insert(posSku).values({
      id: 'SKU1',
      styleId: 'S1',
      colorId: 'C1',
      sizeId: 'SZ1',
      barcode: 'B1',
      updatedAt: OLD,
    });
    await t.db.insert(posStock).values({
      storeId: STORE,
      skuId: 'SKU1',
      styleId: 'S1',
      colorId: 'C1',
      sizeId: 'SZ1',
      qty: 10,
      inTransitQty: 0,
      updatedAt: OLD,
    });
    await t.db.insert(posPromotion).values({
      name: '满减',
      type: 'fullReduce',
      status: 'active',
      threshold: 30000,
      discountType: 'amount',
      discountValue: 5000,
      applyScope: 'all',
      scopeIds: [],
      validFrom: new Date('2026-09-01T00:00:00Z'),
      validTo: new Date('2026-09-30T00:00:00Z'),
      priority: 1,
      updatedAt: OLD,
    });
    await t.db.insert(posMember).values({
      memberNo: 'MD1',
      phone: '13800000001',
      name: '李四',
      level: 'normal',
      points: 0,
      storedValue: 0,
      totalSpent: 0,
      totalCount: 0,
      updatedAt: OLD,
    });
  });

  afterAll(async () => {
    await t.pg.close();
  });

  it('不带 since 返回全量，并给出服务端 snapshotAt', async () => {
    const snap = await svc.getMasterData(STORE);
    expect(snap.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.styles).toHaveLength(1);
    expect(snap.skus).toHaveLength(1);
    expect(snap.stock).toHaveLength(1);
    expect(snap.promotions).toHaveLength(1);
    expect(snap.members).toHaveLength(1);
    expect(snap.store.id).toBe(STORE);
  });

  it('无变更的增量返回空包（客户端据此不覆盖本地，界面不会被抹空）', async () => {
    const delta = await svc.getMasterData(STORE, OLD_SINCE);

    expect(delta.styles).toHaveLength(0);
    expect(delta.skus).toHaveLength(0);
    expect(delta.members).toHaveLength(0);
    expect(delta.colors).toHaveLength(0);
    expect(delta.sizes).toHaveLength(0);
    expect(delta.promotions).toHaveLength(0);
    expect(delta.stock).toHaveLength(0);
    // store 是本店锚点，任何情况下都要下发
    expect(delta.store.id).toBe(STORE);
    expect(delta.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('带 since 只下发这一轮真正变更的行', async () => {
    // 只改动一个 SKU 的库存：显式维护 _updated_at —— 该列没有数据库触发器兜底，
    // 「UPDATE 不改 updatedAt」在真实业务里同样会让增量同步漏掉这次变更。
    await t.db
      .update(posStock)
      .set({ qty: 8, updatedAt: new Date() })
      .where(eq(posStock.skuId, 'SKU1'));

    const delta = await svc.getMasterData(STORE, OLD_SINCE);

    // 变更行在
    expect(delta.stock).toHaveLength(1);
    expect(delta.stock[0].qty).toBe(8);
    // 未变更行不在（这是增量的全部收益来源）
    expect(delta.styles).toHaveLength(0);
    expect(delta.skus).toHaveLength(0);
    expect(delta.members).toHaveLength(0);
    expect(delta.colors).toHaveLength(0);
    expect(delta.sizes).toHaveLength(0);
    expect(delta.promotions).toHaveLength(0);
  });

  it('两次拉取之间新增的主数据会出现在增量里', async () => {
    await t.db.insert(posStyle).values(styleRow('S2', '卫衣'));

    const delta = await svc.getMasterData(STORE, OLD_SINCE);
    expect(delta.styles.map((s) => s.id)).toEqual(['S2']);
  });

  it('非法 since 不得 500，退化为全量', async () => {
    const snap = await svc.getMasterData(STORE, 'not-a-date');
    expect(snap.styles.length).toBeGreaterThan(0);
    expect(snap.stock.length).toBeGreaterThan(0);
  });

  it('软删除的主数据不会出现在增量里', async () => {
    await t.db
      .update(posStyle)
      .set({ deletedAt: new Date() })
      .where(eq(posStyle.id, 'S2'));

    const snap = await svc.getMasterData(STORE);
    expect(snap.styles.map((s) => s.id)).toEqual(['S1']);

    // 即便把 since 提前到软删之前，软删行依然不出现（notDeleted 生效）
    const delta = await svc.getMasterData(STORE, '2020-01-01T00:00:00.000Z');
    expect(delta.styles.map((s) => s.id)).not.toContain('S2');
  });
});

/**
 * P-1 补：删除通知（墓碑）。
 *
 * 增量同步只按 `updatedAt > since` 取行，天然拿不到「已失效」的行。若不在同一份
 * 快照里回传删除通知，收银机本地会长期残留已下架/已停用的主数据 —— 最直接的后果
 * 是收银台还能扫到已经下架的条码。
 *
 * 服务端做法：查询放宽到「只按水位线取变更行、不做业务过滤」，再在内存里按业务
 * 口径分区，失效行进 `deleted`。因此下面三类失效都能被捕获：
 *   ① 软删除（deletedAt 置位）；② 状态流转（下架 / 停用）；③ 硬删除（行消失，
 *   由下一次全量兜底）。
 */
describe('OfflineSyncService.getMasterData 删除通知', () => {
  let t: TestDb;
  let svc: OfflineSyncService;

  beforeAll(async () => {
    t = await setupTestDb();
    svc = new OfflineSyncService(
      t.db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await t.db.insert(posStore).values({ id: STORE, name: '墓碑测试店', code: STORE });
    await t.db.insert(posColor).values({ id: 'CT', name: '灰', hex: '#888888', updatedAt: OLD });
    await t.db.insert(posSize).values({ id: 'SZ9', sortOrder: 1, updatedAt: OLD });
    await t.db.insert(posStyle).values({ ...styleRow('SG1', '夹克'), updatedAt: OLD });
  });

  afterAll(async () => {
    await t.pg.close();
  });

  it('软删除：行不再下发，且以 deleted 通知客户端', async () => {
    await t.db.insert(posSku).values({
      id: 'SKU-TOMB',
      styleId: 'SG1',
      colorId: 'CT',
      sizeId: 'SZ9',
      barcode: 'BT',
      updatedAt: OLD,
    });

    // 走真实软删除路径（它会同时推进 updatedAt——这是删除能被增量感知的前提）
    await softDelete(t.db as never, posSku as never, 'SKU-TOMB');

    const delta = await svc.getMasterData(STORE, OLD_SINCE);
    expect(delta.skus.map((s) => s.id)).not.toContain('SKU-TOMB');
    expect(delta.deleted?.skus).toContain('SKU-TOMB');
  });

  it('状态流转（下架）：同样以 deleted 通知，不靠软删除', async () => {
    await t.db.insert(posStyle).values({ ...styleRow('SG2', '马甲'), updatedAt: OLD });
    await t.db
      .update(posStyle)
      .set({ status: 'off_shelf', updatedAt: new Date() })
      .where(eq(posStyle.id, 'SG2'));

    const delta = await svc.getMasterData(STORE, OLD_SINCE);
    expect(delta.styles.map((s) => s.id)).not.toContain('SG2');
    expect(delta.deleted?.styles).toContain('SG2');
  });

  it('恢复上架后重新进入下发，不再出现在 deleted 里', async () => {
    // 恢复 = 清空 deletedAt + 状态回到在售（两者都是真实业务动作）
    await restoreSoftDeleted(t.db as never, posStyle as never, 'SG2');
    await t.db
      .update(posStyle)
      .set({ status: 'on_sale' })
      .where(eq(posStyle.id, 'SG2'));

    const delta = await svc.getMasterData(STORE, OLD_SINCE);
    expect(delta.styles.map((s) => s.id)).toContain('SG2');
    // 注意用 `?? []`：deleted 里没有 styles 键时直接 toContain(undefined) 会抛错
    expect(delta.deleted?.styles ?? []).toEqual([]);
  });

  it('窗口内无失效行时不产出 deleted 字段（空数组会被客户端误读为"无删除"）', async () => {
    const snap = await svc.getMasterData(STORE, new Date().toISOString());
    expect(snap.styles).toHaveLength(0);
    expect(snap.deleted).toBeUndefined();
  });

  it('全量快照不带 deleted（全量本身即权威全量）', async () => {
    const snap = await svc.getMasterData(STORE);
    expect(snap.deleted).toBeUndefined();
    expect(snap.styles.map((s) => s.id).sort()).toEqual(['SG1', 'SG2']);
  });
});
