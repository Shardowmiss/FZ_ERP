import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { eq, isNull, isNotNull } from 'drizzle-orm';
import { posMember } from '@server/database/schema';
import { ErpIntegrationService } from './erp-integration.service';
import type { MockErpService } from './mock-erp.service';
import type { RealErpAdapter } from './real-erp.adapter';
import type { PromotionSyncService } from './promotion-sync.service';

/**
 * S2 身份锚点：会员下行必须以 **ERP 主键 `erp_member_id`** 为唯一真相。
 *
 * 改造前以业务键 `member_no` 为 ON CONFLICT 目标，会员号在 ERP 侧一改
 * （合并 / 重编 / 录入纠错），同一自然人就会被当成新会员再插一行，
 * 档案与积分随之分裂 —— 业务键不是稳定身份。
 *
 * 本文件的每条断言都对应一条真实的档案分裂路径。
 */
describe('会员下行 身份锚点（S2）', () => {
  let t: TestDb;
  let svc: ErpIntegrationService;
  let feed: ErpMemberRow[] = [];
  let seq = 0;

  const erpRow = (over: Partial<ErpMemberRow> = {}): ErpMemberRow => ({
    // erp_member_id 列是 uuid，必须用合法 UUID（否则 PG 报 invalid input syntax for uuid）
    erpMemberId: uuid(++seq),
    memberNo: 'M-001',
    name: '张三',
    phone: '13800000001',
    gender: 'male',
    birthday: '1990-01-01',
    level: 'normal',
    points: 0,
    storedValue: 0,
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

  const rowsByAnchor = (erpId: string) =>
    t.db.select().from(posMember).where(eq(posMember.erpMemberId, erpId));

  it('1) ERP 侧改会员号：同一 erpMemberId 不得插成第二行（核心分裂防线）', async () => {
    // 门店已有会员 M-A，首次同步建立锚点
    const ERP_RENAME = uuid(101);
    feed = [erpRow({ erpMemberId: ERP_RENAME, memberNo: 'M-A', phone: '13811100001', name: '张三' })];
    await svc.syncDownstream('members');

    // ERP 侧把会员号改成 M-B（同一个 erpMemberId）
    feed = [erpRow({ erpMemberId: ERP_RENAME, memberNo: 'M-B', phone: '13811100001', name: '张三改名' })];
    await svc.syncDownstream('members');

    const rows = await rowsByAnchor(ERP_RENAME);
    expect(rows).toHaveLength(1); // 绝不能变成两行
    // 门店会员号一旦生成就不再被 ERP 改写（set 不含 memberNo）
    expect(rows[0].memberNo).toBe('M-A');
    // 但档案字段照常同步
    expect(rows[0].name).toBe('张三改名');
  });

  it('2) 存量行回填：老数据（无锚点）按 memberNo 精确匹配补上 erp_member_id', async () => {
    await t.db.insert(posMember).values({
      memberNo: 'M-LEGACY',
      name: '老会员',
      phone: '13822200002',
      level: 'normal',
      points: 66,
      storedValue: 1234,
    });

    const ERP_LEGACY = uuid(102);
    feed = [erpRow({ erpMemberId: ERP_LEGACY, memberNo: 'M-LEGACY', phone: '13822200002', name: '老会员(ERP)' })];
    await svc.syncDownstream('members');

    const rows = await rowsByAnchor(ERP_LEGACY);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberNo).toBe('M-LEGACY');
    expect(rows[0].name).toBe('老会员(ERP)');
    // 回填不能动资金余额（S1 语义在此同样成立）
    expect(rows[0].points).toBe(66);
    expect(rows[0].storedValue).toBe(1234);

    // 回填后再同步一次必须幂等
    await svc.syncDownstream('members');
    expect(await rowsByAnchor(ERP_LEGACY)).toHaveLength(1);
  });

  it('3) 锚点必填：缺少 erpMemberId 的源行必须跳过，不得插入（否则每次同步都插新行）', async () => {
    feed = [erpRow({ erpMemberId: '', memberNo: 'M-NOANCHOR', phone: '13833300003' })];

    const r = await svc.syncDownstream('members');

    expect(r.success).toBe(true);
    expect(r.count).toBe(0);
    const rows = await t.db
      .select()
      .from(posMember)
      .where(eq(posMember.memberNo, 'M-NOANCHOR'));
    expect(rows).toHaveLength(0);
  });

  it('4) 门店本地新建会员没有锚点：多个 NULL 共存，不得互相冲突', async () => {
    await t.db.insert(posMember).values({
      memberNo: 'M-LOCAL-1',
      name: '门店A',
      phone: '13844400004',
    });
    await t.db.insert(posMember).values({
      memberNo: 'M-LOCAL-2',
      name: '门店B',
      phone: '13844400005',
    });

    const rows = await t.db
      .select()
      .from(posMember)
      .where(isNull(posMember.erpMemberId));
    // 唯一索引允许多个 NULL：本地会员不受影响
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const anchored = await t.db
      .select()
      .from(posMember)
      .where(isNotNull(posMember.erpMemberId));
    expect(anchored.length).toBeGreaterThan(0);
  });

  it('5) 两条不同 ERP 会员撞同一手机号：第二条被隔离，第一条照常落库', async () => {
    const ERP_C1 = uuid(103);
    const ERP_C2 = uuid(104);
    feed = [
      erpRow({ erpMemberId: ERP_C1, memberNo: 'M-C1', phone: '13855500006', name: '会员C1' }),
      erpRow({ erpMemberId: ERP_C2, memberNo: 'M-C2', phone: '13855500006', name: '会员C2' }), // 撞号
    ];

    const r = await svc.syncDownstream('members');

    expect(r.success).toBe(true);
    const c1 = await rowsByAnchor(ERP_C1);
    expect(c1).toHaveLength(1);
    const c2 = await rowsByAnchor(ERP_C2);
    expect(c2).toHaveLength(0); // 撞号者被隔离，但整批没有失败
  });
});

/** 生成确定性的合法 UUID（erp_member_id 是 uuid 列） */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 与 MockErpService.getMembers() 单行结构保持一致 */
interface ErpMemberRow {
  erpMemberId: string;
  memberNo: string;
  name: string;
  phone: string;
  gender: string;
  birthday: string;
  level: string;
  points: number;
  storedValue: number;
}
