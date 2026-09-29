import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { isNull } from 'drizzle-orm';
import { posPromotion } from '@server/database/schema';
import { POS_PROMOTION_DDL } from '@server/test-utils/pglite';
import type { TestDb } from '@server/test-utils/pglite';
import { PromotionSyncService } from './promotion-sync.service';
import { RealErpAdapter } from './real-erp.adapter';
import { ErpIntegrationService } from './erp-integration.service';
import { MockErpService } from './mock-erp.service';
import { evaluatePromotions } from '../promotions/promotion-engine';

/**
 * Wave 4-C：ERP → POS 促销下行【真库端到端】验证
 * ---------------------------------------------------------------------------
 * 与 promotion-sync.spec.ts 的区别：那边用 pglite 内存库验证「同步逻辑的契约」，
 * 这里打的是**真实 PostgreSQL 服务**（端口 5434 上的 erp_db / pos_db），跑的是
 * 生产同款代码路径：
 *
 *   RealErpAdapter.getPromotions()  ← 真实 postgres-js 跨库读 ERP
 *     → PromotionSyncService.sync() ← 真实 drizzle upsert / 墓碑
 *       → pos_promotion 真表落库
 *         → evaluatePromotions() 算开单优惠上限
 *
 * 为什么还需要这一层：pglite 是 WASM 版 PG，bigint 溢出、jsonb 解析、timestamptz
 * 时区、CHECK 约束这些「只有真库才会暴露」的差异它覆盖不到（本次 bigint 折扣列
 * 就是靠真库才彻底坐实）。
 *
 * 默认跳过（describe.skipIf）：不设置 POS_E2E_DB_URL 时保持 `npm test` 完全自洽
 * （无需外部数据库服务）。运行时：
 *   POS_E2E_DB_URL=postgres://erp:erp@127.0.0.1:5434/pos_db \
 *   ERP_E2E_DB_URL=postgres://erp:erp@127.0.0.1:5434/erp_db \
 *   npx vitest run server/modules/erp-integration/promotion-e2e.spec.ts
 */
const POS_DB_URL = process.env.POS_E2E_DB_URL;
const ERP_DB_URL = process.env.ERP_E2E_DB_URL ?? 'postgres://erp:erp@127.0.0.1:5434/erp_db';

/** 固定用例数据，便于 afterAll 精确清理、也可重复执行 */
const P_FULL = 'e2e00000-0000-4000-8000-000000000001'; // 满 0 减 30 元，仅 ST-A
const P_RATE = 'e2e00000-0000-4000-8000-000000000002'; // 全场 8 折，全部门店
const P_OFF = 'e2e00000-0000-4000-8000-000000000003'; // inactive，永远不该下行

