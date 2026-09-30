import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { eq } from 'drizzle-orm';
import { posMember } from '@server/database/schema';
import { ErpIntegrationService } from './erp-integration.service';
import type { MockErpService } from './mock-erp.service';
import type { RealErpAdapter } from './real-erp.adapter';
import type { PromotionSyncService } from './promotion-sync.service';

/**
 * S1 资金护栏：会员下行同步**不得**吞掉门店侧的积分与储值。
 *
 * 每一条断言都对应一条真实资损路径
 * （详见《ERP_POS_数据单轨收口-评估与设计方案.md》第 4.2 节）：
 *  - **储值清零**：真实适配器读取的 ERP `member` 表**根本没有 storedValue 字段**，
 *    取数恒为 0（real-erp.adapter.ts:229 注释 / :257 `storedValue: 0`）。
 *    若下行同步覆盖 `stored_value`，会员储值余额会被**清零**——这是资金事故，不是数据偏差。
 *  - **积分抹平**：ERP 的 `points` 是上一次快照，覆盖会抹掉门店已累加的
 *    （sales / returns / omnichannel 各自累加）积分。
 *
 * 改造后语义：档案字段照常同步；「已存在会员」的资金类余额由门店营运保有，
 * 「新会员」仍取 ERP 初始值。最终单轨收口见 S3。
 */
describe('会员下行同步 资金护栏（S1）', () => {
  let t: TestDb;
  let svc: ErpIntegrationService;
  /** 下行数据源：各用例自行设置，模拟 ERP/真实适配器返回的形态 */
  let feed: ErpMemberRow[] = [];

  /** 模拟「真实 ERP」返回：旧的积分快照 + 恒 0 的储值 */
  const erpRow = (over: Partial<ErpMemberRow> = {}): ErpMemberRow => ({
    memberNo: 'M-001',
    name: '张三(ERP最新)',
    phone: '13800000001',
    gender: 'male',
    birthday: '1990-01-01',
    level: 'gold',
    points: 5, // ERP 侧旧快照
    storedValue: 0, // ERP 无此字段，真实适配器恒 0
    ...over,
  });

  beforeAll(async () => {
    t = await setupTestDb();
    const mockStub = {
      getMembers: async () => ({ members: feed, total: feed.length }),
    } as unknown as MockErpService;
    svc = new ErpIntegrationService(
      t.db,
      mockStub,
      {} as unknown as RealErpAdapter,
      {} as unknown as PromotionSyncService,
    );
  });

  afterAll(async () => {
    await t.pg.close();
  });

  const rowOf = async (memberNo: string): Promise<Record<string, any>> => {
    const rows = await t.db
      .select()
      .from(posMember)
      .where(eq(posMember.memberNo, memberNo));
    return rows[0] as Record<string, any>;
  };

  it('1) 已存在会员：门店积分/储值不能被 ERP 下行抹掉，但档案字段仍要同步', async () => {
    // 门店侧现状：本地消费攒了 120 分，储值余额 5000 分（= 50 元）
    await t.db.insert(posMember).values({
      memberNo: 'M-KEEP',
      name: '张三',
      phone: '13800000001',
      level: 'normal',
      points: 120,
      storedValue: 5000,
    });
    feed = [erpRow({ memberNo: 'M-KEEP' })];

    await svc.syncDownstream('members');

    const row = await rowOf('M-KEEP');
    expect(row.points).toBe(120); // 未被 ERP 旧快照 5 覆盖
    expect(row.storedValue).toBe(5000); // 未被 ERP 的 0 清零  ← 核心资损防线
    expect(row.name).toBe('张三(ERP最新)'); // 档案字段照常同步
    expect(row.level).toBe('gold');
  });

  it('2) 新会员：INSERT 分支仍须写入 ERP 的初始积分与储值', async () => {
    // 注意：pos_member.phone 有唯一索引，各用例必须用不同手机号，
    // 否则会命中「非冲突目标列」的唯一约束，使整批同步失败（见下方第 4 条用例的说明）。
    feed = [erpRow({ memberNo: 'M-NEW', phone: '13800000002', points: 30, storedValue: 0 })];

    await svc.syncDownstream('members');

    const row = await rowOf('M-NEW');
    expect(row.points).toBe(30);
    expect(row.storedValue).toBe(0);
    expect(row.name).toBe('张三(ERP最新)');
  });

  it('3) 幂等：同一批会员重复同步不得产生重复行', async () => {
    feed = [erpRow({ memberNo: 'M-IDEM', phone: '13800000003' })];
    await svc.syncDownstream('members');
    await svc.syncDownstream('members');

    const rows = await t.db
      .select()
      .from(posMember)
      .where(eq(posMember.memberNo, 'M-IDEM'));
    expect(rows).toHaveLength(1);
  });

  /**
   * 4) **已知缺口的特征测试（记录现状，非期望行为）**
   *
   * upsert 的冲突目标只有 `memberNo`，而 `phone` 另有唯一索引。
   * 因此当 ERP 某会员的手机号与 POS 中**另一个**会员撞号时，
   * 会命中非冲突目标列的唯一约束 → 整批会员同步失败（异常被 catch，仅日志 status=failed）。
   *
   * 这意味着「一个会员手机号填错」足以让全店会员同步停摆且不告警。
   * 该缺口应在 S2（身份锚点）一并处理：把冲突目标收敛到 erp_member_id，
   * 并对 phone 冲突做定向跳过/冲突上报，而不是整批放弃。
   */
  it('4) 已知缺口：跨会员手机号撞号会导致整批同步失败（当前行为）', async () => {
    feed = [erpRow({ memberNo: 'M-PHONE', phone: '13800000001' })]; // 与 M-KEEP 撞号

    const r = await svc.syncDownstream('members');

    expect(r.success).toBe(false);
    const rows = await t.db
      .select()
      .from(posMember)
      .where(eq(posMember.memberNo, 'M-PHONE'));
    expect(rows).toHaveLength(0);
  });
});

/** 与 MockErpService.getMembers() 单行结构保持一致 */
interface ErpMemberRow {
  memberNo: string;
  name: string;
  phone: string;
  gender: string;
  birthday: string;
  level: string;
  points: number;
  storedValue: number;
}
