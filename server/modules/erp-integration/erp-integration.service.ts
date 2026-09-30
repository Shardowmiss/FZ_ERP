import { toCents } from '@server/database/money';
import { auditAction } from '@server/common/audit';
import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import {
  posSyncLog,
  posStyle,
  posColor,
  posSize,
  posSku,
  posPromotion,
  posMember,
  posTransfer,
  posTransferItem,
} from '@server/database/schema';
import { eq, and, count, desc, sql, gte, lte, inArray, or, isNull } from 'drizzle-orm';
import { chunk, BATCH_SIZE } from '@server/common/batch';
import { MockErpService } from './mock-erp.service';
import { RealErpAdapter } from './real-erp.adapter';
import { PromotionSyncService } from './promotion-sync.service';
import type {
  ErpConnectionStatus,
  ErpSyncStatus,
  SyncLog,
  ListResponse,
  SyncLogQuery,
} from '@shared/api.interface';

/**
 * 下行会员源行。类型直接派生自适配器返回值，
 * 适配器新增/改名列时这里会跟着变，避免两处定义漂移。
 */
type ErpMemberFeedRow = Awaited<
  ReturnType<MockErpService['getMembers']>
>['members'][number];

/** 被隔离的冲突行（只跳过自己，不影响同批其余会员） */
interface MemberSyncConflict {
  memberNo: string;
  reason: string;
}

@Injectable()
export class ErpIntegrationService {
  private readonly logger = new Logger(ErpIntegrationService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mockErpService: MockErpService,
    private readonly realErpAdapter: RealErpAdapter,
    private readonly promotionSync: PromotionSyncService,
    ) {
    this.db = scopeDatabase(this.db);
  }

  async getConnectionStatus(): Promise<ErpConnectionStatus> {
    const connected = this.mockErpService.isConnected();

    // 统计同步状态
    const [downstreamResult, upstreamPendingResult, upstreamFailedResult] =
      await Promise.all([
        this.db
          .select({ count: count() })
          .from(posSyncLog)
          .where(eq(posSyncLog.direction, 'downstream')),
        this.db
          .select({ count: count() })
          .from(posSyncLog)
          .where(
            and(
              eq(posSyncLog.direction, 'upstream'),
              eq(posSyncLog.status, 'pending'),
            ),
          ),
        this.db
          .select({ count: count() })
          .from(posSyncLog)
          .where(
            and(
              eq(posSyncLog.direction, 'upstream'),
              eq(posSyncLog.status, 'failed'),
            ),
          ),
      ]);

    return {
      connected,
      lastHeartbeat: connected ? new Date().toISOString() : undefined,
      mode: connected ? 'online' : 'offline',
      downstreamCount: Number(downstreamResult[0]?.count ?? 0),
      upstreamPending: Number(upstreamPendingResult[0]?.count ?? 0),
      upstreamFailed: Number(upstreamFailedResult[0]?.count ?? 0),
    };
  }

  async toggleConnection(online: boolean, operatorId?: string | null): Promise<ErpConnectionStatus> {
    this.mockErpService.setConnected(online);
    // P0-2：ERP 连接开关审计
    await auditAction(this.db, {
      storeId: null,
      employeeId: operatorId ?? null,
      module: 'erp',
      action: 'toggle_connection',
      targetNo: online ? 'online' : 'offline',
      content: { online },
    });
    return this.getConnectionStatus();
  }

