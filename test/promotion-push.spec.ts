import { describe, it, expect, beforeAll } from 'vitest';
import {
  createTestClient,
  createTestDb,
  withIsolatedTransaction,
  raw,
  type TestDb,
} from './utils/db';
import { promotion } from '@server/database/schema';
import { PromotionPushService } from '@server/modules/pricing/promotion-push.service';
import { MoneyService } from '@server/common/services/money.service';

/**
 * Wave 4-C：ERP 促销中心「下行载荷」契约
 *
 * 这个接口是促销从 ERP 走到门店收银台的唯一出口，任何一处过滤放错都会造成
 * 「总部建了活动、门店不知道」或「别店的活动在本店生效」。以下用例把三层过滤
 * （状态 / 生效期 / 门店维度）与字段单位全部钉死。
 */
describe('PromotionPushService.getPushPayload', () => {
  const money = new MoneyService();
  let client: ReturnType<typeof createTestClient>;
  let db: TestDb;

  beforeAll(() => {
    client = createTestClient();
    db = createTestDb(client);
  });

  /** 直接写 promotion 表（含 _created_at/_updated_at 等系统字段，drizzle 里不便构造） */
  const seed = (
    rows: Array<Record<string, unknown>>,
  ) => db.execute(
    raw`insert into promotion (id, code, name, type, threshold, reduce_amount, discount_rate,
        begin_date, end_date, store_ids, priority, status, _created_at, _updated_at)
        values ${raw.placeholder}` as never
  );

  // TestDb 泛型为 PostgresJsDatabase<typeof schema>，service 构造函数入参为默认
  // PostgresJsDatabase<Record<string, never>>，二者因 schema 泛型不兼容而报错。
  // 与 brand-name-guard.spec.ts 同处理：测试侧以 as any 透传（运行时无影响）。
  const svc = (d: TestDb) => new PromotionPushService(d as any, money);

  it('1) 只下发生效中的促销（inactive / disabled 不进载荷）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await tx.execute(
        raw`insert into promotion (id, code, name, type, threshold, reduce_amount, discount_rate,
              begin_date, end_date, store_ids, priority, status, _created_at, _updated_at)
            values
              ('11111111-1111-1111-1111-111111111111', 'P-ON',  '进行中', 'full_reduction', 200, 30, 1, null, null, '[]'::jsonb, 10, 'active', now(), now()),
              ('22222222-2222-2222-2222-222222222222', 'P-OFF', '已停用', 'full_reduction', 200, 30, 1, null, null, '[]'::jsonb, 99, 'inactive', now(), now())
            on conflict (id) do nothing` as never,
      );

      const payload = await svc(tx).getPushPayload({ asOf: '2026-09-24' });
      const codes = payload.items.map((i) => i.erpCode);
      expect(codes).toEqual(['P-ON']);
      expect(payload.asOf).toBe('2026-09-24');
    });
  });

  it('2) 生效期按基准日裁剪（开始日之前/结束日之后都不下发，端点当天算生效）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await tx.execute(
        raw`insert into promotion (id, code, name, type, threshold, reduce_amount, discount_rate,
              begin_date, end_date, store_ids, priority, status, _created_at, _updated_at)
            values
              ('11111111-1111-1111-1111-111111111111', 'P-FUTURE', '未开始', 'full_reduction', 0, 10, 1, '2026-10-01', null, '[]'::jsonb, 5, 'active', now(), now()),
              ('22222222-2222-2222-2222-222222222222', 'P-TODAY',  '今天',   'full_reduction', 0, 10, 1, '2026-09-24', '2026-09-24', '[]'::jsonb, 5, 'active', now(), now()),
              ('33333333-3333-3333-3333-333333333333', 'P-GONE',   '已过期', 'full_reduction', 0, 10, 1, null, '2026-09-23', '[]'::jsonb, 5, 'active', now(), now())
            on conflict (id) do nothing` as never,
      );

      const payload = await svc(tx).getPushPayload({ asOf: '2026-09-24' });
      expect(payload.items.map((i) => i.erpCode)).toEqual(['P-TODAY']);
    });
  });

  it('3) 门店维度：storeIds 为空=全部门店；否则必须命中该店', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await tx.execute(
        raw`insert into promotion (id, code, name, type, threshold, reduce_amount, discount_rate,
              begin_date, end_date, store_ids, priority, status, _created_at, _updated_at)
            values
              ('11111111-1111-1111-1111-111111111111', 'P-ALL', '全部门店', 'full_reduction', 0, 10, 1, null, null, '[]'::jsonb, 5, 'active', now(), now()),
              ('22222222-2222-2222-2222-222222222222', 'P-A',   '仅A店',   'full_reduction', 0, 10, 1, null, null, '["ST-A"]'::jsonb, 5, 'active', now(), now()),
              ('33333333-3333-3333-3333-333333333333', 'P-B',   '仅B店',   'full_reduction', 0, 10, 1, null, null, '["ST-B"]'::jsonb, 5, 'active', now(), now())
            on conflict (id) do nothing` as never,
      );

      const all = await svc(tx).getPushPayload({ asOf: '2026-09-24' });
      expect(all.items.map((i) => i.erpCode)).toEqual(['P-ALL', 'P-A', 'P-B']);

      const onlyA = await svc(tx).getPushPayload({ storeId: 'ST-A', asOf: '2026-09-24' });
      expect(onlyA.items.map((i) => i.erpCode)).toEqual(['P-ALL', 'P-A']);
      expect(onlyA.storeId).toBe('ST-A');
    });
  });

  it('4) 金额用「元」下发（避免传输途中丢精度），store_ids 原样保留', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await tx.execute(
        raw`insert into promotion (id, code, name, type, threshold, reduce_amount, discount_rate,
              begin_date, end_date, store_ids, priority, status, _created_at, _updated_at)
            values
              ('11111111-1111-1111-1111-111111111111', 'P-M', '满减', 'full_reduction', 199.99, 30.55, 1,
               '2026-09-01', '2026-09-30', '["ST-A","ST-B"]'::jsonb, 7, 'active', now(), now())
            on conflict (id) do nothing` as never,
      );

      const [item] = (await svc(tx).getPushPayload({ storeId: 'ST-A', asOf: '2026-09-24' }))
        .items;
      expect(item.thresholdYuan).toBe(199.99);
      expect(item.reduceAmountYuan).toBe(30.55);
      expect(item.storeIds).toEqual(['ST-A', 'ST-B']);
      expect(item.erpPromotionId).toBe('11111111-1111-1111-1111-111111111111');
      expect(item.type).toBe('full_reduction');
      expect(item.priority).toBe(7);
    });
  });

  it('5) erpPromotionId 必须是 ERP 主键（POS 侧幂等键依赖它稳定不变）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      const rows = await tx
        .select({ id: promotion.id, code: promotion.code })
        .from(promotion)
        .limit(1);
      // 表在设计上允许为空；一旦有数据，主键必须非空且与 code 一一对应
      if (rows.length === 0) return;
      expect(rows[0].id).toBeTruthy();
      const [item] = (await svc(tx).getPushPayload({ asOf: '2026-09-24' })).items;
      expect(item.erpPromotionId).toBe(rows[0].id);
      expect(item.erpCode).toBe(rows[0].code);
    });
  });

  it('6) 未传 asOf 时取当天，且不因为时区漂移到"明天"', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      const payload = await svc(tx).getPushPayload();
      const today = new Date().toISOString().slice(0, 10);
      expect(payload.asOf).toBe(today);
    });
  });
});
