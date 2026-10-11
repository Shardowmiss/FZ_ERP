import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  eq,
  and,
  count,
  desc,
  or,
  ilike,
  like,
  inArray,
  sql,
  isNull,
} from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { escapeLike } from '@server/common/utils/escape-like';
import { dealer, store, preOrder, allocationItem, warehouse, supplier } from '@server/database/schema';
import { encryptField, hmacField, decryptField } from '@server/common/crypto/field-encryption';
import type { Dealer } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

type DealerInsert = typeof dealer.$inferInsert;

/** 根节点（无上级）的上级名称固定显示「总部」 */
const ROOT_PARENT_NAME = '总部';

/** 经销商字段投影（不含上级名称；上级名称在 Service 层按 parent_id 解析，避免自连接别名问题）。 */
const dealerColumns = {
  id: dealer.id,
  code: dealer.code,
  name: dealer.name,
  parentId: dealer.parentId,
  contactPerson: dealer.contactPerson,
  phone: dealer.phone,
  address: dealer.address,
  status: dealer.status,
  remark: dealer.remark,
  createdAt: dealer.createdAt,
} as const;

@Injectable()
export class DealerService {
  private readonly logger = new Logger(DealerService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 按 parent_id 批量解析上级名称（根为「总部」）。 */
  private async resolveParentNames(parentIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(parentIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: dealer.id, name: dealer.name })
      .from(dealer)
      .where(inArray(dealer.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private mapRow(row: Record<string, any>): Dealer {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parentId ?? undefined,
      parentName: row.parentName ?? ROOT_PARENT_NAME,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    status?: string,
  ): Promise<{ items: Dealer[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(dealer.code, `%${escaped}%`), ilike(dealer.name, `%${escaped}%`)));
    }
    if (status) conditions.push(eq(dealer.status, status));
    // 行级数据权限：经销商主数据按可见范围隔离，非本用户可见经销商不可见（防跨租户读取）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: dealer.id },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(dealer).where(where as any),
      this.db
        .select(dealerColumns)
        .from(dealer)
        .where(where as any)
        .orderBy(desc(dealer.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const parentNames = await this.resolveParentNames(rows.map((r) => r.parentId));
    const total = Number(countResult[0]?.count ?? 0);
    const items: Dealer[] = rows.map((row) => {
      const parentName = row.parentId
        ? parentNames.get(row.parentId) ?? ROOT_PARENT_NAME
        : ROOT_PARENT_NAME;
      return this.mapRow({ ...row, parentName } as Record<string, any>);
    });

    return { items, total, page, pageSize };
  }

  async detail(id: string): Promise<Dealer> {
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: dealer.id },
    );
    const rows = await this.db
      .select(dealerColumns)
      .from(dealer)
      .where(scopeCond ? and(eq(dealer.id, id), scopeCond) : eq(dealer.id, id));
    if (rows.length === 0) throw new NotFoundException('经销商不存在');
    const row = rows[0];
    let parentName = ROOT_PARENT_NAME;
    if (row.parentId) {
      const p = await this.db
        .select({ name: dealer.name })
        .from(dealer)
        .where(eq(dealer.id, row.parentId));
      parentName = p.length > 0 ? p[0].name : ROOT_PARENT_NAME;
    }
    return this.mapRow({ ...row, parentName } as Record<string, any>);
  }

  async create(dto: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    remark?: string;
    status?: string;
    parentId?: string | null;
  }): Promise<Dealer> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');