  async getDownstreamStatus(): Promise<ErpSyncStatus[]> {
    const dataTypes = [
      { type: 'styles', name: '商品主数据' },
      { type: 'prices', name: '价格数据' },
      { type: 'promotions', name: '促销活动' },
      { type: 'members', name: '会员信息' },
      { type: 'stock', name: '库存数据' },
      { type: 'transfers', name: '调拨单据' },
    ];

    const statuses: ErpSyncStatus[] = [];

    for (const dt of dataTypes) {
      const [latest, stats] = await Promise.all([
        this.db
          .select()
          .from(posSyncLog)
          .where(
            and(
              eq(posSyncLog.direction, 'downstream'),
              eq(posSyncLog.dataType, dt.type),
            ),
          )
          .orderBy(desc(posSyncLog.createdAt))
          .limit(1),
        this.db
          .select({
            status: posSyncLog.status,
            count: count(),
          })
          .from(posSyncLog)
          .where(
            and(
              eq(posSyncLog.direction, 'downstream'),
              eq(posSyncLog.dataType, dt.type),
            ),
          )
          .groupBy(posSyncLog.status),
      ]);

      const successCount = stats.find((s) => s.status === 'success')?.count ?? 0;
      const failedCount = stats.find((s) => s.status === 'failed')?.count ?? 0;
      const pendingCount = stats.find((s) => s.status === 'pending')?.count ?? 0;
      const totalCount =
        Number(successCount) + Number(failedCount) + Number(pendingCount);

      statuses.push({
        dataType: dt.type,
        dataName: dt.name,
        direction: 'downstream',
        lastSyncAt: latest[0]?.createdAt?.toISOString(),
        lastSyncStatus: latest[0]?.status ?? 'never',
        totalCount,
        successCount: Number(successCount),
        failedCount: Number(failedCount),
        pendingCount: Number(pendingCount),
      });
    }

    return statuses;
  }

