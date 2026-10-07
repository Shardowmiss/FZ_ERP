import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  /* ===================== 管理端写操作（#758语义层管理界面） =====================
   * 设计约束：**语义层只能「开放已实现的 key」，不能凭空创造 SQL。**
   * 因此 create() 必须拿引擎白名单做闸门——这是把#757 的边界设计
   * 从「口头约定」变成「代码强制」的一步。否则有人往表里塞个引擎不认的 key，
   * 业务点透视才发现是「非法字段」，配置者却不知道错在哪。
   */

  /** 列出全部语义（含停用），供管理页展示；启用中的才带缓存，故此处不走 listEnabled */
  async listAll(): Promise<SemanticRow[]> {
    const rows = await this.db
      .select()
      .from(pivotSemantic)
      .orderBy(asc(pivotSemantic.sortOrder));
    return rows as SemanticRow[];
  }

  /**
   * 新增语义。
   *
   * @param engineSupported 引擎白名单快照（形如 `{ sales: Set<string>, ... }`）
   * @param actorId 操作人，写入 remark 便于日后追溯「这条是谁加的」
   */
  async create(
    input: CreateSemanticInput,
    engineSupported: Record<string, Set<string>>,
    actorId: string,
  ): Promise<SemanticRow> {
    const key = (input.key ?? '').trim();
    if (!key) throw new BadRequestException('字段 key 不能为空');
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
      throw new BadRequestException('字段 key 只能由字母/数字/下划线组成，且须以字母开头');
    }
    if (!input.label?.trim()) throw new BadRequestException('中文标签不能为空');

    const dataSources = requireDataSources(input.dataSources);
    assertEngineSupports(key, dataSources, engineSupported, input.kind);

    const [exist] = await this.db
      .select({ key: pivotSemantic.key })
      .from(pivotSemantic)
      .where(eq(pivotSemantic.key, key))
      .limit(1);
    if (exist) throw new BadRequestException(`字段 key「${key}」已存在，请直接编辑`);

    const [row] = await this.db
      .insert(pivotSemantic)
      .values({
        key,
        label: input.label.trim(),
        kind: input.kind,
        dataSources: dataSources.join(','),
        category: input.category?.trim() || '其他',
        sortOrder: input.sortOrder ?? 100,
        valueFormat: input.valueFormat ?? 'sum',
        sensitive: input.sensitive ?? false,
        enabled: input.enabled ?? true,
        remark: input.remark?.trim() || `由 ${actorId} 于语义层管理界面新增`,
      })
      .returning();
    this.invalidateCache();
    this.logger.log(`语义层新增：${key}（${dataSources.join(',')}）by ${actorId}`);
    return row as SemanticRow;
  }

  /** 编辑语义。key 不可改（它是代码侧的物理标识，改了等于换字段） */
  async update(
    key: string,
    patch: UpdateSemanticInput,
    engineSupported: Record<string, Set<string>>,
  ): Promise<SemanticRow> {
    const [row] = await this.db
      .select()
      .from(pivotSemantic)
      .where(eq(pivotSemantic.key, key))
      .limit(1);
    if (!row) throw new NotFoundException(`字段 key「${key}」不存在`);

    // 若改了数据源/类型，需重新过引擎闸门（可能改成引擎不支持的组合）
    const nextSources = patch.dataSources !== undefined
      ? requireDataSources(patch.dataSources)
      : (row.dataSources.split(',').map((s: string) => s.trim()));
    const nextKind = patch.kind ?? (row.kind as 'dimension' | 'measure');
    assertEngineSupports(key, nextSources, engineSupported, nextKind);

    const [updated] = await this.db
      .update(pivotSemantic)
      .set({
        ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category.trim() || '其他' } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.valueFormat !== undefined ? { valueFormat: patch.valueFormat } : {}),
        ...(patch.sensitive !== undefined ? { sensitive: patch.sensitive } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.remark !== undefined ? { remark: patch.remark } : {}),
        ...(patch.dataSources !== undefined ? { dataSources: nextSources.join(',') } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pivotSemantic.key, key))
      .returning();
    this.invalidateCache();
    this.logger.log(`语义层更新：${key}`);
    return updated as SemanticRow;
  }

  /**
   * 删除语义。
   *
   * **刻意不提供「删除」，只提供停用（enabled=false）**：字段 key 是业务已保存的
   * 个人模板（report_pivot_template 的 config 里存着 key 数组）的一部分，
   * 删掉后老模板会带着失效 key 在用户点开时抛 400。停用则是可逆的安全操作。
   * 需要清理失效模板由用户自己删模板。
   */
  async remove(key: string): Promise<{ success: boolean }> {
    const [row] = await this.db
      .update(pivotSemantic)
      .set({ enabled: false, updatedAt: new Date().toISOString() })
      .where(eq(pivotSemantic.key, key))
      .returning({ key: pivotSemantic.key });
    this.invalidateCache();
    if (!row) throw new NotFoundException(`字段 key「${key}」不存在`);
    this.logger.log(`语义层停用：${key}（保留 key 以免历史模板失效）`);
    return { success: true };
  }
}

