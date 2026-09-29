import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  store,
  replenishTemplate,
} from '@server/database/schema';
import { ReplenishPlanService } from './replenish-plan.service';

type ReplenishTemplateRow = typeof replenishTemplate.$inferSelect;

export interface StoreFilter {
  ids?: string[];
  storeType?: 'direct' | 'franchise';
}
export interface SkuFilter {
  ids?: string[];
}

export interface ReplenishTemplateInput {
  name: string;
  code: string;
  scopeType?: 'all' | 'store' | 'store_type';
  storeFilter?: StoreFilter;
  skuFilter?: SkuFilter;
  paramN?: number;
  expectedDays?: number;
  leadTimeDays?: number;
  safetyDays?: number;
  caseQty?: number;
  sourceWarehouseRule?: 'fixed' | 'nearest' | 'central';
  fixedWarehouseId?: string;
  enabled?: boolean;
  cron?: string;
}

export interface ExecuteSummary {
  templateId: string;
  templateCode: string;
  totalStores: number;
  successStores: number;
  failedStores: number;
  totalDocs: number;
  results: {
    storeId: string;
    storeName: string;
    storeType: string;
    docNo?: string;
    docType?: string;
    itemCount?: number;
    error?: string;
  }[];
}

/**
 * 补货模板（Phase 2）：将“计算参数 + 作用范围 + 生成规则 + 定时 cron”
 * 固化为可复用配置，供调度器到点自动生成草稿单据。
 */
@Injectable()
export class ReplenishTemplateService {
  private readonly logger = new Logger(ReplenishTemplateService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly planService: ReplenishPlanService,
  ) {}

  private get enabledCond() {
    return eq(replenishTemplate.enabled, true);
  }