    const existing = await this.db.select().from(dealer).where(eq(dealer.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const parentId = dto.parentId || null;
    let parent: typeof dealer.$inferSelect | undefined;
    let level = 0;
    let partnerType = 'hq';
    if (parentId) {
      const parentRows = await this.db.select().from(dealer).where(eq(dealer.id, parentId));
      if (parentRows.length === 0) throw new BadRequestException('上级经销商不存在');
      parent = parentRows[0];
      level = (parent.level ?? 0) + 1;
      partnerType = `level${level}`;
    }

    // 自生成主键，便于在写入前即可拼出 tree_path（前缀一致性约束）
    // 注意：无上级时 parent 为 undefined，原写法 `parent?.treePath || `/${parent!.id}``
    // 会对 undefined 取属性导致 TypeError（新建总部/根经销商必然踩中），此处改为显式分支。
    const newId = randomUUID();
    const treePath =
      parent ? `${parent.treePath || `/${parent.id}`}/${newId}` : `/${newId}`;

    // 该节点挂到了某个上级之下 ⇒ 上级从此需要对下级开销售单，需具备「供应商身份」。
    // 在此自动补齐，避免再次出现 0006 迁移后那种"中间节点缺供应商身份导致镜像静默跳过"的漂移。
    if (parent) {
      await this.ensureSupplierIdentity(parent.id);
    }

    const values: DealerInsert = {
      id: newId,
      code: dto.code,
      name: dto.name,
      contactPerson: dto.contactPerson ?? null,
      phone: encryptField(dto.phone) ?? null,
      phoneHmac: hmacField(dto.phone),
      address: dto.address ?? null,
      remark: dto.remark ?? null,
      status: dto.status ?? 'active',
      parentId: (parentId ?? null) as any,
      level: level as any,
      treePath: treePath as any,
      partnerType: partnerType as any,
    };

    const inserted = await this.db.insert(dealer).values(values).returning();
    const row = inserted[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: parentId ?? undefined,
      parentName: parentId ? (parent?.name ?? ROOT_PARENT_NAME) : ROOT_PARENT_NAME,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  async update(
    id: string,
    dto: {
      code?: string;
      name?: string;
      contactPerson?: string | null;
      phone?: string | null;
      address?: string | null;
      remark?: string | null;
      status?: string;
      parentId?: string | null;
    },
  ): Promise<Dealer> {
    const selfRows = await this.db.select().from(dealer).where(eq(dealer.id, id));
    if (selfRows.length === 0) throw new NotFoundException('经销商不存在');
    const self = selfRows[0];

    const patch: Partial<DealerInsert> = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.contactPerson !== undefined) patch.contactPerson = dto.contactPerson ?? null;
    if (dto.phone !== undefined) {
      patch.phone = encryptField(dto.phone) ?? null;
      patch.phoneHmac = hmacField(dto.phone);
    }
    if (dto.address !== undefined) patch.address = dto.address ?? null;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    // 是否变更上级
    let newParentId = self.parentId ?? null;
    let changedParent = false;
    if (dto.parentId !== undefined) {
      const pid = dto.parentId || null;
      if (pid !== (self.parentId ?? null)) {
        newParentId = pid;
        changedParent = true;
      }
    }

    if (Object.keys(patch).length === 0 && !changedParent) {
      throw new BadRequestException('未提供可更新字段');
    }

    if (changedParent) {
      await this.reparent(id, newParentId);
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      const updated = await this.db.update(dealer).set(patch).where(eq(dealer.id, id)).returning();
      if (updated.length === 0) throw new NotFoundException('经销商不存在');
    }

    const finalRows = await this.db.select().from(dealer).where(eq(dealer.id, id));
    const row = finalRows[0];
    const parentName = newParentId ? ((await this.parentNameOf(newParentId)) ?? ROOT_PARENT_NAME) : ROOT_PARENT_NAME;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: newParentId ?? undefined,
      parentName,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  async remove(id: string): Promise<void> {
    // 引用检查：门店、订货会预售单、配货单、仓库
    // 同时禁止删除存在下级经销商的节点（onDelete restrict 也会兜底）
    const [storeCount, preOrderCount, allocCount, warehouseCount, childCount] = await Promise.all([
      this.db.select({ count: count() }).from(store).where(eq(store.dealerId, id)),
      this.db.select({ count: count() }).from(preOrder).where(eq(preOrder.dealerId, id)),
      this.db.select({ count: count() }).from(allocationItem).where(eq(allocationItem.dealerId, id)),
      this.db.select({ count: count() }).from(warehouse).where(eq(warehouse.dealerId, id)),
      this.db.select({ count: count() }).from(dealer).where(eq(dealer.parentId, id)),
    ]);

    if (Number(childCount[0]?.count ?? 0) > 0) {
      throw new ConflictException('该经销商存在下级经销商，请先调整下级后再删除');
    }

    const hasReference = [
      storeCount[0]?.count,
      preOrderCount[0]?.count,
      allocCount[0]?.count,
      warehouseCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasReference) {
      throw new ConflictException('经销商存在关联单据，无法删除');
    }

    const deleted = await this.db.delete(dealer).where(eq(dealer.id, id)).returning({ id: dealer.id });
    if (deleted.length === 0) throw new NotFoundException('经销商不存在');
  }

  async options(excludeId?: string): Promise<{ id: string; code: string; name: string }[]> {
    const rows = await this.db
      .select({ id: dealer.id, code: dealer.code, name: dealer.name })
      .from(dealer)
      .where(eq(dealer.status, 'active'))
      .orderBy(dealer.code);

    if (!excludeId) {
      return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
    }
    // 编辑时排除自身及其全部后代，避免形成环
    const excludeIds = new Set([excludeId, ...(await this.descendantIds(excludeId))]);
    return rows
      .filter((row) => !excludeIds.has(row.id))
      .map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }

  /** 取某节点的全部后代 ID（不含自身），依据 tree_path 前缀匹配 */
  private async descendantIds(id: string): Promise<string[]> {
    const self = await this.db
      .select({ treePath: dealer.treePath })
      .from(dealer)
      .where(eq(dealer.id, id));
    if (self.length === 0 || !self[0].treePath) return [];
    const tp = self[0].treePath;
    const rows = await this.db
      .select({ id: dealer.id })
      .from(dealer)
      .where(like(dealer.treePath, `${tp}/%`));
    return rows.map((r) => r.id);
  }

  private async parentNameOf(parentId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: dealer.name })
      .from(dealer)
      .where(eq(dealer.id, parentId));
    return rows.length > 0 ? rows[0].name : null;
  }

  /**
   * 确保指定经销商具备「供应商身份」（supplier.partner_id = dealer.id）。
   *
   * 为什么必须有：多级分销镜像引擎 DistributionMirrorService.resolveMirrorContext 是
   * 「下级 → parent_id → 上级的 supplier 主数据」三级跳转来定位上家的。任何拥有下级的节点
   * 若缺少该身份，引擎会 return null 并把销售单静默标记为 mirror_status='skipped'，
   * 下游采购单一张都不会生成 —— 这正是本次修复前 39 个节点踩中的坑。
   *
   * 幂等：已存在（且未软删）则直接返回，不重复创建。
   */
  private async ensureSupplierIdentity(dealerId: string): Promise<void> {
    const existing = await this.db
      .select({ id: supplier.id })
      .from(supplier)
      .where(and(eq(supplier.partnerId, dealerId), isNull(supplier.deletedAt)))
      .limit(1);
    if (existing.length > 0) return;

    const dealerRows = await this.db
      .select({
        name: dealer.name,
        contactPerson: dealer.contactPerson,
        phone: dealer.phone,
        phoneHmac: dealer.phoneHmac,
        address: dealer.address,
      })
      .from(dealer)
      .where(eq(dealer.id, dealerId))
      .limit(1);
    if (dealerRows.length === 0) return;
    const d = dealerRows[0];

    // 沿用现有 GYS#### 编号体系：取当前最大序号 +1，规避 code 唯一键冲突
    const maxNoRows = await this.db
      .select({
        maxNo: sql<number>`coalesce(max(substring(${supplier.code} from 4)::int), 0)`,
      })
      .from(supplier)
      .where(sql`${supplier.code} ~ '^GYS[0-9]+$'`);
    const code = `GYS${String(Number(maxNoRows[0]?.maxNo ?? 0) + 1).padStart(4, '0')}`;

    await this.db.insert(supplier).values({
      code,
      name: d.name,
      contactPerson: d.contactPerson ?? null,
      phone: d.phone ?? null,
      phoneHmac: d.phoneHmac ?? null,
      address: d.address ?? null,
      supplyCategory: '分销供货',
      remark: '多级分销：作为发货方自动生成的供应商身份',
      status: 'active',
      partnerId: dealerId,
    });
    this.logger.log(`已为「${d.name}」自动生成供应商身份 ${code}`);
  }

  /**
   * 将节点挂到新上级，并级联重建自身与全部后代的 tree_path / level / partner_type。
   * 采用「前缀替换」策略：后代新路径 = 新自身路径 + 旧自身路径后缀，层级整体平移 levelDelta。
   * 调用前需保证 newParentId 已通过环检测。
   */
  private async reparent(id: string, newParentId: string | null): Promise<void> {
    const selfRows = await this.db.select().from(dealer).where(eq(dealer.id, id));
    if (selfRows.length === 0) throw new NotFoundException('经销商不存在');
    const self = selfRows[0];
    const oldTreePath = self.treePath || `/${id}`;
    const oldLevel = self.level ?? 0;

    let newTreePath: string;
    let newLevel: number;
    let newPartnerType: string;

    if (!newParentId) {
      newLevel = 0;
      newTreePath = `/${id}`;
      newPartnerType = 'hq';
    } else {
      if (newParentId === id) throw new BadRequestException('上级经销商不能是自身');
      const parentRows = await this.db.select().from(dealer).where(eq(dealer.id, newParentId));
      if (parentRows.length === 0) throw new BadRequestException('上级经销商不存在');
      const parent = parentRows[0];
      const parentTreePath = parent.treePath || `/${parent.id}`;
      // 环检测：新上级不能是自身或自身后代
      if (parentTreePath === oldTreePath || parentTreePath.startsWith(`${oldTreePath}/`)) {
        throw new BadRequestException('上级经销商不能是自身或下级节点');
      }
      newLevel = (parent.level ?? 0) + 1;
      newTreePath = `${parentTreePath}/${id}`;
      newPartnerType = `level${newLevel}`;
    }

    // 变更到某个上级之下 ⇒ 该上级从此需要对本节点开销售单，需具备「供应商身份」。
    // 放在环检测通过之后、写库之前：既避免为非法上级脏写身份，也保证自节点落库前上级已就绪。
    if (newParentId) {
      await this.ensureSupplierIdentity(newParentId);
    }

    const levelDelta = newLevel - oldLevel;

    // 先取后代（仍指向旧树路径），再变更自身，最后批量平移后代
    const descendants = oldTreePath
      ? await this.db
          .select({ id: dealer.id, treePath: dealer.treePath, level: dealer.level })
          .from(dealer)
          .where(like(dealer.treePath, `${oldTreePath}/%`))
      : [];

    await this.db
      .update(dealer)
      .set({
        parentId: (newParentId ?? null) as any,
        level: newLevel as any,
        treePath: newTreePath as any,
        partnerType: newPartnerType as any,
        updatedAt: new Date(),
      })
      .where(eq(dealer.id, id));

    for (const d of descendants) {
      const suffix = (d.treePath || '').slice(oldTreePath.length); // 含前导 "/"
      const dNewTreePath = newTreePath + suffix;
      const dNewLevel = (d.level ?? 0) + levelDelta;
      await this.db
        .update(dealer)
        .set({
          treePath: dNewTreePath as any,
          level: dNewLevel as any,
          partnerType: `level${dNewLevel}` as any,
          updatedAt: new Date(),
        })
        .where(eq(dealer.id, d.id));
    }
  }
}
