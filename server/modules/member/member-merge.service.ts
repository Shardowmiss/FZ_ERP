import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import {
  member,
  memberMergeLog,
  memberWalletEvent,
  memberPoint,
  retailOrder,
} from '@server/database/schema';
import { decryptField } from '@server/common/crypto/field-encryption';
import { maskPhone } from '@server/common/data-scope/pii';
import { MemberWalletService } from './member-wallet.service';

/** 候选会员（单条） */
export interface MergeCandidate {
  id: string;
  memberNo: string;
  name: string;
  phoneMasked: string | null;
  points: number;
  /** 储值（单位=分） */
  storedValue: number;
  totalSpent: number;
  orderCount: number;
  level: string;
  status: string;
}

/** 同一 phone_hmac 下的重复会员组（候选预览） */
export interface MergeCandidateGroup {
  phoneHmac: string | null;
  phoneMasked: string | null;
  members: MergeCandidate[];
}

export interface MergeRequest {
  survivorId: string;
  mergedIds: string[];
  reason?: string;
  /** 操作人（由控制器从登录态注入） */
  operator?: string;
}

export interface MergeResult {
  runId: string;
  survivorId: string;
  mergedCount: number;
  movedPoints: number;
  /** 转移的储值（单位=分） */
  movedStoredValue: number;
  movedTotalSpent: number;
  movedOrderCount: number;
  logs: { mergedId: string; logId: string }[];
}

/**
 * P0-3 主数据合并引擎（切片 A：member）。
 *
 * 责任边界：
 *   · 仅做「检测 → 候选预览 → 资金安全合并 → 可审计回滚」，不触碰 product/customer/store（留 3b/3c）。
 *   · 合并 = 把重复会员收敛为一个 survivor；被合并会员**绝不删除**（member 无 _deleted_at，
 *     member_wallet_event / member_point 均 onDelete cascade，删除即级联清空钱包流水 = 资金事故）。
 *   · 资金安全：积分/储值经 member_wallet_event 账本事件（复用 MemberWalletService.applyWalletEvent 的
 *     幂等 + 原子余额范式）累加给 survivor；被合并方仅打标(mergedInto/mergedAt) + 清零，不删。
 *   · 回滚：依据 member_merge_log 记录的精确增量反向，资金无双计、无级联清空。
 *
 * 幂等与重合并：钱包事件 eventKey 含 run_id（`merge:{run_id}:{merged_id}:{kind}`），回滚后若再次合并同会员，
 *   新 run_id 产生新 eventKey，不会被判重跳过 → 不会造成资金漏转。
 */
@Injectable()
export class MemberMergeService {
  private readonly logger = new Logger(MemberMergeService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly wallet: MemberWalletService,
  ) {}

  /**
   * 候选预览：按 phone_hmac 分组的重复会员（排除已合并方），手机号解密后脱敏展示。
   * 仅返回「同组 >= 2」的重复组。
   */
  async candidates(limit = 500): Promise<MergeCandidateGroup[]> {
    const rows = await this.db
      .select({
        id: member.id,
        memberNo: member.memberNo,
        name: member.name,
        phone: member.phone,
        phoneHmac: member.phoneHmac,
        points: member.points,
        storedValue: member.storedValue,
        totalSpent: member.totalSpent,
        orderCount: member.orderCount,
        level: member.level,
        status: member.status,
      })
      .from(member)
      .where(and(isNull(member.mergedInto), sql`${member.phoneHmac} IS NOT NULL`))
      .limit(limit);

    const groups = new Map<string, MergeCandidateGroup>();
    for (const r of rows) {
      const hmac = r.phoneHmac ?? '';
      const phonePlain = decryptField(r.phone);
      const masked = phonePlain ? maskPhone(phonePlain) : null;
      const cand: MergeCandidate = {
        id: r.id,
        memberNo: r.memberNo,
        name: r.name,
        phoneMasked: masked,
        points: Number(r.points ?? 0),
        storedValue: Number(r.storedValue ?? 0),
        totalSpent: Number(r.totalSpent ?? 0),
        orderCount: Number(r.orderCount ?? 0),
        level: r.level,
        status: r.status,
      };
      let g = groups.get(hmac);
      if (!g) {
        g = { phoneHmac: r.phoneHmac, phoneMasked: masked, members: [] };
        groups.set(hmac, g);
      }
      g.members.push(cand);
    }
    return Array.from(groups.values()).filter((g) => g.members.length >= 2);
  }

