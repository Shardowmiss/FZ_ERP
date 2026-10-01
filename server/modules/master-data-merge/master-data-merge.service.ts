import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { masterDataMergeLog } from '@server/database/schema';
import { getMergeConfig } from './configs';
import type { MergeEntityType, MergeRequest, MergeResult } from './types';

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
}
