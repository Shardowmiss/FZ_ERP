import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { masterDataMergeLog } from '@server/database/schema';
import { maskPhone } from '@server/common/data-scope/pii';
import { getMergeConfig } from './configs';
import type {
  MergeCandidateGroup,
  MergeCandidateKeyType,
  MergeCandidateMember,
  MergeEntityConfig,
  MergeEntityType,
  MergeLog,
  MergeRequest,
  MergeResult,
} from './types';

/**
 * P0-3 通用主数据合并引擎（3b/3c：商品 style / 客户 customer）。
 *
 * 责任边界：
 *   · 把重复的主数据收敛为一个 survivor；被合并方**绝不删除**（style/customer 从表外键均
 *     RESTRICT/NO ACTION，删除被 FK 阻止；且历史业务依赖这些主数据）—— 仅改指依赖行到
 *     survivor + 打标(mergedInto/mergedAt)。
 *   · style/customer 无资金/积分列，合并不涉及资金迁移（比 member 简单、更安全的子集）。
 *   · 依赖改指范围 = 实时从属于该主数据的业务表（见 configs.ts），历史交易行项目不改指。
 *   · 回滚 = 解除打标（不回指历史归属，与 member 一致：survivor 已拥有的依赖归属保持不变）。
 *
 * 与 P0-3 member 的关系：复用同一「打标 + 改指 + 审计日志」范式，但抽成配置驱动，
 * 新增实体只需在 configs.ts 登记 + 迁移加打标列。member 的资金累加/账本事件逻辑
 * 不在本引擎内（本引擎不处理任何资金实体）。
 */