/** 校验 key 是否被引擎在**所有**所选数据源实现 */
function assertEngineSupports(
  key: string,
  dataSources: string[],
  engineSupported: Record<string, Set<string>>,
  kind: string,
): void {
  const bad: string[] = [];
  for (const ds of dataSources) {
    const set = engineSupported[ds];
    if (!set) {
      bad.push(`${ds}(未知数据源)`);
      continue;
    }
    if (!set.has(key)) bad.push(ds);
  }
  if (bad.length > 0) {
    throw new BadRequestException(
      `引擎尚未实现字段「${key}」在数据源 ${bad.join('、')} 下的${kind === 'dimension' ? '维度' : '指标'}表达式，` +
        `配置表只能开放已实现的字段（不能凭空生成 SQL）。请改选其他数据源，或由研发在 pivot-engine 中实现后再配置。`,
    );
  }
}

/**
 * 归一化数据源列表并**强制非空 + 全合法**。
 *
 * 为什么不能只做过滤：单纯过滤会把 `[]` / `''` / 全非法值都归一化成 `[]`，
 * 若直接写库，data_sources 变成空串——该字段在所有数据源上都会消失，
 * 且因为它仍 enabled，管理页看不出异常，只是「透视里找不到这个字段」。
 * update() 曾缺这道闸（create() 有），实测可把 warehouse 的范围静默清空。
 * 另外「部分非法」也不能静默丢弃：配置者会以为「采购」已生效，
 * 直到业务查不出数才发现。故两种情况都明确报错。
 * 要下线字段请用 enabled=false（有明确语义且在管理页可见）。
 */
function requireDataSources(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(',');
  const trimmed = raw.map((s) => String(s).trim()).filter((s) => s.length > 0);
  const valid = new Set(['sales', 'purchase', 'inventory', 'transfer']);
  const arr = Array.from(new Set(trimmed.filter((s) => valid.has(s))));
  if (arr.length === 0) {
    throw new BadRequestException(
      '至少保留一个适用数据源。若要下线该字段，请用「停用」（enabled=false）而不是清空数据源。',
    );
  }
  // 部分非法时明确报错，而不是悄悄丢弃——静默丢弃会让配置者
  // 以为「采购」已生效，实际被过滤掉，直到业务查不出数才发现。
  const unknown = trimmed.filter((s) => !valid.has(s));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `未知的数据源：${unknown.join('、')}。合法值为 sales / purchase / inventory / transfer。`,
    );
  }
  return arr;
}

export interface SemanticRow extends SemanticField {
  enabled: boolean;
  remark: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CreateSemanticInput {
  key: string;
  label: string;
  kind: 'dimension' | 'measure';
  dataSources: string | string[];
  category?: string;
  sortOrder?: number;
  valueFormat?: 'sum' | 'avg' | 'count' | 'ratio' | 'amount';
  sensitive?: boolean;
  enabled?: boolean;
  remark?: string;
}

export interface UpdateSemanticInput {
  label?: string;
  kind?: 'dimension' | 'measure';
  dataSources?: string | string[];
  category?: string;
  sortOrder?: number;
  valueFormat?: 'sum' | 'avg' | 'count' | 'ratio' | 'amount';
  sensitive?: boolean;
  enabled?: boolean;
  remark?: string;
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