  /**
   * 合并：把 mergedIds 收敛进 survivorId。单事务内完成：
   *   ① 依赖行（retail_order / wallet_event / point）改指 survivor（不删，规避 cascade 清流水）
   *   ② 积分/储值经账本事件原子累加给 survivor（幂等）
   *   ③ 去重化展示计数器并入 survivor，被合并方清零 + 打标
   *   ④ 写 member_merge_log（审计 + 回滚依据）
   */
  async merge(req: MergeRequest): Promise<MergeResult> {
    if (!req.survivorId || !req.mergedIds?.length) {
      throw new BadRequestException('survivorId 与 mergedIds 必填');
    }
    const mergedIds = Array.from(new Set(req.mergedIds));
    if (mergedIds.includes(req.survivorId)) {
      throw new BadRequestException('survivorId 不能出现在 mergedIds 中（不可自我合并）');
    }
    const runId = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return this.db.transaction(async (tx) => {
      const [survivor] = await tx
        .select()
        .from(member)
        .where(eq(member.id, req.survivorId))
        .limit(1)
        .for('update');
      if (!survivor) throw new BadRequestException(`survivor 不存在：${req.survivorId}`);

      const mergedRows = await tx
        .select()
        .from(member)
        .where(inArray(member.id, mergedIds))
        .for('update');
      if (mergedRows.length !== mergedIds.length) {
        const found = new Set(mergedRows.map((m) => m.id));
        const missing = mergedIds.filter((id) => !found.has(id));
        throw new BadRequestException(`merged 会员不存在：${missing.join(',')}`);
      }
      for (const m of mergedRows) {
        if (m.mergedInto) {
          throw new BadRequestException(`会员 ${m.id} 已被合并（mergedInto=${m.mergedInto}），不可再次作为被合并方`);
        }
      }

      let totalMovedPoints = 0;
      let totalMovedStoredValue = 0;
      let totalMovedTotalSpent = 0;
      let totalMovedOrderCount = 0;
      const logs: { mergedId: string; logId: string }[] = [];

      for (const m of mergedRows) {
        const movedPoints = Number(m.points ?? 0);
        const movedStoredValue = Number(m.storedValue ?? 0); // 分
        const movedTotalSpent = Number(m.totalSpent ?? 0);
        const movedOrderCount = Number(m.orderCount ?? 0);

        // ① 依赖行改指 survivor（不删除，规避 cascade 清空钱包流水）
        await tx
          .update(retailOrder)
          .set({ memberId: survivor.id })
          .where(eq(retailOrder.memberId, m.id));
        await tx
          .update(memberWalletEvent)
          .set({ memberId: survivor.id })
          .where(eq(memberWalletEvent.memberId, m.id));
        await tx
          .update(memberPoint)
          .set({ memberId: survivor.id })
          .where(eq(memberPoint.memberId, m.id));

        // ② 积分/储值经账本事件原子累加（复用 applyWalletEvent 范式；eventKey 含 run_id 保证可重合并）
        if (movedPoints !== 0) {
          await this.wallet.applyWalletEvent(
            {
              eventKey: `merge:${runId}:${m.id}:points`,
              memberId: survivor.id,
              kind: 'points',
              changeValue: movedPoints,
              sourceType: 'merge',
              sourceNo: m.memberNo,
            },
            tx,
          );
        }
        if (movedStoredValue !== 0) {
          await this.wallet.applyWalletEvent(
            {
              eventKey: `merge:${runId}:${m.id}:stored_value`,
              memberId: survivor.id,
              kind: 'stored_value',
              changeValue: movedStoredValue,
              sourceType: 'merge',
              sourceNo: m.memberNo,
            },
            tx,
          );
        }

        // ③ 去重化展示计数器并入 survivor；被合并方清零 + 打标（不删）
        await tx
          .update(member)
          .set({
            totalSpent: sql`${member.totalSpent} + ${movedTotalSpent}`,
            orderCount: sql`${member.orderCount} + ${movedOrderCount}`,
          })
          .where(eq(member.id, survivor.id));
        await tx
          .update(member)
          .set({
            points: 0,
            storedValue: sql`0`,
            totalSpent: sql`0`,
            orderCount: 0,
            mergedInto: survivor.id,
            mergedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(member.id, m.id));

        // ④ 审计/回滚日志
        const [log] = await tx
          .insert(memberMergeLog)
          .values({
            runId,
            survivorId: survivor.id,
            mergedId: m.id,
            mergedMemberNo: m.memberNo,
            mergedName: m.name,
            mergedPhoneHmac: m.phoneHmac,
            movedPoints,
            movedStoredValue: String(movedStoredValue),
            movedTotalSpent: String(movedTotalSpent),
            movedOrderCount,
            reason: req.reason ?? null,
            operator: req.operator ?? null,
          })
          .returning({ id: memberMergeLog.id });

        totalMovedPoints += movedPoints;
        totalMovedStoredValue += movedStoredValue;
        totalMovedTotalSpent += movedTotalSpent;
        totalMovedOrderCount += movedOrderCount;
        logs.push({ mergedId: m.id, logId: log.id });
      }

      this.logger.log(
        `[P0-3] 合并完成 run_id=${runId} survivor=${survivor.id} 合并 ${mergedRows.length} 人，` +
          `转移积分=${totalMovedPoints} 储值(分)=${totalMovedStoredValue} 消费额=${totalMovedTotalSpent} 订单数=${totalMovedOrderCount}`,
      );

      return {
        runId,
        survivorId: survivor.id,
        mergedCount: mergedRows.length,
        movedPoints: totalMovedPoints,
        movedStoredValue: totalMovedStoredValue,
        movedTotalSpent: totalMovedTotalSpent,
        movedOrderCount: totalMovedOrderCount,
        logs,
      };
    });
  }

  /**
   * 回滚一次合并（按 merge_log.id）或整批（按 run_id）。
   * 资金安全：依据日志记录的精确增量反向（survivor 扣减、被合并方还原、解除打标），无双计、无级联清空。
   *
   * 边界说明（survivorship 标准做法，非缺陷）：
   *   retail_order / member_wallet_event / member_point 的历史归属在合并后归 survivor 所有，回滚**不**将其指回被合并方
   *   （否则会误伤 survivor 合并后自身产生的业务记录）。被合并方恢复的是「资金 + 展示计数器 + 会员身份」，
   *   其历史流水仍作为 survivor 账本的一部分保留（survivor 余额以反向扣减为准，已还原）。
   */
  async reverse(opts: { logId?: string; runId?: string; operator?: string }): Promise<{ reversed: number }> {
    const { logId, runId, operator } = opts;
    if (!logId && !runId) throw new BadRequestException('logId 或 runId 必填其一');
    return this.db.transaction(async (tx) => {
      const where = logId ? eq(memberMergeLog.id, logId) : eq(memberMergeLog.runId, runId!);
      const rows = await tx.select().from(memberMergeLog).where(where);
      if (!rows.length) throw new BadRequestException('未找到合并日志（可能已被回滚或不存在）');

      let reversed = 0;
      for (const log of rows) {
        if (log.reversedAt) {
          this.logger.warn(`[P0-3] 合并日志 ${log.id} 已回滚，跳过`);
          continue;
        }
        const movedPoints = Number(log.movedPoints ?? 0);
        const movedStoredValue = Number(log.movedStoredValue ?? 0);
        const movedTotalSpent = Number(log.movedTotalSpent ?? 0);
        const movedOrderCount = Number(log.movedOrderCount ?? 0);

        // survivor 扣减（原子，clamp >= 0，防负余额）
        await tx
          .update(member)
          .set({
            points: sql`GREATEST(${member.points} - ${movedPoints}, 0)`,
            storedValue: sql`GREATEST(${member.storedValue} - ${movedStoredValue}, 0)`,
            totalSpent: sql`GREATEST(${member.totalSpent} - ${movedTotalSpent}, 0)`,
            orderCount: sql`GREATEST(${member.orderCount} - ${movedOrderCount}, 0)`,
          })
          .where(eq(member.id, log.survivorId));

        // 被合并方还原（资金 + 计数器 + 解除打标）
        await tx
          .update(member)
          .set({
            points: movedPoints,
            storedValue: String(movedStoredValue),
            totalSpent: String(movedTotalSpent),
            orderCount: movedOrderCount,
            mergedInto: null,
            mergedAt: null,
          })
          .where(eq(member.id, log.mergedId));

        await tx
          .update(memberMergeLog)
          .set({ reversedAt: sql`CURRENT_TIMESTAMP`, operator: operator ?? null })
          .where(eq(memberMergeLog.id, log.id));
        reversed++;
      }
      return { reversed };
    });
  }
}