@Injectable()
export class MasterDataMergeService {
  private readonly logger = new Logger(MasterDataMergeService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 合并：把 mergedIds 收敛进 survivorId（指定实体类型）。单事务内完成：
   *   ① 实体特定预校验（如 style 的 sku 唯一键冲突）
   *   ② 依赖行改指 survivor（不删，规避级联清业务）
   *   ③ 被合并方打标（不删、不迁移资金）
   *   ④ 写 master_data_merge_log（审计 + 回滚依据）
   */
  async merge(req: MergeRequest): Promise<MergeResult> {
    const cfg = getMergeConfig(req.entityType);
    if (!req.survivorId || !req.mergedIds?.length) {
      throw new BadRequestException('survivorId 与 mergedIds 必填');
    }
    const mergedIds = Array.from(new Set(req.mergedIds));
    if (mergedIds.includes(req.survivorId)) {
      throw new BadRequestException('survivorId 不能出现在 mergedIds 中（不可自我合并）');
    }
    const runId = `mdmerge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return this.db.transaction(async (tx) => {
      const entityTable = cfg.table;

      const [survivor] = await tx
        .select()
        .from(entityTable)
        .where(eq(entityTable.id, req.survivorId))
        .limit(1)
        .for('update');
      if (!survivor) throw new BadRequestException(`survivor 不存在：${req.survivorId}`);

      const mergedRows = await tx
        .select()
        .from(entityTable)
        .where(inArray(entityTable.id, mergedIds))
        .for('update');
      if (mergedRows.length !== mergedIds.length) {
        const found = new Set(mergedRows.map((m) => m.id));
        const missing = mergedIds.filter((id) => !found.has(id));
        throw new BadRequestException(`merged ${cfg.type} 不存在：${missing.join(',')}`);
      }
      for (const m of mergedRows) {
        if (m[cfg.mergedIntoKey]) {
          throw new BadRequestException(
            `${cfg.type} ${m.id} 已被合并（mergedInto=${m[cfg.mergedIntoKey]}），不可再次作为被合并方`,
          );
        }
      }

      const survivorDisplay = survivor[cfg.displayKey];
      const logs: { mergedId: string; logId: string }[] = [];

      for (const m of mergedRows) {
        // ① 实体特定预校验（如 style 的 sku 唯一键冲突）
        if (cfg.preMergeValidation) {
          await cfg.preMergeValidation(tx, survivor.id, m.id);
        }

        // ② 依赖行改指 survivor（不删除，规避级联清业务）
        for (const dep of cfg.deps) {
          const setObj: Record<string, unknown> = { [dep.idKey]: survivor.id };
          if (dep.codeKey) setObj[dep.codeKey] = survivorDisplay;
          await tx
            .update(dep.table)
            .set(setObj)
            .where(eq(dep.table[dep.idKey], m.id));
        }

        // ③ 被合并方打标（不删、不迁移资金/积分）
        await tx
          .update(entityTable)
          .set({
            [cfg.mergedIntoKey]: survivor.id,
            [cfg.mergedAtKey]: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(entityTable.id, m.id));

        // ④ 审计/回滚日志
        const [log] = await tx
          .insert(masterDataMergeLog)
          .values({
            entityType: cfg.type,
            runId,
            survivorId: survivor.id,
            mergedId: m.id,
            mergedCode: m[cfg.codeKey],
            mergedName: m[cfg.displayKey],
            reason: req.reason ?? null,
            operator: req.operator ?? null,
          })
          .returning({ id: masterDataMergeLog.id });

        logs.push({ mergedId: m.id, logId: log.id });
      }

      this.logger.log(
        `[3b/3c] 合并完成 entity_type=${cfg.type} run_id=${runId} survivor=${survivor.id} 合并 ${mergedRows.length} 条`,
      );

      return {
        entityType: cfg.type,
        runId,
        survivorId: survivor.id,
        mergedCount: mergedRows.length,
        logs,
      };
    });
  }

  /**
   * 回滚一次合并（按 master_data_merge_log.id）或整批（按 run_id）。
   * 资金安全/归属安全：依据日志解除被合并方打标（survivor 已拥有的依赖归属保持不变，不回指历史归属）。
   */
  async reverse(opts: {
    logId?: string;
    runId?: string;
    operator?: string;
  }): Promise<{ reversed: number }> {
    const { logId, runId, operator } = opts;
    if (!logId && !runId) throw new BadRequestException('logId 或 runId 必填其一');
    return this.db.transaction(async (tx) => {
      const where = logId
        ? eq(masterDataMergeLog.id, logId)
        : eq(masterDataMergeLog.runId, runId!);
      const rows = await tx.select().from(masterDataMergeLog).where(where);
      if (!rows.length) throw new BadRequestException('未找到合并日志（可能已被回滚或不存在）');

      let reversed = 0;
      for (const log of rows) {
        if (log.reversedAt) {
          this.logger.warn(`[3b/3c] 合并日志 ${log.id} 已回滚，跳过`);
          continue;
        }
        const cfg = getMergeConfig(log.entityType);
        const entityTable = cfg.table;

        // 解标（恢复被合并方身份；不回指历史归属——survivor 已拥有的依赖行保持归属，避免误伤）
        await tx
          .update(entityTable)
          .set({
            [cfg.mergedIntoKey]: null,
            [cfg.mergedAtKey]: null,
          })
          .where(eq(entityTable.id, log.mergedId));

        await tx
          .update(masterDataMergeLog)
          .set({ reversedAt: sql`CURRENT_TIMESTAMP`, operator: operator ?? null })
          .where(eq(masterDataMergeLog.id, log.id));
        reversed++;
      }
      return { reversed };
    });
  }

  /**
   * 列出合并审计日志（供「合并审计」页展示 + 整批回滚）。
   * 按实体类型过滤（路径参数），可选仅有效/仅已回滚；默认按时间倒序、上限 200 行。
   * 同时回填保留方(survivor)展示名，便于运营辨识。
   */
  async listLogs(
    entityType: string,
    opts: { reversed?: boolean; limit?: number } = {},
  ): Promise<MergeLog[]> {
    const cfg = getMergeConfig(entityType);
    const entityTable = cfg.table;
    const conds = [eq(masterDataMergeLog.entityType, cfg.type)];
    if (opts.reversed === true) conds.push(sql`${masterDataMergeLog.reversedAt} is not null`);
    else if (opts.reversed === false) conds.push(sql`${masterDataMergeLog.reversedAt} is null`);

    const rows = await this.db
      .select()
      .from(masterDataMergeLog)
      .where(and(...conds))
      .orderBy(sql`${masterDataMergeLog.createdAt} desc`)
      .limit(opts.limit ?? 200);

    // 回填保留方展示名（style=styleNo / customer=name）
    const survivorIds = Array.from(new Set(rows.map((r) => r.survivorId)));
    const survMap = new Map<string, string | null>();
    if (survivorIds.length) {
      const survs = await this.db
        .select({ id: entityTable.id, name: entityTable[cfg.displayKey] })
        .from(entityTable)
        .where(inArray(entityTable.id, survivorIds));
      for (const s of survs) survMap.set(s.id as string, (s.name as string) ?? null);
    }

    const iso = (v: unknown): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);

    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType as MergeEntityType,
      runId: r.runId,
      survivorId: r.survivorId,
      survivorName: survMap.get(r.survivorId) ?? null,
      mergedId: r.mergedId,
      mergedCode: r.mergedCode,
      mergedName: r.mergedName,
      reason: r.reason,
      operator: r.operator,
      reversedAt: iso(r.reversedAt),
      createdAt: iso(r.createdAt) ?? '',
    }));
  }

  /**
   * 查重候选发现（非热路径）。
   *
   * 设计要点：归一 + 分组完全由 configs.ts 的 SQL 表达式在数据库侧完成
   * （与归一表达式严格同构，避免「SQL 判重复、JS 分不到同组」的静默漏组）；
   * JS 侧只做成员明细补全、关联业务单据计数、脱敏与推荐 survivor。
   * 一个实体若未在 configs 配置 candidate，则不支持候选发现（抛错）。
   */
  async candidates(entityType: string, limit = 200): Promise<MergeCandidateGroup[]> {
    const cfg = getMergeConfig(entityType);
    if (!cfg.candidate) {
      throw new BadRequestException(`实体类型 ${entityType} 暂不支持查重候选发现`);
    }
    const cand = cfg.candidate;
    const entityTable = cfg.table;
    const mergedIntoCol = entityTable[cfg.mergedIntoKey];

    const keyDefs: { keyType: MergeCandidateKeyType; expr: SQL<string> }[] = [
      { keyType: 'name', expr: cand.nameExpr },
    ];
    if (cand.phoneExpr) keyDefs.push({ keyType: 'phone', expr: cand.phoneExpr });

    const groups: MergeCandidateGroup[] = [];
    for (const kd of keyDefs) {
      // SQL 侧归一 + 分组，仅取成员数 >= 2 的疑似重复组；归一键非空才参与
      const rows = await this.db
        .select({
          key: kd.expr.as('key'),
          ids: sql`array_agg(${entityTable.id})`.as('ids'),
          cnt: sql`count(*)::int`.as('cnt'),
        })
        .from(entityTable)
        .where(
          and(
            isNull(mergedIntoCol),
            sql`${kd.expr} is not null and ${kd.expr} <> ''`,
          ),
        )
        .groupBy(kd.expr)
        .having(sql`count(*) >= 2`);

      for (const r of rows) {
        const ids = (r.ids as string[]) ?? [];
        if (ids.length < 2) continue;
        const members = await this.buildCandidateMembers(cfg, ids);
        groups.push({
          keyType: kd.keyType,
          // 电话键脱敏展示，避免泄露完整号码；名称键原样
          key: kd.keyType === 'phone' ? maskPhone(r.key as string) : (r.key as string),
          memberCount: members.length,
          members,
        });
      }
    }
    return groups.slice(0, limit);
  }

  /** 补全候选组成员明细 + 关联业务单据计数 + 脱敏 + 推荐 survivor */
  private async buildCandidateMembers(
    cfg: MergeEntityConfig,
    ids: string[],
  ): Promise<MergeCandidateMember[]> {
    const entityTable = cfg.table;
    const memberRows = await this.db
      .select({
        id: entityTable.id,
        code: entityTable[cfg.codeKey],
        name: entityTable[cfg.displayKey],
        // 仅 customer 配置了 candidate，其有 phone 列；其余实体不会走到此分支
        phone: (entityTable as any).phone,
      })
      .from(entityTable)
      .where(inArray(entityTable.id, ids));

    const members: MergeCandidateMember[] = [];
    for (const m of memberRows) {
      let related = 0;
      for (const dep of cfg.deps) {
        const r = await this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(dep.table)
          .where(eq(dep.table[dep.idKey], m.id));
        related += Number(r[0]?.n ?? 0);
      }
      members.push({
        id: m.id as string,
        code: m.code as string,
        name: m.name as string,
        phone: m.phone != null ? maskPhone(m.phone as string) : null,
        relatedCount: related,
        suggested: false,
      });
    }
    // 推荐 survivor：关联单据最多；并列取 code 较小者
    members.sort(
      (a, b) =>
        b.relatedCount - a.relatedCount || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
    if (members.length) members[0].suggested = true;
    return members;
  }
}
