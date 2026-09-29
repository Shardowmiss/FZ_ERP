import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { eq, isNull } from 'drizzle-orm';
import { posPromotion } from '@server/database/schema';
import { PromotionSyncService } from './promotion-sync.service';
import type { ErpPromotionRow } from './promotion-mapping';

/**
 * Wave 4-C：促销下行落库契约
 *
 * 要点（每一条都对应一个真实的资损/静默失效路径）：
 *  1. 幂等：同一批促销同步两次不得产生重复行 —— 否则收银台「同一满减叠加两次」。
 *  2. 更新：ERP 改了减免额，POS 必须跟到。
 *  3. 墓碑：ERP 撤销的促销，POS 必须下架（deletedAt 软删）。
 *  4. 恢复：ERP 重新启用，POS 必须复活（deletedAt 清空）。
 *  5. append 模式不得误墓碑。
 *  6. 单位：ERP 用「元」，pos_promotion 用「分」，映射必须换算。
 */
describe('PromotionSyncService 促销下行', () => {
  let t: TestDb;
  let svc: PromotionSyncService;

  const NOW = new Date('2026-09-24T10:00:00.000Z');

  const fullReduce = (over: Partial<ErpPromotionRow> = {}): ErpPromotionRow => ({
    erpPromotionId: 'ERP-P001',
    erpCode: 'PROMO-001',
    name: '全场满200减30',
    type: 'full_reduction',
    thresholdYuan: 200,
    reduceAmountYuan: 30,
    discountRate: 1,
    beginDate: '2026-09-01',
    endDate: '2026-09-30',
    storeIds: [],
    priority: 10,
    ...over,
  });

  const percentOff = (over: Partial<ErpPromotionRow> = {}): ErpPromotionRow => ({
    erpPromotionId: 'ERP-P002',
    erpCode: 'PROMO-002',
    name: '会员全场8折',
    type: 'discount',
    thresholdYuan: 0,
    reduceAmountYuan: 0,
    discountRate: 0.8,
    beginDate: '2026-09-01',
    endDate: '2026-09-30',
    storeIds: ['ST-001'],
    priority: 5,
    ...over,
  });

  /** 有效促销 = 未软删（显式带条件；service 内部走 scopeDatabase 的同一语义） */
  const liveRows = async (): Promise<any[]> =>
    (await t.db
      .select()
      .from(posPromotion)
      .where(isNull(posPromotion.deletedAt))
      .orderBy(posPromotion.erpPromotionId)) as any[];

  beforeAll(async () => {
    t = await setupTestDb();
    svc = new PromotionSyncService(t.db as never);
  });

  afterAll(async () => {
    await t.pg.close();
  });

  it('1) 首次同步：字段映射与金额单位换算（元 → 分）', async () => {
    const r = await svc.sync({ rows: [fullReduce(), percentOff()], now: NOW });
    expect(r.upserted).toBe(2);
    expect(r.skipped).toBe(0);

    const rows = await liveRows();
    expect(rows).toHaveLength(2);

    const fr = rows.find((x) => x.erpPromotionId === 'ERP-P001');
    expect(fr.name).toBe('全场满200减30');
    expect(fr.type).toBe('full_reduce');
    expect(fr.discountType).toBe('amount');
    expect(fr.threshold).toBe(20000); // 200 元 = 20000 分
    expect(fr.discountValue).toBe(3000); // 30 元 = 3000 分
    expect(fr.applyScope).toBe('all');
    expect(fr.scopeIds).toEqual([]);
    expect(fr.source).toBe('erp');
    expect(fr.status).toBe('active');
    // 结束日取当日 23:59:59.999，保证「活动当天仍生效」
    expect(fr.validTo.toISOString()).toBe('2026-09-30T15:59:59.999Z'); // 23:59:59.999+08:00

    const pc = rows.find((x) => x.erpPromotionId === 'ERP-P002');
    expect(pc.type).toBe('full_discount');
    expect(pc.discountType).toBe('percent');
    expect(pc.discountValue).toBe(80); // 百分率整数：80 = 8 折（读回 fromCents 还原为 0.8）
    expect(pc.applyScope).toBe('scoped');
    expect(pc.scopeIds).toEqual(['ST-001']);
  });

  it('2) 幂等：重复同步同一批不得产生重复行', async () => {
    const r = await svc.sync({ rows: [fullReduce(), percentOff()], now: NOW });
    expect(r.upserted).toBe(2);
    const rows = await liveRows();
    const ids = rows.map((x) => x.erpPromotionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('3) 更新：ERP 侧改了减免额，POS 必须跟上', async () => {
    await svc.sync({
      rows: [fullReduce({ reduceAmountYuan: 50, thresholdYuan: 300 })],
      mode: 'append',
      now: NOW,
    });
    const rows = await liveRows();
    const fr = rows.find((x) => x.erpPromotionId === 'ERP-P001');
    expect(fr.threshold).toBe(30000);
    expect(fr.discountValue).toBe(5000);
    expect(rows).toHaveLength(2);
  });

  it('4) 墓碑：快照里消失的促销必须被软删，而不是留在收银台继续打折', async () => {
    const r = await svc.sync({ rows: [percentOff()], now: NOW });
    expect(r.tombstoned).toBe(1);

    const all = (await t.db
      .select()
      .from(posPromotion)
      .where(eq(posPromotion.erpPromotionId, 'ERP-P001'))) as any[];
    expect(all).toHaveLength(1);
    expect(all[0].deletedAt).toBeInstanceOf(Date);

    // 软删行不得出现在正常查询中（scopeDatabase 已注入 deletedAt IS NULL）
    const live = await liveRows();
    expect(live.map((x) => x.erpPromotionId)).toEqual(['ERP-P002']);
  });

  it('5) 恢复：ERP 重新启用后 POS 必须复活', async () => {
    await svc.sync({ rows: [fullReduce(), percentOff()], now: NOW });
    const all = (await t.db
      .select()
      .from(posPromotion)
      .where(eq(posPromotion.erpPromotionId, 'ERP-P001'))) as any[];
    expect(all[0].deletedAt).toBeNull();
    expect(await liveRows()).toHaveLength(2);
  });

  it('6) append 模式不得墓碑（增量源语义）', async () => {
    const before = await liveRows();
    const r = await svc.sync({
      rows: [fullReduce()],
      mode: 'append',
      now: NOW,
    });
    expect(r.tombstoned).toBe(0);
    expect(await liveRows()).toHaveLength(before.length);
  });

  it('7) 跳过：POS 表达不了的类型要记账而不是静默丢弃', async () => {
    const r = await svc.sync({
      rows: [
        fullReduce({ erpPromotionId: 'ERP-P003', name: '特价品', type: 'fixed_price' }),
        fullReduce({ erpPromotionId: '', name: '无主键' }),
      ],
      now: NOW,
    });
    expect(r.skipped).toBe(2);
    expect(r.skipReasons.join('|')).toContain('不支持的促销类型');
    expect(r.skipReasons.join('|')).toContain('erp_promotion_id 缺失');
    // 整批被跳过 ≠ 上游撤销：绝不能墓碑，否则一次解析失败就批量下架全店促销
    expect(r.tombstoned).toBe(0);
  });

  it('8) 折扣率非法（0 或 ≥1）不得落库', async () => {
    const r = await svc.sync({
      rows: [percentOff({ erpPromotionId: 'ERP-P004', discountRate: 1 })],
      mode: 'append',
      now: NOW,
    });
    expect(r.skipped).toBe(1);
    expect(r.skipReasons.join('|')).toContain('折扣率非法');
  });

  it('9) 全空快照（snapshot）应把所有 ERP 促销下架', async () => {
    // 先把两个促销重新同步回来（模拟 ERP 重新启用）
    await svc.sync({ rows: [fullReduce(), percentOff()], mode: 'append', now: NOW });
    expect(await liveRows()).toHaveLength(2);
    // 再把整批撤掉：snapshot 语义下应全数下架
    const r = await svc.sync({ rows: [], mode: 'snapshot', now: NOW });
    expect(r.tombstoned).toBe(2);
    expect(await liveRows()).toHaveLength(0);
  });
});
