import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { eq, and } from 'drizzle-orm';
import { posMember, posSyncConflict } from '@server/database/schema';
import { ErpIntegrationService } from './erp-integration.service';
import type { MockErpService } from './mock-erp.service';
import type { RealErpAdapter } from './real-erp.adapter';
import type { PromotionSyncService } from './promotion-sync.service';

/**
 * W2-3 集成测试：离线冲突智能合并。
 *
 * 验证两件事：
 *  ① 字段级 LWW —— 门店在「上次同步基线」之后编辑过的标量字段，ERP 下行不同值时
 *     不得被覆盖，而是落入 `pos_sync_conflict` 收件箱待人工仲裁；资金字段永不入箱、
 *     永不覆盖（沿用 S1 资损护栏）。
 *  ② 仲裁闭环 —— resolveConflict('erp'|'pos'|'merge') 落值 + 推进基线 + 标记 resolved；
 *     其中 'pos'（保留本地）必须**耐久**：下次同步不得把人工决定无声回写覆盖
 *     （这是 W2-3 修复点，回归用例覆盖）。
 *
 * 测试底座同 member-money-guard.spec.ts：直连 pglite、实例化 service、mock getMembers。
 */
describe('W2-3 离线冲突合并（收件箱 + 字段级 LWW + 仲裁）', () => {
  let t: TestDb;
  let svc: ErpIntegrationService;
  let feed: ErpMemberRow[] = [];

  let seq = 0;
  const erpRow = (over: Partial<ErpMemberRow> = {}): ErpMemberRow => ({
    erpMemberId: uuid(++seq),
    memberNo: 'M-X',
    name: 'ERP名',
    phone: '13800000000',
    gender: 'male',
    birthday: '1990-01-01',
    level: 'normal',
    points: 5,
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

  // 每个用例独立：清空会员表与收件箱，避免跨用例残留干扰锚点匹配
  beforeEach(async () => {
    await t.db.delete(posSyncConflict);
    await t.db.delete(posMember);
    feed = [];
    seq = 0;
  });

  const insertStored = async (p: {
    id: string;
    memberNo: string;
    name: string;
    phone: string;
    erpMemberId: string;
    erpSyncAt: string; // 固定旧基线
  }) => {
    await t.db.insert(posMember).values({
      id: p.id,
      memberNo: p.memberNo,
      name: p.name,
      phone: p.phone,
      gender: 'male',
      birthday: '1990-01-01',
      level: 'normal',
      points: 100,
      storedValue: 5000,
      erpMemberId: p.erpMemberId,
      erpSyncAt: new Date(p.erpSyncAt),
    });
  };

  const rowOf = async (id: string) => {
    const rows = await t.db.select().from(posMember).where(eq(posMember.id, id));
    return rows[0] as Record<string, any>;
  };

  const pendingCount = async (entityId: string) =>
    (
      await t.db
        .select()
        .from(posSyncConflict)
        .where(
          and(eq(posSyncConflict.entityId, entityId), eq(posSyncConflict.status, 'pending')),
        )
    ).length;

  it('1) 本地在基线后改过 name → ERP 不同值：本地保留、入收件箱、资金不触', async () => {
    const id = uuid(9001);
    const erpId = uuid(7001);
    await insertStored({
      id,
      memberNo: 'M-CONF',
      name: '本地张三',
      phone: '13800000901',
      erpMemberId: erpId,
      erpSyncAt: '2020-01-01T00:00:00.000Z',
    });
    // 仅 name 不同，其余标量字段与本地一致 → 仅产生 1 条冲突
    feed = [
      erpRow({
        erpMemberId: erpId,
        memberNo: 'M-CONF',
        name: 'ERP张三',
        phone: '13800000901',
        gender: 'male',
        birthday: '1990-01-01',
        level: 'normal',
      }),
    ];

    await svc.syncDownstream('members');

    const row = await rowOf(id);
    expect(row.name).toBe('本地张三'); // 核心：本地值未被 ERP 覆盖
    expect(row.points).toBe(100); // 资金字段 untouched
    expect(row.storedValue).toBe(5000);

    const list = await svc.listConflicts({ status: 'pending' });
    expect(list).toHaveLength(1);
    expect(list[0].field).toBe('name');
    expect(list[0].entityId).toBe(id);
    expect(list[0].posValue).toBe('本地张三');
    expect(list[0].erpValue).toBe('ERP张三');
    expect(list[0].storeId).toBeNull(); // 会员为全局主数据
    expect(list[0].status).toBe('pending');
  });

  it('2) 幂等：相同冲突重复同步不重复写入收件箱', async () => {
    const id = uuid(9001);
    const erpId = uuid(7001);
    await insertStored({
      id,
      memberNo: 'M-CONF',
      name: '本地张三',
      phone: '13800000901',
      erpMemberId: erpId,
      erpSyncAt: '2020-01-01T00:00:00.000Z',
    });
    feed = [
      erpRow({
        erpMemberId: erpId,
        memberNo: 'M-CONF',
        name: 'ERP张三',
        phone: '13800000901',
        gender: 'male',
        birthday: '1990-01-01',
        level: 'normal',
      }),
    ];

    await svc.syncDownstream('members');
    await svc.syncDownstream('members');

    expect(await pendingCount(id)).toBe(1); // 去重生效，无重复告警
  });

  it('3) 仲裁 erp → 采用 ERP 值、标记 resolved、再同步稳定不重复', async () => {
    const id = uuid(9001);
    const erpId = uuid(7001);
    await insertStored({
      id,
      memberNo: 'M-CONF',
      name: '本地张三',
      phone: '13800000901',
      erpMemberId: erpId,
      erpSyncAt: '2020-01-01T00:00:00.000Z',
    });
    feed = [
      erpRow({
        erpMemberId: erpId,
        memberNo: 'M-CONF',
        name: 'ERP张三',
        phone: '13800000901',
        gender: 'male',
        birthday: '1990-01-01',
        level: 'normal',
      }),
    ];

    await svc.syncDownstream('members');
    const [c] = await svc.listConflicts({ status: 'pending' });
    const resolved = await svc.resolveConflict(c.id, 'erp');

    const row = await rowOf(id);
    expect(row.name).toBe('ERP张三'); // 采用 ERP 值
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('erp');

    // 再同步：ERP 值未变 → 不应产生新冲突，本地保持 ERP 值
    await svc.syncDownstream('members');
    const row2 = await rowOf(id);
    expect(row2.name).toBe('ERP张三');
    expect(await pendingCount(id)).toBe(0); // 仅余 1 条 resolved，无新 pending
    const all = await svc.listConflicts({ status: 'resolved' });
    expect(all).toHaveLength(1);
  });

  it('4) 仲裁 merge → 写入合并值并标记 resolved', async () => {
    const id = uuid(9002);
    const erpId = uuid(7002);
    await insertStored({
      id,
      memberNo: 'M-MERGE',
      name: '本地李四',
      phone: '13800000902',
      erpMemberId: erpId,
      erpSyncAt: '2020-01-01T00:00:00.000Z',
    });
    feed = [
      erpRow({
        erpMemberId: erpId,
        memberNo: 'M-MERGE',
        name: 'ERP李四',
        phone: '13800000902',
        gender: 'male',
        birthday: '1990-01-01',
        level: 'normal',
      }),
    ];

    await svc.syncDownstream('members');
    const [c] = await svc.listConflicts({ status: 'pending' });
    const resolved = await svc.resolveConflict(c.id, 'merge', { mergedValue: '合并李四' });

    const row = await rowOf(id);
    expect(row.name).toBe('合并李四');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('merge');
  });

  it('5) 仲裁 pos（保留本地）必须耐久：再同步不得无声回写覆盖', async () => {
    const id = uuid(9003);
    const erpId = uuid(7003);
    await insertStored({
      id,
      memberNo: 'M-POS',
      name: '本地王五',
      phone: '13800000903',
      erpMemberId: erpId,
      erpSyncAt: '2020-01-01T00:00:00.000Z',
    });
    // ERP 持续下发不同值，模拟「之后还在同步」
    const makeFeed = () =>
      erpRow({
        erpMemberId: erpId,
        memberNo: 'M-POS',
        name: 'ERP王五',
        phone: '13800000903',
        gender: 'male',
        birthday: '1990-01-01',
        level: 'normal',
      });
    feed = [makeFeed()];

    await svc.syncDownstream('members');
    const [c] = await svc.listConflicts({ status: 'pending' });
    const resolved = await svc.resolveConflict(c.id, 'pos');

    const row = await rowOf(id);
    expect(row.name).toBe('本地王五'); // 保留本地
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('pos');

    // 再同步（ERP 仍下发不同值）：本地值必须保持、且不得产生新 pending 行
    feed = [makeFeed()];
    await svc.syncDownstream('members');
    const row2 = await rowOf(id);
    expect(row2.name).toBe('本地王五'); // ← 修复点：不得被 ERP 静默覆盖
    expect(await pendingCount(id)).toBe(0); // resolved 行去重，不重复告警
  });

  it('6) 不存在的冲突 id 抛错；已 resolved 行幂等返回', async () => {
    await expect(svc.resolveConflict('00000000-0000-4000-8000-000000000000', 'erp')).rejects.toThrow();

    const id = uuid(9001);
    const erpId = uuid(7001);
    await insertStored({
      id,
      memberNo: 'M-CONF',
      name: '本地张三',
      phone: '13800000901',
      erpMemberId: erpId,
      erpSyncAt: '2020-01-01T00:00:00.000Z',
    });
    feed = [
      erpRow({
        erpMemberId: erpId,
        memberNo: 'M-CONF',
        name: 'ERP张三',
        phone: '13800000901',
        gender: 'male',
        birthday: '1990-01-01',
        level: 'normal',
      }),
    ];
    await svc.syncDownstream('members');
    const [c] = await svc.listConflicts({ status: 'pending' });
    const r1 = await svc.resolveConflict(c.id, 'erp');
    const r2 = await svc.resolveConflict(c.id, 'erp'); // 幂等
    expect(r1.status).toBe('resolved');
    expect(r2.id).toBe(r1.id);
  });
});

/** 生成确定性的合法 UUID（erp_member_id / pos_member.id 都是 uuid 列） */
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