  async syncDownstream(type: string, operatorId?: string | null): Promise<{ success: boolean; count: number }> {
    const startTime = Date.now();
    let count = 0;
    let success = true;
    let response = '';

    try {
      switch (type) {
        case 'styles': {
          const data = await this.mockErpService.getStyles();
          count = data.total;
          // P1-4：整批主数据写入包在一个事务里；中途任一步失败整体回滚，
          // 避免「颜色已写、款式写到一半崩溃」留下半成品主数据。
          // 注意：mockErpService.getStyles() 的网络调用在事务外，避免长事务。
          // P1-5：原先颜色/尺码/款式/SKU 在循环内逐行 insert（N+1 写尖峰），
          // 在百店全量同步时形成海量往返；改为分批批量 upsert（每批 BATCH_SIZE）。
          await this.db.transaction(async (tx) => {
            // 同步颜色（分批 upsert）
            if (data.colors.length > 0) {
              const colorValues = data.colors.map((c) => ({
                id: c.id,
                name: c.name,
                hex: c.hex,
              }));
              for (const batch of chunk(colorValues, BATCH_SIZE)) {
                await tx
                  .insert(posColor)
                  .values(batch)
                  .onConflictDoUpdate({
                    target: posColor.id,
                    set: { name: sql`excluded.name`, hex: sql`excluded.hex` },
                  });
              }
            }
            // 同步尺码（分批 upsert）
            if (data.sizes.length > 0) {
              const sizeValues = data.sizes.map((s) => ({
                id: s.id,
                sortOrder: s.sortOrder,
              }));
              for (const batch of chunk(sizeValues, BATCH_SIZE)) {
                await tx
                  .insert(posSize)
                  .values(batch)
                  .onConflictDoUpdate({
                    target: posSize.id,
                    set: { sortOrder: sql`excluded.sort_order` },
                  });
              }
            }
            // 收集 SKU（数量最大，最后统一分批 upsert）
            const skuValues: Array<{
              id: string;
              styleId: string;
              colorId: string;
              sizeId: string;
              barcode: string;
            }> = [];
            // 同步款式（逐条 upsert：款式行数远小于 SKU，且需 set 多列）
            for (const style of data.styles) {
              await tx
                .insert(posStyle)
                .values({
                  id: style.id,
                  name: style.name,
                  category: style.category,
                  colorIds: style.colorIds,
                  sizeIds: style.sizeIds,
                  tagPrice: toCents(Number(style.tagPrice)),
                  costPrice: toCents(Number(style.costPrice)),
                  status: style.status,
                  erpSyncAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: posStyle.id,
                  set: {
                    name: sql`excluded.name`,
                    category: sql`excluded.category`,
                    colorIds: sql`excluded.color_ids`,
                    sizeIds: sql`excluded.size_ids`,
                    tagPrice: sql`excluded.tag_price`,
                    costPrice: sql`excluded.cost_price`,
                    status: sql`excluded.status`,
                    erpSyncAt: sql`excluded.erp_sync_at`,
                  },
                });
              // 生成 SKU
              for (const colorId of style.colorIds) {
                for (const sizeId of style.sizeIds) {
                  const skuId = `${style.id}-${colorId}-${sizeId}`;
                  skuValues.push({
                    id: skuId,
                    styleId: style.id,
                    colorId,
                    sizeId,
                    barcode: skuId,
                  });
                }
              }
            }
            // SKU 批量 upsert（数量最大，必须分批）
            for (const batch of chunk(skuValues, BATCH_SIZE)) {
              await tx
                .insert(posSku)
                .values(batch)
                .onConflictDoUpdate({
                  target: posSku.id,
                  set: { colorId: sql`excluded.color_id`, sizeId: sql`excluded.size_id` },
                });
            }
          });
          response = `同步 ${data.total} 个款式成功`;
          break;
        }
        case 'promotions': {
          // Wave 4-C：由「只取 count 的空桩」改为真实落库。
          // 数据源用 RealErpAdapter（读 ERP promotion 表）；MockErpService 的固定
          // 返回 [] 会导致每次同步都把已有的 ERP 促销墓碑掉，不能作为真值来源。
          const data = await this.realErpAdapter.getPromotions();
          const result = await this.promotionSync.sync({ rows: data, mode: 'snapshot' });
          count = result.upserted;
          response =
            `同步 ${result.upserted} 个促销活动成功` +
            (result.tombstoned > 0 ? `，下架 ${result.tombstoned} 个` : '') +
            (result.skipped > 0 ? `，跳过 ${result.skipped} 个` : '');
          break;
        }
        case 'members': {
          const data = await this.mockErpService.getMembers();
          const r = await this.syncMembersDownstream(data.members ?? []);
          count = r.upserted;
          response =
            `同步 ${r.upserted} 个会员成功` +
            (r.anchorless > 0 ? `，跳过 ${r.anchorless} 个缺少 ERP 主键的记录` : '') +
            (r.conflicts.length > 0
              ? `，隔离 ${r.conflicts.length} 个冲突行（需人工核对：${r.conflicts
                  .slice(0, 3)
                  .map((c) => `${c.memberNo}—${c.reason}`)
                  .join('；')}${r.conflicts.length > 3 ? '…' : ''}）`
              : '');
          break;
        }
        case 'stock': {
          const data = await this.mockErpService.getStock('default');
          count = data.length;
          response = `同步 ${data.length} 条库存成功`;
          break;
        }
        case 'transfers': {
          const data = await this.mockErpService.getTransfers('default');
          // P1-1a：调拨单为门店维度（toLocation→门店 code 映射），且需 pos_transfer_request
          // 增加 erpNo 来源键做幂等。故暂保持「读取即记录日志」，不落库；待引入门店维度后补齐。
          count = data.length;
          response = `同步 ${data.length} 张调拨单成功`;
          break;
        }
        case 'prices': {
          const data = await this.mockErpService.getPrices();
          // P1-1a：由「仅 count」改为真实更新 pos_style 款级价格（styleId 幂等）。
          // 价格源为 SKU 级，pos_style 仅存款级，按 styleId 聚合取末值。
          if (data.length > 0) {
            const byStyle = new Map<string, { tagPrice: number; costPrice: number }>();
            for (const p of data) {
              byStyle.set(p.styleId, { tagPrice: p.tagPrice, costPrice: p.costPrice });
            }
            await this.db.transaction(async (tx) => {
              for (const [styleId, price] of byStyle) {
                await tx
                  .update(posStyle)
                  .set({
                    tagPrice: toCents(price.tagPrice),
                    costPrice: toCents(price.costPrice),
                    erpSyncAt: new Date(),
                  })
                  .where(eq(posStyle.id, styleId));
              }
            });
          }
          count = data.length;
          response = `同步 ${data.length} 条价格成功`;
          break;
        }
        default:
          throw new BadRequestException(`不支持的同步类型: ${type}`);
      }
    } catch (error) {
      success = false;
      response = error instanceof Error ? error.message : '同步失败';
      this.logger.error(`下行同步失败 type=${type}`, error);
    }

    const duration = Date.now() - startTime;

    // 记录同步日志
    await this.db.insert(posSyncLog).values({
      direction: 'downstream',
      dataType: type,
      status: success ? 'success' : 'failed',
      response,
      retryCount: 0,
      durationMs: duration,
    });

    // P0-2：ERP 下行同步审计
    await auditAction(this.db, {
      storeId: null,
      employeeId: operatorId ?? null,
      module: 'erp',
      action: 'sync_downstream',
      targetNo: type,
      content: { type, success, count },
    });

    return { success, count };
  }

