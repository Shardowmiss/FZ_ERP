import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { sizeGroup, size, sizeGroupSize } from '@server/database/schema';
import { eq, or, ilike, and, sql } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { SizeGroup, SizeGroupSize } from '@shared/api.interface';

type SizeGroupInsert = typeof sizeGroup.$inferInsert;
type SizeGroupUpdate = Partial<SizeGroupInsert>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SizeGroupService extends BaseCrudService<
  typeof sizeGroup,
  SizeGroup,
  SizeGroupInsert,
  SizeGroupUpdate
> {
  private readonly logger = new Logger(SizeGroupService.name);

  constructor() {
    super(sizeGroup);
  }

  private toDto(row: any): SizeGroup {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      sizes: row.sizes as string[],
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ===== P1-1 组模型收口：关联表(size_group_size)为「组关系」单一真相，jsonb.sizes 为派生镜像 =====

  /** 把 sizes[] 入参（尺码 code/name/id 字符串）解析为 size 主数据行；解析不到则拦截（收口强约束）。 */
  private async resolveSize(entry: string): Promise<{ id: string; code: string; name: string }> {
    const where = UUID_RE.test(entry)
      ? eq(size.id, entry)
      : or(eq(size.code, entry), eq(size.name, entry));
    const rows = await this.db.select().from(size).where(where).limit(1);
    if (rows.length === 0) throw new BadRequestException(`尺码「${entry}」在主数据中不存在`);
    return { id: rows[0].id, code: rows[0].code, name: rows[0].name };
  }

  /** 用 sizes[] 全量替换某组的关联表成员（先删后插，sortOrder=下标）。 */
  private async replaceSizeMembers(groupId: string, codes: string[]): Promise<void> {
    await this.db.delete(sizeGroupSize).where(eq(sizeGroupSize.sizeGroupId, groupId));
    let i = 0;
    for (const code of codes) {
      const s = await this.resolveSize(code);
      await this.db
        .insert(sizeGroupSize)
        .values({ sizeGroupId: groupId, sizeId: s.id, sortOrder: i++ })
        .onConflictDoNothing();
    }
  }

  /** 由关联表重建 sizes jsonb 镜像（投影 size.code），使 jsonb 始终等于关联表真相。 */
  private async rebuildSizesJsonb(groupId: string): Promise<void> {
    const rows = await this.db
      .select({ code: size.code })
      .from(sizeGroupSize)
      .innerJoin(size, eq(sizeGroupSize.sizeId, size.id))
      .where(eq(sizeGroupSize.sizeGroupId, groupId))
      .orderBy(sizeGroupSize.sortOrder);
    await this.updateRow(groupId, { sizes: rows.map((r) => r.code) as any });
  }

  /**
   * 一致性校验（M2 双写校验）：size_group.sizes jsonb 与 size_group_size 关联表必须逐序相等。
   * 返回是否一致；throwOnMismatch=true 时不一致直接抛 BadRequestException（守卫 + 脏数据探测）。
   */
  async assertSizesConsistent(groupId: string, throwOnMismatch = true): Promise<boolean> {
    const grp = await this.findByIdOrThrow(groupId, '尺码组不存在');
    const jsonb = (grp.sizes as string[]) || [];
    const rows = await this.db
      .select({ code: size.code })
      .from(sizeGroupSize)
      .innerJoin(size, eq(sizeGroupSize.sizeId, size.id))
      .where(eq(sizeGroupSize.sizeGroupId, groupId))
      .orderBy(sizeGroupSize.sortOrder);
    const consistent = JSON.stringify(jsonb) === JSON.stringify(rows.map((r) => r.code));
    if (!consistent && throwOnMismatch) throw new BadRequestException('尺码组 jsonb 与关联表不一致');
    return consistent;
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
  ): Promise<{ items: SizeGroup[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(sizeGroup.code, `%${escaped}%`), ilike(sizeGroup.name, `%${escaped}%`)));
    }

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<SizeGroup> {
    const row = await this.findByIdOrThrow(id, '尺码组不存在');
    return this.toDto(row);
  }

  async create(dto: { code: string; name: string; sizes: string[] }): Promise<SizeGroup> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!Array.isArray(dto.sizes)) throw new BadRequestException('尺码列表格式错误');

    const existing = await this.db.select().from(sizeGroup).where(eq(sizeGroup.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: SizeGroupInsert = {
      code: dto.code,
      name: dto.name,
      sizes: dto.sizes as any,
    };

    const row = await this.insertRow(values);
    if (dto.sizes.length > 0) {
      await this.replaceSizeMembers(row.id, dto.sizes);
      await this.rebuildSizesJsonb(row.id);
    }
    return this.detail(row.id);
  }

  async update(
    id: string,
    dto: { code?: string; name?: string; sizes?: string[] },
  ): Promise<SizeGroup> {
    const patch: SizeGroupUpdate = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.sizes !== undefined) {
      if (!Array.isArray(dto.sizes)) throw new BadRequestException('尺码列表格式错误');
      patch.sizes = dto.sizes as any;
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '尺码组不存在');
    if (dto.sizes !== undefined) {
      await this.replaceSizeMembers(id, dto.sizes);
      await this.rebuildSizesJsonb(id);
    }
    return this.detail(id);
  }

  async remove(id: string): Promise<void> {
    await super.remove(id, '尺码组不存在');
  }

  // ===== 尺码组成员管理（addMember/removeMember 维护关联表，并重建 jsonb 镜像） =====

  /** 列出某尺码组下的尺码成员（按 sortOrder 排序）。 */
  async listMembers(groupId: string): Promise<SizeGroupSize[]> {
    await this.findByIdOrThrow(groupId, '尺码组不存在');
    const rows = await this.db
      .select({
        sizeGroupId: sizeGroupSize.sizeGroupId,
        sizeId: sizeGroupSize.sizeId,
        sizeCode: size.code,
        sizeName: size.name,
        sortOrder: sizeGroupSize.sortOrder,
      })
      .from(sizeGroupSize)
      .innerJoin(size, eq(sizeGroupSize.sizeId, size.id))
      .where(eq(sizeGroupSize.sizeGroupId, groupId))
      .orderBy(sizeGroupSize.sortOrder);
    return rows.map((r) => ({
      sizeGroupId: r.sizeGroupId,
      sizeId: r.sizeId,
      sizeCode: r.sizeCode,
      sizeName: r.sizeName,
      sortOrder: Number(r.sortOrder ?? 0),
    }));
  }

  /** 向尺码组添加尺码成员，并重建 jsonb.sizes（以关联表为真相）。 */
  async addMember(groupId: string, sizeId: string): Promise<SizeGroupSize[]> {
    await this.findByIdOrThrow(groupId, '尺码组不存在');
    const sz = await this.db.select().from(size).where(eq(size.id, sizeId));
    if (sz.length === 0) throw new NotFoundException('尺码不存在');
    const exist = await this.db
      .select()
      .from(sizeGroupSize)
      .where(and(eq(sizeGroupSize.sizeGroupId, groupId), eq(sizeGroupSize.sizeId, sizeId)));
    if (exist.length === 0) {
      const maxRow = await this.db
        .select({ m: sql`coalesce(max(${sizeGroupSize.sortOrder}), 0)` })
        .from(sizeGroupSize)
        .where(eq(sizeGroupSize.sizeGroupId, groupId));
      const next = Number(maxRow[0]?.m ?? 0) + 1;
      await this.db
        .insert(sizeGroupSize)
        .values({ sizeGroupId: groupId, sizeId, sortOrder: next });
    }
    await this.rebuildSizesJsonb(groupId);
    return this.listMembers(groupId);
  }

  /** 从尺码组移除尺码成员，并重建 jsonb.sizes（以关联表为真相）。 */
  async removeMember(groupId: string, sizeId: string): Promise<SizeGroupSize[]> {
    await this.findByIdOrThrow(groupId, '尺码组不存在');
    await this.db
      .delete(sizeGroupSize)
      .where(and(eq(sizeGroupSize.sizeGroupId, groupId), eq(sizeGroupSize.sizeId, sizeId)));
    await this.rebuildSizesJsonb(groupId);
    return this.listMembers(groupId);
  }
}
