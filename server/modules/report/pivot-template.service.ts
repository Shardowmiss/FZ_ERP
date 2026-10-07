import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { reportPivotTemplate } from '@server/database/schema';
import type { PivotConfig, PivotDataSource } from '@shared/api.interface';

/**
 * 透视分析个人模板服务。
 *
 * 能力：
 *  - 列出「我的模板」（含系统预置的 4 个前端 TEMPLATES 之外的持久化模板）
 *  - 保存为我的模板（同名则覆盖，便于「改了参数再存回去」）
 *  - 记住我最后一次查询（每次查询自动覆盖，无需手动保存）
 *  - 恢复我最后一次查询
 *  - 删除我的模板
 *
 * 权限模型：**全部操作按 owner_user_id 严格隔离**——只能读写自己的模板，
 * 别人的模板在 DB 层就查不到（where 里恒带 owner 条件），不存在越权可能。
 * 这比在应用层做「读出来再比对 owner」更安全，也便于后续加系统共享模板
 * （owner_user_id 为系统账号的那批）。
 */
@Injectable()
export class PivotTemplateService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 列出我的模板（含「最后一次查询」标记位），按最近更新排序 */
  async listMine(ownerUserId: string) {
    const rows = await this.db
      .select({
        id: reportPivotTemplate.id,
        name: reportPivotTemplate.name,
        config: reportPivotTemplate.config,
        dataSource: reportPivotTemplate.dataSource,
        isLastUsed: reportPivotTemplate.isLastUsed,
        remark: reportPivotTemplate.remark,
        createdAt: reportPivotTemplate.createdAt,
        updatedAt: reportPivotTemplate.updatedAt,
      })
      .from(reportPivotTemplate)
      .where(eq(reportPivotTemplate.ownerUserId, ownerUserId))
      .orderBy(
        desc(reportPivotTemplate.isLastUsed),
        desc(reportPivotTemplate.updatedAt),
      );
    return rows;
  }

  /**
   * 保存为我的模板。
   * 同名则**覆盖**（ON CONFLICT DO UPDATE）——业务场景是「调好参数存回原模板」，
   * 若因重名报错反而不可用。
   */
  async save(
    ownerUserId: string,
    dto: { name: string; config: PivotConfig; remark?: string },
  ) {
    const name = (dto.name ?? '').trim();
    if (!name) {
      throw new BadRequestException('模板名称不能为空');
    }
    if (name.length > 100) {
      throw new BadRequestException('模板名称不能超过 100 个字符');
    }
    const dataSource = this.assertConfig(dto.config);

    const [row] = await this.db
      .insert(reportPivotTemplate)
      .values({
        ownerUserId,
        name,
        config: dto.config as unknown as Record<string, unknown>,
        dataSource,
        isLastUsed: false,
        remark: dto.remark ?? null,
        createdBy: ownerUserId,
        updatedBy: ownerUserId,
      })
      .onConflictDoUpdate({
        target: [reportPivotTemplate.ownerUserId, reportPivotTemplate.name],
        set: {
          config: dto.config as unknown as Record<string, unknown>,
          dataSource,
          remark: dto.remark ?? null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          updatedBy: ownerUserId,
        },
      })
      .returning({ id: reportPivotTemplate.id });

    return { id: row.id, name, dataSource };
  }

  /**
   * 记住我最后一次查询。
   *
   * 实现要点：**先清掉本用户旧的 last_used，再插入/更新新的**。
   * 若直接依赖 DB 的部分唯一索引，第二条会直接报错；这里显式先清后写，
   * 既是幂等语义，也让用户心智简单（只有一个「最后一次」，永远是最新那个）。
   *
   * 命名固定为 `__last_query__`，不出现在「我的模板」列表里（列表按 isLastUsed 排在前，
   * 但前端可选择隐藏）。
   */
  async rememberLastQuery(ownerUserId: string, config: PivotConfig) {
    const dataSource = this.assertConfig(config);
    const LAST_KEY = '__last_query__';

    await this.db.transaction(async (tx) => {
      await tx
        .delete(reportPivotTemplate)
        .where(
          and(
            eq(reportPivotTemplate.ownerUserId, ownerUserId),
            eq(reportPivotTemplate.isLastUsed, true),
          ),
        );
      await tx
        .insert(reportPivotTemplate)
        .values({
          ownerUserId,
          name: LAST_KEY,
          config: config as unknown as Record<string, unknown>,
          dataSource,
          isLastUsed: true,
          remark: '自动记录的最近一次查询',
          createdBy: ownerUserId,
          updatedBy: ownerUserId,
        })
        .onConflictDoUpdate({
          target: [reportPivotTemplate.ownerUserId, reportPivotTemplate.name],
          set: {
            config: config as unknown as Record<string, unknown>,
            dataSource,
            isLastUsed: true,
            updatedAt: sql`CURRENT_TIMESTAMP`,
            updatedBy: ownerUserId,
          },
        });
    });

    return { remembered: true, dataSource };
  }

  /** 恢复我最后一次查询；从未记录过则返回 null（前端据 null 走默认，不报错） */
  async getLastQuery(ownerUserId: string): Promise<PivotConfig | null> {
    const [row] = await this.db
      .select({ config: reportPivotTemplate.config })
      .from(reportPivotTemplate)
      .where(
        and(
          eq(reportPivotTemplate.ownerUserId, ownerUserId),
          eq(reportPivotTemplate.isLastUsed, true),
        ),
      )
      .limit(1);
    return (row?.config as unknown as PivotConfig) ?? null;
  }

  /** 删除我的模板（owner 条件在 where 内，越权删除会得到「不存在」） */
  async remove(ownerUserId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(reportPivotTemplate)
      .where(
        and(
          eq(reportPivotTemplate.id, id),
          eq(reportPivotTemplate.ownerUserId, ownerUserId),
        ),
      )
      .returning({ id: reportPivotTemplate.id });
    if (deleted.length === 0) {
      throw new NotFoundException('模板不存在或不属于当前用户');
    }
  }

  /**
   * 轻量校验：只取 dataSource 供列表展示与后续扩展，
   * 完整的字段合法性仍由 PivotEngine 的白名单校验负责（保持单一校验点）。
   */
  private assertConfig(config: PivotConfig): PivotDataSource {
    const ds = config?.dataSource;
    const allowed: PivotDataSource[] = ['sales', 'purchase', 'inventory', 'transfer'];
    if (!ds || !allowed.includes(ds)) {
      throw new BadRequestException(`不支持的数据源: ${String(ds)}`);
    }
    return ds;
  }
}