  /**
   * S2：会员下行 —— 以 **ERP 主键 `erp_member_id`** 为身份锚点做幂等 upsert。
   *
   * 改造动机（原实现以业务键 `member_no` 为 ON CONFLICT 目标，有两个真实缺陷）：
   *  ① **身份可漂移**：ERP 侧改会员号（合并/重编/纠错）后，同一自然人会被当成新会员
   *     再插一行，档案与积分随之分裂 —— 业务键不是稳定身份。
   *  ② **撞号即全批失败**：冲突目标只有 member_no，而 phone 另有唯一索引；一旦 ERP
   *     某会员手机号与门店**另一个**会员撞号，会命中非冲突目标列的唯一约束，
   *     异常被 catch 吞掉 → **整批会员同步静默失败**（仅落 status=failed）。
   *     一个手机号填错就能让全店会员档案停摆且不告警。
   *
   * 本实现的三层策略：
   *  - **锚点必填**：无 erpMemberId 的源行直接跳过并告警（NULL 锚点会导致每次同步都插新行）。
   *  - **存量回填**：门店老数据 erp_member_id 为 NULL，首次同步时按 `member_no` 精确匹配
   *    回填锚点，再走 upsert；**不按手机号猜测合并**（避免把两个自然人误并成一个，
   *    积分/储值合并是不可逆的资金风险）。
   *  - **冲突隔离**：撞号/锚点冲突的行只跳过自己并登记原因，其余照常同步，
   *    不再拖垮整批；冲突清单随同步结果返回并在响应文案里可见。
   *
   * 资金语义沿用 S1：已存在会员不覆写 points / stored_value（见下方 set 注释）。
   */
  private async syncMembersDownstream(
    feed: ErpMemberFeedRow[],
  ): Promise<{ upserted: number; anchorless: number; conflicts: MemberSyncConflict[] }> {
    const conflicts: MemberSyncConflict[] = [];
    let upserted = 0;

    // ① 锚点必填：缺 ERP 主键的源行无法幂等，绝不放进 upsert
    const anchored = feed.filter((m) => !!m.erpMemberId);
    const anchorless = feed.length - anchored.length;
    if (anchorless > 0) {
      this.logger.warn(
        `会员下行跳过 ${anchorless} 条缺少 ERP 主键(erpMemberId)的记录：` +
          `NULL 锚点在 PostgreSQL 唯一索引下永不冲突，会每次同步都插入新行。`,
      );
    }
    if (anchored.length === 0) return { upserted: 0, anchorless, conflicts };

    await this.db.transaction(async (tx) => {
      for (const batch of chunk(anchored, BATCH_SIZE)) {
        // ② 预检：一次性取出这批可能命中的存量行（锚点 / 会员号 / 手机号三种键）
        const conds = [
          inArray(posMember.erpMemberId, batch.map((m) => m.erpMemberId)),
          inArray(posMember.memberNo, batch.map((m) => m.memberNo)),
        ];
        const phones = batch.map((m) => m.phone).filter((p): p is string => !!p);
        if (phones.length > 0) conds.push(inArray(posMember.phone, phones));

        const existing = await tx
          .select({
            id: posMember.id,
            memberNo: posMember.memberNo,
            phone: posMember.phone,
            erpMemberId: posMember.erpMemberId,
          })
          .from(posMember)
          .where(or(...conds));

        const byAnchor = new Map<string, (typeof existing)[number]>();
        const byNo = new Map<string, (typeof existing)[number]>();
        const byPhone = new Map<string, (typeof existing)[number]>();
        for (const r of existing) {
          if (r.erpMemberId) byAnchor.set(r.erpMemberId, r);
          byNo.set(r.memberNo, r);
          if (r.phone) byPhone.set(r.phone, r);
        }

        const seenAnchor = new Set<string>();
        // 批内已占用的门店行 / 手机号 / 会员号。
        // 「只查库存量行」是不够的：同批两条都是新行时，第二条撞第一条的手机号
        // 在库里查不到（第一条还没插入），必须在批内记账，否则整条 INSERT 一起失败。
        const claimed = new Set<string>();
        const claimedPhones = new Set<string>();
        const claimedNos = new Set<string>();
        const linkTasks: { posId: string; erpId: string }[] = [];
        const values: (typeof posMember.$inferInsert)[] = [];

        for (const m of batch) {
          // 批内重复锚点：保留第一条，其余登记为冲突
          if (seenAnchor.has(m.erpMemberId)) {
            conflicts.push({ memberNo: m.memberNo, reason: '本批内 erpMemberId 重复' });
            continue;
          }
          seenAnchor.add(m.erpMemberId);

          const target = byAnchor.get(m.erpMemberId) ?? byNo.get(m.memberNo);

          if (target) {
            // 该门店会员已绑定**另一个** ERP 主键 → 身份冲突，绝不覆盖
            if (target.erpMemberId && target.erpMemberId !== m.erpMemberId) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: `门店会员 ${target.memberNo} 已绑定其它 ERP 主键 ${target.erpMemberId}`,
              });
              continue;
            }
            // 本批已有另一条 ERP 会员认领了这行（典型：两条不同 ERP 会员撞同一手机号）
            if (claimed.has(target.id)) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: `门店会员 ${target.memberNo} 已被本批另一条 ERP 会员认领`,
              });
              continue;
            }
            // 手机号已被**别的**会员占用：不能覆写他人手机号（phone 有唯一索引）
            const phoneOwner = m.phone ? byPhone.get(m.phone) : undefined;
            if (phoneOwner && phoneOwner.id !== target.id) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: `手机号 ${m.phone} 已被门店会员 ${phoneOwner.memberNo} 占用（疑似 ERP 侧录入错误）`,
              });
              continue;
            }
            // 本批内已有别的会员占用该手机号（存量行里查不到，必须批内记账）
            if (m.phone && target.phone !== m.phone && claimedPhones.has(m.phone)) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: `手机号 ${m.phone} 已被本批另一条 ERP 会员占用`,
              });
              continue;
            }
            // 存量行尚未建锚点 → 先回填，再按锚点 upsert
            if (!target.erpMemberId) {
              linkTasks.push({ posId: target.id, erpId: m.erpMemberId });
              target.erpMemberId = m.erpMemberId;
              byAnchor.set(m.erpMemberId, target);
            }
            claimed.add(target.id);
          } else {
            // 全新会员：手机号若已被占用则无法插入，隔离而非让整批失败
            const phoneOwner = m.phone ? byPhone.get(m.phone) : undefined;
            if (phoneOwner) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: `手机号 ${m.phone} 已被门店会员 ${phoneOwner.memberNo} 占用（疑似 ERP 侧录入错误）`,
              });
              continue;
            }
            if (m.phone && claimedPhones.has(m.phone)) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: `手机号 ${m.phone} 已被本批另一条 ERP 会员占用`,
              });
              continue;
            }
            if (claimedNos.has(m.memberNo)) {
              conflicts.push({
                memberNo: m.memberNo,
                reason: '本批内会员号重复',
              });
              continue;
            }
            claimedNos.add(m.memberNo);
          }

          if (m.phone) claimedPhones.add(m.phone);

          values.push({
            erpMemberId: m.erpMemberId,
            memberNo: m.memberNo,
            name: m.name,
            phone: m.phone,
            gender: m.gender,
            birthday: m.birthday ? m.birthday : null,
            level: m.level,
            points: m.points,
            storedValue: toCents(Number(m.storedValue ?? 0)),
            erpSyncAt: new Date(),
          });
        }

        // ③ 回填存量行的锚点（仅限本次判定的 1:1 匹配，不按手机号猜测合并）
        for (const t of linkTasks) {
          await tx
            .update(posMember)
            .set({ erpMemberId: t.erpId })
            .where(and(eq(posMember.id, t.posId), isNull(posMember.erpMemberId)));
        }

        if (values.length === 0) continue;

        await tx
          .insert(posMember)
          .values(values)
          .onConflictDoUpdate({
            target: posMember.erpMemberId,
            // S1 止血（资金安全）：此处**故意不覆盖** points / stored_value，只同步档案字段。
            // 原因：
            //  ① POS 侧积分由 sales/returns/omnichannel 各自本地累加，是营运余额；
            //  ② ERP `member` 表根本没有 storedValue 字段，RealErpAdapter 取数恒为 0
            //     （real-erp.adapter.ts:229 注释、:257 `storedValue: 0`），
            //     一旦覆盖会把会员**储值余额清零**——这是资损，不是数据偏差；
            //  ③ ERP 的 `points` 是旧快照，覆盖会抹掉门店已累积的积分。
            // INSERT 分支仍写入二者（让新会员拿到 ERP 初始值），
            // 仅「已存在会员」的冲突更新不再覆写。最终单轨收口见 S3。
            // 另注意：set 不含 memberNo —— 门店本地会员号一旦生成就不再被 ERP 改写。
            set: {
              name: sql`excluded.name`,
              phone: sql`excluded.phone`,
              gender: sql`excluded.gender`,
              birthday: sql`excluded.birthday`,
              level: sql`excluded.level`,
              erpSyncAt: sql`excluded.erp_sync_at`,
            },
          });
        upserted += values.length;
      }
    });

    if (conflicts.length > 0) {
      this.logger.warn(
        `会员下行隔离 ${conflicts.length} 个冲突行（其余已正常同步）：` +
          conflicts.slice(0, 5).map((c) => `[${c.memberNo}] ${c.reason}`).join(' | '),
      );
    }
    return { upserted, anchorless, conflicts };
  }

  async getUpstreamStatus(): Promise<ErpSyncStatus[]> {
    const dataTypes = [
      { type: 'sales', name: '销售单据' },
      { type: 'returns', name: '退货单据' },
      { type: 'stocktakes', name: '盘点单据' },
      { type: 'transfer_requests', name: '要货申请' },
      { type: 'eod', name: '日结单据' },
    ];

    const statuses: ErpSyncStatus[] = [];

    for (const dt of dataTypes) {
      const [latest, stats] = await Promise.all([
        this.db
          .select()
          .from(posSyncLog)
          .where(
            and(
              eq(posSyncLog.direction, 'upstream'),
              eq(posSyncLog.dataType, dt.type),
            ),
          )
          .orderBy(desc(posSyncLog.createdAt))
          .limit(1),
        this.db
          .select({
            status: posSyncLog.status,
            count: count(),
          })
          .from(posSyncLog)
          .where(
            and(
              eq(posSyncLog.direction, 'upstream'),
              eq(posSyncLog.dataType, dt.type),
            ),
          )
          .groupBy(posSyncLog.status),
      ]);

      const successCount = stats.find((s) => s.status === 'success')?.count ?? 0;
      const failedCount = stats.find((s) => s.status === 'failed')?.count ?? 0;
      const pendingCount = stats.find((s) => s.status === 'pending')?.count ?? 0;
      const totalCount =
        Number(successCount) + Number(failedCount) + Number(pendingCount);

      statuses.push({
        dataType: dt.type,
        dataName: dt.name,
        direction: 'upstream',
        lastSyncAt: latest[0]?.createdAt?.toISOString(),
        lastSyncStatus: latest[0]?.status ?? 'never',
        totalCount,
        successCount: Number(successCount),
        failedCount: Number(failedCount),
        pendingCount: Number(pendingCount),
      });
    }

    return statuses;
  }

  async retryFailedUpstream(operatorId?: string | null): Promise<{ success: boolean; retriedCount: number }> {
    const failedLogs = await this.db
      .select()
      .from(posSyncLog)
      .where(
        and(
          eq(posSyncLog.direction, 'upstream'),
          eq(posSyncLog.status, 'failed'),
        ),
      );

    let retriedCount = 0;
    let successCount = 0;
    for (const log of failedLogs) {
      // P1-1c：无完整 payload 无法重建上行请求，跳过（需由业务侧重新 pushUpstream）。
      if (!log.payload) continue;
      try {
        const res = await this.callAdapter(log.dataType, log.payload as Record<string, unknown>);
        await this.db
          .update(posSyncLog)
          .set({
            status: 'success',
            retryCount: log.retryCount + 1,
            response: res.erpNo ? `ERP单号: ${res.erpNo}` : '重试成功',
          })
          .where(eq(posSyncLog.id, log.id));
        retriedCount++;
        successCount++;
      } catch (err) {
        await this.db
          .update(posSyncLog)
          .set({
            status: 'failed',
            retryCount: log.retryCount + 1,
            response: err instanceof Error ? err.message : '重试失败',
          })
          .where(eq(posSyncLog.id, log.id));
        retriedCount++;
      }
    }

    // P0-2：ERP 上行重试审计
    await auditAction(this.db, {
      storeId: null,
      employeeId: operatorId ?? null,
      module: 'erp',
      action: 'retry_upstream',
      targetNo: 'upstream',
      content: { retriedCount, successCount },
    });

    return {
      success: failedLogs.length === 0 || successCount === failedLogs.length,
      retriedCount,
    };
  }

  /**
   * 按上行类型路由到 RealErpAdapter 的对应接收方法（真实 HTTP 推送）。
   * receive* 仅在 ERP 接收端正常时返回 {success:true}，否则抛错由调用方记 failed。
   */
  private callAdapter(
    dataType: string,
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; erpNo?: string; message?: string }> {
    switch (dataType) {
      case 'sales':
        return this.realErpAdapter.receiveSales(payload);
      case 'returns':
        return this.realErpAdapter.receiveReturns(payload);
      case 'stocktakes':
        return this.realErpAdapter.receiveStocktake(payload);
      case 'transfer_requests':
        return this.realErpAdapter.receiveTransferRequest(payload);
      case 'eod':
        return this.realErpAdapter.receiveEod(payload);
      default:
        throw new BadRequestException(`不支持的上行类型: ${dataType}`);
    }
  }

  /**
   * P1-1c：业务模块（开单/退货/盘点/要货/日结）完成后调用，将单据真实推送到 ERP 接收端，
   * 并把完整 payload 暂存进同步日志（供 retryFailedUpstream 重建请求）。
   * 成功记 success（含 ERP 单号），失败记 failed 并重抛（让业务方感知，可本地补偿）。
   */
  async pushUpstream(
    dataType: 'sales' | 'returns' | 'stocktakes' | 'transfer_requests' | 'eod',
    docNo: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const res = await this.callAdapter(dataType, payload);
      await this.db.insert(posSyncLog).values({
        direction: 'upstream',
        dataType,
        docNo,
        status: 'success',
        response: res.erpNo ? `ERP单号: ${res.erpNo}` : '已接收',
        payload,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      await this.db.insert(posSyncLog).values({
        direction: 'upstream',
        dataType,
        docNo,
        status: 'failed',
        response: err instanceof Error ? err.message : '上行失败',
        payload,
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  async getSyncLogs(query: SyncLogQuery): Promise<ListResponse<SyncLog>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.direction) conditions.push(eq(posSyncLog.direction, query.direction));
    if (query.dataType) conditions.push(eq(posSyncLog.dataType, query.dataType));
    if (query.status) conditions.push(eq(posSyncLog.status, query.status));
    if (query.startDate) conditions.push(gte(posSyncLog.createdAt, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(posSyncLog.createdAt, new Date(query.endDate)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posSyncLog)
        .where(whereClause),
      this.db
        .select()
        .from(posSyncLog)
        .where(whereClause)
        .orderBy(desc(posSyncLog.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        dataType: row.dataType,
        docNo: row.docNo ?? undefined,
        status: row.status,
        response: row.response ?? undefined,
        retryCount: row.retryCount,
        durationMs: row.durationMs ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async initialSync(storeId: string): Promise<{ success: boolean; message: string }> {
    const types = ['styles', 'prices', 'promotions', 'members', 'stock', 'transfers'];
    let successCount = 0;
    let failCount = 0;

    for (const type of types) {
      try {
        const result = await this.syncDownstream(type);
        if (result.success) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }

    return {
      success: failCount === 0,
      message: `首次同步完成：成功 ${successCount} 项，失败 ${failCount} 项`,
    };
  }
}
