import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import { posPromotion } from '@server/database/schema';
import { and, inArray, notInArray, sql } from 'drizzle-orm';
import { chunk, BATCH_SIZE } from '@server/common/batch';
import {
  mapErpPromotion,
  type ErpPromotionRow,
  type PosPromotionUpsert,
} from './promotion-mapping';

/**
 * Wave 4-C：促销下行落库（ERP → POS）
 * ---------------------------------------------------------------------------
 * 修复原 `syncDownstream('promotions')` 只取 count 不做 upsert 的空桩问题。
 *
 * 两条硬约束：
 *
 * 1) **幂等**：以 `erp_promotion_id` 为 ON CONFLICT target。促销是最容易资损的
 *    主数据 —— 同步重跑一次就变成「同一活动两行、满减叠加两次」，收银台直接少收钱。
 *
 * 2) **墓碑**：促销在 ERP 侧被撤销/停用后，POS 必须在下一个同步周期把它下架，
 *    否则门店继续按已结束的活动打折。墓碑用 `deletedAt` 软删（不是硬删，
 *    历史订单追溯仍需读到当时的促销）。
 *
 * 关于 mode：
 * - snapshot：本轮结果是**全量**真值（上游是快照 API）。本轮没出现的 ERP 促销
 *   → 墓碑。这是 ERP→POS 促销下行的默认模式。
 * - append ：上游只给增量（未来做 since 增量时），不能墓碑，否则漏一条就下架一条。
 *
 * 关于门店维度：**这里绝不做按门店裁剪**。同一促销可能适用 A 店，下次同步若换
 * 成按 B 店拉，A 店的促销会被误墓碑（这就是不做裁剪的原因）。门店过滤交给
 * 计价侧（promotionHitsStore）在内存里做，同步永远拉「全部门店可见的促销」。
 */

export type PromotionSyncMode = 'snapshot' | 'append';

export interface PromotionSyncResult {
  /** 实际写入/更新的行数（含 upsert 命中已有行的部分） */
  upserted: number;
  /** 被墓碑软删（ERP 侧已撤销）的行数 */
  tombstoned: number;
  /** 因类型不支持/字段缺失被跳过的行数 */
  skipped: number;
  /** 跳过原因明细（去重后） */
  skipReasons: string[];
}

@Injectable()
export class PromotionSyncService {
  private readonly logger = new Logger(PromotionSyncService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {
    this.db = scopeDatabase(this.db);
  }

  async sync(
    params: { rows: ErpPromotionRow[]; mode?: PromotionSyncMode; now?: Date },
  ): Promise<PromotionSyncResult> {
    const { rows, mode = 'snapshot' } = params;
    const now = params.now ?? new Date();

    const values: PosPromotionUpsert[] = [];
    const skipReasons = new Set<string>();
    let skipped = 0;

    for (const r of rows) {
      const { row, skipReason } = mapErpPromotion(r, now);
      if (!row) {
        skipped++;
        if (skipReason) skipReasons.add(skipReason);
        continue;
      }
      values.push(row);
    }

    const upsertedIds = values.map((v) => v.erpPromotionId);
    let tombstoned = 0;

    await this.db.transaction(async (tx) => {
      for (const batch of chunk(values, BATCH_SIZE)) {
        if (batch.length === 0) continue;
        await tx
          .insert(posPromotion)
          .values(batch as never)
          .onConflictDoUpdate({
            target: posPromotion.erpPromotionId,
            set: {
              name: sql`excluded.name`,
              type: sql`excluded.type`,
              threshold: sql`excluded.threshold`,
              discountValue: sql`excluded.discount_value`,
              discountType: sql`excluded.discount_type`,
              applyScope: sql`excluded.apply_scope`,
              scopeIds: sql`excluded.scope_ids`,
              validFrom: sql`excluded.valid_from`,
              validTo: sql`excluded.valid_to`,
              status: sql`excluded.status`,
              priority: sql`excluded.priority`,
              source: sql`excluded.source`,
              isMemberOnly: sql`excluded.is_member_only`,
              erpSyncAt: sql`excluded.erp_sync_at`,
              erpUpdatedAt: sql`excluded.erp_updated_at`,
              // 恢复：ERP 侧重新启用一个被墓碑的促销时，必须清掉 deletedAt，
              // 否则 upsert 只在「已存在行」上更新，软删行永远起不来。
              deletedAt: null,
              updatedAt: now,
            },
          });
      }

      // 只有 snapshot 语义才墓碑（append/增量源拿不到全量，漏一条就下架一条）。
      if (mode !== 'snapshot') return;
      // 区分两种「本轮没写进任何行」：
      //  (a) 上游确实一条都没给（skipped === 0）→ 全量快照为空 = ERP 把促销全撤了，
      //      必须全部墓碑，否则门店继续按已撤销的活动打折。
      //  (b) 本轮因解析失败被跳过（skipped > 0）→ 数据源异常，绝不能墓碑：
      //      否则「一条促销字段缺失」就会把门店所有在售促销批量下架，属高危静默故障。
      //      保留上次状态 + 告警，等下一次同步自愈。
      if (values.length === 0 && skipped > 0) {
        this.logger.warn('促销下行本轮无有效行（疑似解析失败），已跳过墓碑比对（保留上次状态）');
        return;
      }

      // 墓碑：本轮快照里没出现的、仍存活的 ERP 促销 → 下架。
      // scopeDatabase 已自动注入 deletedAt IS NULL，不会重复墓碑、也不会动已删行。
      // 注意：快照为空本身就是有效信号（ERP 把促销全撤了），不能因为「没拿到要保留的
      // 行」就跳过 —— 这里必须真的去查一次，否则「撤销」永远传不到门店。
      const stale = await tx
        .select({ id: posPromotion.id, erpPromotionId: posPromotion.erpPromotionId })
        .from(posPromotion)
        .where(
          and(
            eqSourceErp(),
            upsertedIds.length > 0
              ? notInArray(posPromotion.erpPromotionId, upsertedIds)
              : sql`true`,
          ),
        );
      if (stale.length === 0) return;
      for (const batch of chunk(stale, BATCH_SIZE)) {
        await tx
          .update(posPromotion)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            inArray(
              posPromotion.id,
              batch.map((b) => b.id),
            ),
          );
      }
      tombstoned = stale.length;
    });

    if (skipped > 0) {
      this.logger.warn(
        `促销下行跳过 ${skipped} 条: ${[...skipReasons].join('; ')}`,
      );
    }
    if (tombstoned > 0) {
      this.logger.log(`促销下行墓碑（ERP 侧已撤销）${tombstoned} 条`);
    }

    return {
      upserted: values.length,
      tombstoned,
      skipped,
      skipReasons: [...skipReasons],
    };
  }
}

function eqSourceErp() {
  return sql`${posPromotion.source} = 'erp'`;
}