describe.skipIf(!POS_DB_URL)('Wave 4-C 真库端到端：ERP 促销 → POS 落库 → 开单上限', () => {
  let pos: ReturnType<typeof postgres>;
  let erp: ReturnType<typeof postgres>;
  let db: TestDb;
  let sync: PromotionSyncService;

  const livePromos = async () =>
    (await db.select().from(posPromotion).where(isNull(posPromotion.deletedAt))).filter(
      (r) => r.type === 'full_reduce' || r.type === 'full_discount',
    );

  beforeAll(async () => {
    pos = postgres(POS_DB_URL as string, { onnotice: () => {}, max: 2 });
    erp = postgres(ERP_DB_URL, { onnotice: () => {}, max: 2 });
    db = drizzle(pos) as unknown as TestDb;
    // RealErpAdapter 在构造时读 ERP_DATABASE_URL，构造前必须先设好
    process.env.ERP_DATABASE_URL = ERP_DB_URL;
    sync = new PromotionSyncService(db as never);

    // 建一张独立 schema 承载本用例的 fixture，public 一个字都不动。
    // 原因：本机 pos_db 的 public 里躺着一张早前实验遗留的 pos_sync_log，
    // 用的是 created_at/updated_at 而非平台约定的 _created_at/_updated_at，
    // 逐列 ALTER 补齐等于给"错误的结构"打补丁；真机库本就更该用平台 schema。
    await pos.unsafe('CREATE SCHEMA IF NOT EXISTS wave4c_e2e');
    await pos.unsafe('SET search_path = wave4c_e2e');
  });

  afterAll(async () => {
    if (!pos || !erp) return;
    // 清理是硬要求：促销表会直接决定收银台算出来的优惠，残留测试数据就是资损隐患。
    // 只删本用例 fixture schema 里的内容；ERP 侧按主键精确删。
    await pos`delete from pos_promotion where erp_promotion_id in (${P_FULL}, ${P_RATE}, ${P_OFF})`;
    await pos`delete from pos_sync_log where data_type = 'promotions'`;
    await pos`drop schema if exists wave4c_e2e cascade`;
    await erp`delete from promotion where id in (${P_FULL}, ${P_RATE}, ${P_OFF})`;
    await Promise.all([pos.end({ immediate: true }), erp.end({ immediate: true })]);
  });

  it('真实读 ERP → 真库落库 → 幂等 → 墓碑 → 复活 → 计价上限，全链路成立', async () => {
    // 2) 真库建表（DDL 与 pglite 夹具共用同一份定义，避免两边漂移）
    //    平台自定义复合类型 user_profile 在 plain postgres 里并不存在（它只存在于
    //    aPaaS 托管的 pos 库中），先幂等建出来，否则 pos_promotion 建不了。
    await pos.unsafe(`DO $$ BEGIN
  CREATE TYPE user_profile AS (user_id text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`);
    await pos.unsafe(POS_PROMOTION_DDL);
    // syncDownstream 成功后会写同步日志（含 payload jsonb），本机 scratch 库没有这张表，
    // 补齐最小定义——否则真链路验证会在最后一步卡在日志写入上。
    // 用「先建再 ALTER IF NOT EXISTS」而不是先 DROP：真机库里这张表可能有历史数据，
    // DROP 会直接把线上同步日志删掉。
    // 平台 schema 的 pos_sync_log（syncDownstream 成功后会写一条）
    await pos.unsafe(`CREATE TABLE IF NOT EXISTS pos_sync_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      direction varchar(10) NOT NULL,
      data_type varchar(50) NOT NULL,
      doc_no varchar(100),
      status varchar(20) NOT NULL,
      response text,
      payload jsonb,
      retry_count integer NOT NULL DEFAULT 0,
      duration_ms integer,
      _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by user_profile DEFAULT NULL,
      _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by user_profile DEFAULT NULL
    );
    -- 同步结束时 auditAction 会写操作日志，同样在 fixture schema 内补齐，
    -- 否则每次真链路上都刷一条"操作日志写入失败"的 stderr 噪音。
    CREATE TABLE IF NOT EXISTS pos_operation_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id varchar(50),
      employee_id uuid,
      module varchar(50) NOT NULL,
      action varchar(50) NOT NULL,
      target_no varchar(100),
      content text,
      _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by user_profile DEFAULT NULL,
      _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by user_profile DEFAULT NULL
    )`);

    // 2) 在真实 ERP 库种 3 条促销（1 停用），不走任何 mock
    await erp`
      insert into promotion (id, code, name, type, threshold, reduce_amount, discount_rate,
            begin_date, end_date, store_ids, priority, status, _created_at, _updated_at)
      values
        (${P_FULL}::uuid, 'E2E-FULL', 'E2E满减', 'full_reduction', 0, 30, 1,
         null, null, '["ST-A"]'::jsonb, 10, 'active', now(), now()),
        (${P_RATE}::uuid, 'E2E-RATE', 'E2E折扣', 'discount', 0, 0, 0.8,
         null, null, '[]'::jsonb, 5, 'active', now(), now()),
        (${P_OFF}::uuid, 'E2E-OFF', 'E2E停用', 'full_reduction', 0, 50, 1,
         null, null, '[]'::jsonb, 1, 'inactive', now(), now())
      on conflict (id) do nothing`;

    // 3) 真实适配器读 ERP（跨库 postgres-js）
    process.env.ERP_DATABASE_URL = ERP_DB_URL;
    const adapter = new RealErpAdapter();
    const rows = await adapter.getPromotions();
    expect(rows.length).toBe(2); // 停用的那条必须不在
    expect(rows.map((r) => r.erpPromotionId).sort()).toEqual([P_FULL, P_RATE].sort());
    expect(rows.find((r) => r.erpPromotionId === P_RATE)?.discountRate).toBe(0.8);

    // 4) 落库
    sync = new PromotionSyncService(db as never);
    const first = await sync.sync({ rows, mode: 'snapshot' });
    expect(first.upserted).toBe(2);
    expect(first.skipped).toBe(0);

    const saved = await db.select().from(posPromotion);
    const full = saved.find((r) => r.erpPromotionId === P_FULL)!;
    const rate = saved.find((r) => r.erpPromotionId === P_RATE)!;
    expect(saved.length).toBe(2);
    // 满减：金额转成分（30 元 → 3000 分）；折扣：百分率整数（8 折 → 80）
    expect(full.type).toBe('full_reduce');
    expect(full.discountValue).toBe(3000);
    expect(full.applyScope).toBe('scoped');
    expect(full.scopeIds).toEqual(['ST-A']);
    expect(rate.type).toBe('full_discount');
    expect(rate.discountValue).toBe(80);
    expect(rate.applyScope).toBe('all');

    // 5) 幂等：同一批再同步一次，必须还是 2 行（重复行 = 收银台叠加两次满减）
    const again = await sync.sync({ rows, mode: 'snapshot' });
    expect(again.upserted).toBe(2);
    expect((await db.select().from(posPromotion)).length).toBe(2);

    // 6) 墓碑：ERP 侧停用 P_FULL，下一轮快照把它下架
    await erp`update promotion set status = 'inactive' where id = ${P_FULL}::uuid`;
    const tomb = await sync.sync({ rows: (await adapter.getPromotions()).filter((r) => r.erpPromotionId !== P_FULL), mode: 'snapshot' });
    expect(tomb.tombstoned).toBe(1);
    const tombstoned = (await db.select().from(posPromotion)).find((r) => r.erpPromotionId === P_FULL)!;
    expect(tombstoned.deletedAt).not.toBeNull();

    // 7) 复活：ERP 重新启用，deleted_at 必须清空
    await erp`update promotion set status = 'active' where id = ${P_FULL}::uuid`;
    await sync.sync({ rows: await adapter.getPromotions(), mode: 'snapshot' });
    const revived = (await db.select().from(posPromotion)).find((r) => r.erpPromotionId === P_FULL)!;
    expect(revived.deletedAt).toBeNull();

    // 8) 计价上限：200 元小计。
    //    ST-A：优先级高的满减先扣（20000 → 17000），折扣再打在**剩余额**上
    //          （17000 × 20% = 3400）→ 合计 6400。故意不按原小计重复打折，
    //          否则「满减 + 折扣」会按同一基数算两遍，优惠额虚高。
    //    ST-B：满减只适用 ST-A，折扣全店生效 → 只剩 8 折 = 4000。
    const promos = await livePromos();
    const atA = evaluatePromotions(promos, { storeId: 'ST-A', subtotalCents: 20000 });
    const atB = evaluatePromotions(promos, { storeId: 'ST-B', subtotalCents: 20000 });
    expect(atA.capCents).toBe(6400);
    expect(atB.capCents).toBe(4000);

    // 9) 走真实编排出口：POS 的 syncDownstream('promotions')（原来这是个只返回
    //    count 的空桩，PromotionSyncService 根本不会被调用）
    const orchestration = new ErpIntegrationService(
      db as never,
      new MockErpService(),
      adapter,
      sync,
    );
    const out = await orchestration.syncDownstream('promotions');
    expect(out.success).toBe(true);
    // 编排出口只回 { success, count }，业务文案记在 pos_sync_log.response
    const [log] = await pos`select response from pos_sync_log where data_type = 'promotions' order by _created_at desc limit 1`;
    expect(log.response).toContain('同步 2 个促销活动成功');
    // 编排出口跑完，真库里仍应恰好 2 行（幂等，未产生第二份）
    expect((await db.select().from(posPromotion)).length).toBe(2);
  }, 30_000);
});