  /** 列出启用中的模板（调度器使用）。 */
  async listEnabled(): Promise<ReplenishTemplateRow[]> {
    return this.db
      .select()
      .from(replenishTemplate)
      .where(and(isNull(replenishTemplate.deletedAt), this.enabledCond))
      .orderBy(desc(replenishTemplate.createdAt));
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    enabled?: boolean;
    keyword?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const conditions: any[] = [isNull(replenishTemplate.deletedAt)];
    if (typeof query.enabled === 'boolean')
      conditions.push(eq(replenishTemplate.enabled, query.enabled));
    if (query.keyword)
      conditions.push(
        sql`(${replenishTemplate.name} ILIKE ${`%${query.keyword}%`} OR ${replenishTemplate.code} ILIKE ${`%${query.keyword}%`})`,
      );
    const where = and(...conditions);

    const [totalRows, rows] = await Promise.all([
      this.db.select({ c: sql`count(*)` }).from(replenishTemplate).where(where),
      this.db
        .select()
        .from(replenishTemplate)
        .where(where)
        .orderBy(desc(replenishTemplate.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    return { total: Number(totalRows[0]?.c ?? 0), list: rows };
  }

  async get(id: string) {
    const rows = await this.db
      .select()
      .from(replenishTemplate)
      .where(and(eq(replenishTemplate.id, id), isNull(replenishTemplate.deletedAt)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('补货模板不存在');
    return rows[0];
  }

  async create(dto: ReplenishTemplateInput) {
    if (!dto.name) throw new BadRequestException('模板名称必填');
    if (!dto.code) throw new BadRequestException('模板编码必填');
    await this.assertCodeUnique(dto.code);
    if (dto.enabled && !dto.cron)
      throw new BadRequestException('启用定时生成必须填写 cron 表达式');
    const [row] = await this.db
      .insert(replenishTemplate)
      .values({
        name: dto.name,
        code: dto.code,
        scopeType: dto.scopeType ?? 'all',
        storeFilter: (dto.storeFilter as any) ?? null,
        skuFilter: (dto.skuFilter as any) ?? null,
        paramN: dto.paramN ?? 30,
        expectedDays: dto.expectedDays ?? 14,
        leadTimeDays: dto.leadTimeDays ?? 0,
        safetyDays: dto.safetyDays ?? 0,
        caseQty: String(dto.caseQty ?? 1),
        sourceWarehouseRule: dto.sourceWarehouseRule ?? 'fixed',
        fixedWarehouseId: dto.fixedWarehouseId ?? null,
        enabled: dto.enabled ?? false,
        cron: dto.cron ?? null,
      })
      .returning();
    return row;
  }

  async update(id: string, dto: Partial<ReplenishTemplateInput>) {
    const existing = await this.get(id); // 存在性校验
    if (dto.code) await this.assertCodeUnique(dto.code, id);
    // 启用定时生成时，cron 必须存在（取本次传入或既有值）
    const effectiveCron = dto.cron ?? existing.cron ?? undefined;
    if (dto.enabled === true && !effectiveCron)
      throw new BadRequestException('启用定时生成必须填写 cron 表达式');

    // 仅更新显式传入的字段，避免 PATCH 把未传字段清零
    const set: Record<string, any> = { updatedAt: new Date() };
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.code !== undefined) set.code = dto.code;
    if (dto.scopeType !== undefined) set.scopeType = dto.scopeType;
    if (dto.storeFilter !== undefined) set.storeFilter = dto.storeFilter as any;
    if (dto.skuFilter !== undefined) set.skuFilter = dto.skuFilter as any;
    if (dto.paramN !== undefined) set.paramN = dto.paramN;
    if (dto.expectedDays !== undefined) set.expectedDays = dto.expectedDays;
    if (dto.leadTimeDays !== undefined) set.leadTimeDays = dto.leadTimeDays;
    if (dto.safetyDays !== undefined) set.safetyDays = dto.safetyDays;
    if (dto.caseQty !== undefined) set.caseQty = String(dto.caseQty);
    if (dto.sourceWarehouseRule !== undefined) set.sourceWarehouseRule = dto.sourceWarehouseRule;
    if (dto.fixedWarehouseId !== undefined) set.fixedWarehouseId = dto.fixedWarehouseId;
    if (dto.enabled !== undefined) set.enabled = dto.enabled;
    if (dto.cron !== undefined) set.cron = dto.cron;

    const [row] = await this.db
      .update(replenishTemplate)
      .set(set)
      .where(eq(replenishTemplate.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.get(id);
    // 软删除，保留历史关联
    await this.db
      .update(replenishTemplate)
      .set({ deletedAt: new Date().toISOString() as any })
      .where(eq(replenishTemplate.id, id));
    return { id, deleted: true };
  }

  private async assertCodeUnique(code: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: replenishTemplate.id })
      .from(replenishTemplate)
      .where(and(eq(replenishTemplate.code, code), isNull(replenishTemplate.deletedAt)))
      .limit(1);
    if (rows.length && rows[0].id !== exceptId)
      throw new BadRequestException(`模板编码已存在: ${code}`);
  }

  /** 解析作用范围命中的门店。 */
  private async resolveStores(tpl: ReplenishTemplateRow) {
    const sf = (tpl.storeFilter as StoreFilter) || {};
    if (tpl.scopeType === 'store' && sf.ids?.length) {
      return this.db.select().from(store).where(inArray(store.id, sf.ids));
    }
    if (tpl.scopeType === 'store_type' && sf.storeType) {
      return this.db
        .select()
        .from(store)
        .where(eq(store.storeType, sf.storeType));
    }
    // all
    return this.db.select().from(store);
  }

  /**
   * 执行模板一次：遍历命中门店，逐店 calc + generate 草稿单据。
   * 单店失败不影响其余门店（调度器需足够健壮）。
   */
  async executeTemplate(templateId: string): Promise<ExecuteSummary> {
    const tpl = await this.get(templateId);
    const stores = await this.resolveStores(tpl);
    const skuFilter = (tpl.skuFilter as SkuFilter)?.ids;
    const sourceWarehouseId =
      tpl.sourceWarehouseRule === 'fixed' ? tpl.fixedWarehouseId ?? undefined : undefined;

    const summary: ExecuteSummary = {
      templateId: tpl.id,
      templateCode: tpl.code,
      totalStores: stores.length,
      successStores: 0,
      failedStores: 0,
      totalDocs: 0,
      results: [],
    };

    for (const st of stores) {
      const entry = {
        storeId: st.id,
        storeName: st.name,
        storeType: st.storeType,
      };
      try {
        const calcResult = await this.planService.calc({
          storeId: st.id,
          n: tpl.paramN,
          expectedDays: tpl.expectedDays,
          leadTimeDays: tpl.leadTimeDays,
          safetyDays: tpl.safetyDays,
          caseQty: Number(tpl.caseQty ?? 1),
          skuFilter,
        });
        const items = calcResult.items
          .filter((it) => it.suggestedQty > 0)
          .map((it) => ({ skuId: it.skuId, suggestedQty: it.suggestedQty }));
        if (!items.length) {
          summary.results.push({ ...entry, error: '无建议补货量，跳过' });
          summary.successStores += 1;
          continue;
        }
        const res = await this.planService.generate({
          storeId: st.id,
          items,
          sourceWarehouseId,
          templateId: tpl.id,
          remark: `补货模板[${tpl.code}]自动生成`,
        });
        summary.results.push({
          ...entry,
          docNo: res.docNo,
          docType: res.docType,
          itemCount: res.itemCount,
        });
        summary.successStores += 1;
        summary.totalDocs += 1;
      } catch (e: any) {
        summary.results.push({ ...entry, error: e?.message || String(e) });
        summary.failedStores += 1;
        this.logger.warn(`模板[${tpl.code}] 门店[${st.name}]生成失败: ${e?.message}`);
      }
    }
    this.logger.log(
      `模板[${tpl.code}]执行完成：门店${summary.totalStores}，成功${summary.successStores}，失败${summary.failedStores}，生成单据${summary.totalDocs}`,
    );
    return summary;
  }
}
