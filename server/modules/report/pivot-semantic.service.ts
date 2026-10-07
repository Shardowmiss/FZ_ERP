import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, eq, sql } from 'drizzle-orm';
import { pivotSemantic } from '@server/database/schema';

/**
 * 透视语义层服务（迁移 0061）。
 *
 * 职责：把「维度/指标的 key、中文标签、分类、格式化、敏感标记」从代码搬到配置表，
 * 让业务/实施新增分析维度**只需 INSERT 一行**，不必改前后端代码发版。
 *
 * 安全边界（受控模板，不是任意 SQL 执行）：
 *   1. 前端只提交 key，SQL 片段始终由服务端从配置读取，请求无法注入；
 *   2. 物理列的可用性由 pivot-engine 的代码白名单把关——配置只能「开放」已实现的
 *      维度/指标 key，不能凭空创造新的 SQL 表达式；
 *      （即：语义层控制「哪些可用 + 叫什么 + 归类」，代码控制「怎么算」。）
 *   3. 敏感指标（毛利/成本）标 sensitive，由 controller 结合 finance:profit 剥离。
 *
 * 兜底：配置表读取失败时返回 null，引擎继续用内置白名单，
 * 保证语义层故障不会让透视整体不可用。
 */
@Injectable()
export class PivotSemanticService {
  private readonly logger = new Logger(PivotSemanticService.name);
  /** 进程内缓存，避免每次查询都读库；TTL 60s 让「改了配置立即生效」不至于太慢 */
  private cache: { at: number; data: SemanticField[] } | null = null;
  private static readonly TTL_MS = 60_000;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 读全部启用中的语义（带 TTL 缓存） */
  async listEnabled(): Promise<SemanticField[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < PivotSemanticService.TTL_MS) {
      return this.cache.data;
    }
    try {
      const rows = await this.db
        .select({
          key: pivotSemantic.key,
          label: pivotSemantic.label,
          kind: pivotSemantic.kind,
          dataSources: pivotSemantic.dataSources,
          category: pivotSemantic.category,
          sortOrder: pivotSemantic.sortOrder,
          valueFormat: pivotSemantic.valueFormat,
          sensitive: pivotSemantic.sensitive,
        })
        .from(pivotSemantic)
        .where(eq(pivotSemantic.enabled, true))
        .orderBy(asc(pivotSemantic.sortOrder));
      // drizzle 对 varchar 列返回 string，此处收窄为字面量联合类型
      const data = rows as SemanticField[];
      this.cache = { at: now, data };
      return data;
    } catch (e) {
      this.logger.warn(`语义层读取失败，回退内置白名单：${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 取某数据源可用的 key 集合。
   * 语义行的 data_sources 是逗号分隔（如 'sales,purchase'），故用 LIKE 匹配。
   */
  async keysOf(dataSource: string): Promise<Set<string>> {
    const rows = await this.listEnabled();
    return new Set(
      rows
        .filter((r) => r.dataSources.split(',').map((s) => s.trim()).includes(dataSource))
        .map((r) => r.key),
    );
  }

  /**
   * 启动期自检：语义表中登记的 key 是否都被引擎实现了。
   *
   * 这是「语义层不降低安全性」的关键——若有人往配置表塞了一个引擎不支持的 key，
   * 必须在启动时就发现（fail fast），而不是等业务用到时才报 400。
   * 只告警不抛错：配置表是增强项，不应阻止应用启动。
   */
  async validateAgainstEngine(
    engineSupported: Record<string, Set<string>>,
  ): Promise<{ checked: number; unknown: string[] }> {
    const rows = await this.listEnabled();
    const unknown: string[] = [];
    let checked = 0;
    for (const r of rows) {
      const sources = r.dataSources.split(',').map((s) => s.trim());
      for (const ds of sources) {
        const supported = engineSupported[ds];
        if (!supported) continue; // 该数据源引擎未提供白名单，跳过
        checked += 1;
        if (!supported.has(r.key)) {
          unknown.push(`${ds}.${r.key}`);
        }
      }
    }
    if (unknown.length > 0) {
      this.logger.warn(
        `语义层登记了引擎未实现的字段（将不可用，请补实现或停用）：${unknown.join(', ')}`,
      );
    } else {
      this.logger.log(`语义层自检通过：${checked} 个「数据源×字段」组合均已实现`);
    }
    return { checked, unknown };
  }

  /** 强制清缓存（配置变更后调用，或测试用） */
  invalidateCache(): void {
    this.cache = null;
  }
}

export interface SemanticField {
  key: string;
  label: string;
  kind: 'dimension' | 'measure';
  dataSources: string;
  category: string;
  sortOrder: number;
  valueFormat: 'sum' | 'avg' | 'count' | 'ratio' | 'amount';
  sensitive: boolean;
}
