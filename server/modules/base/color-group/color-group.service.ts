import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { colorGroup, color, colorGroupColor } from '@server/database/schema';
import { eq, or, ilike, and } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { ColorGroup } from '@shared/api.interface';

type ColorGroupInsert = typeof colorGroup.$inferInsert;
type ColorGroupUpdate = Partial<ColorGroupInsert>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ColorGroupService extends BaseCrudService<
  typeof colorGroup,
  ColorGroup,
  ColorGroupInsert,
  ColorGroupUpdate
> {
  private readonly logger = new Logger(ColorGroupService.name);

  constructor() {
    super(colorGroup);
  }

  private toDto(row: any): ColorGroup {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      colors: row.colors as { name: string; value: string }[],
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ===== P1-1 组模型收口：关联表(color_group_color)为「组关系」单一真相，jsonb 为派生镜像 =====

  /** 把 colors[] 入参（{name,value} 或 {id}）解析为 color 主数据行；解析不到则拦截（收口强约束）。 */
  private async resolveColor(
    entry: { name?: string; value?: string; id?: string },
  ): Promise<{ id: string; name: string; code: string }> {
    const key = entry.value ?? entry.name;
    const where =
      entry.id && UUID_RE.test(entry.id)
        ? eq(color.id, entry.id)
        : key && UUID_RE.test(key)
          ? eq(color.id, key)
          : or(eq(color.code, key ?? ''), eq(color.name, key ?? ''));
    const rows = await this.db.select().from(color).where(where).limit(1);
    if (rows.length === 0) throw new BadRequestException(`颜色「${key ?? entry.id}」在主数据中不存在`);
    return { id: rows[0].id, name: rows[0].name, code: rows[0].code };
  }

  /** 用 colors[] 全量替换某组的关联表成员（先删后插，sortOrder=下标）。 */
  private async replaceColorMembers(
    groupId: string,
    entries: { name?: string; value?: string; id?: string }[],
  ): Promise<void> {
    await this.db.delete(colorGroupColor).where(eq(colorGroupColor.colorGroupId, groupId));
    let i = 0;
    for (const e of entries) {
      const c = await this.resolveColor(e);
      await this.db
        .insert(colorGroupColor)
        .values({ colorGroupId: groupId, colorId: c.id, sortOrder: i++ })
        .onConflictDoNothing();
    }
  }

  /** 由关联表重建 colors jsonb 镜像（投影 color.name/code），使 jsonb 始终等于关联表真相。 */
  private async rebuildColorsJsonb(groupId: string): Promise<void> {
    const rows = await this.db
      .select({ name: color.name, code: color.code })
      .from(colorGroupColor)
      .innerJoin(color, eq(colorGroupColor.colorId, color.id))
      .where(eq(colorGroupColor.colorGroupId, groupId))
      .orderBy(colorGroupColor.sortOrder);
    const jsonb = rows.map((r) => ({ name: r.name, value: r.code }));
    await this.updateRow(groupId, { colors: jsonb as any });
  }

  /**
   * 一致性断言（M1 收口校验）：color_group.colors jsonb 与 color_group_color 关联表必须逐序相等。
   * 返回是否一致；throwOnMismatch=true 时不一致直接抛 BadRequestException（用于写后守卫与脏数据探测）。
   */
  async assertColorsConsistent(groupId: string, throwOnMismatch = true): Promise<boolean> {
    const grp = await this.findByIdOrThrow(groupId, '颜色组不存在');
    const jsonb = (grp.colors as { value: string }[]) || [];
    const rows = await this.db
      .select({ code: color.code })
      .from(colorGroupColor)
      .innerJoin(color, eq(colorGroupColor.colorId, color.id))
      .where(eq(colorGroupColor.colorGroupId, groupId))
      .orderBy(colorGroupColor.sortOrder);
    const consistent =
      JSON.stringify(jsonb.map((x) => x.value)) === JSON.stringify(rows.map((r) => r.code));
    if (!consistent && throwOnMismatch) throw new BadRequestException('颜色组 jsonb 与关联表不一致');
    return consistent;
  }

  /** 列出颜色组成员（按 sortOrder）。 */
  async listColorMembers(
    groupId: string,
  ): Promise<{ colorGroupId: string; colorId: string; colorCode: string; colorName: string; sortOrder: number }[]> {
    await this.findByIdOrThrow(groupId, '颜色组不存在');
    const rows = await this.db
      .select({
        colorGroupId: colorGroupColor.colorGroupId,
        colorId: colorGroupColor.colorId,
        colorCode: color.code,
        colorName: color.name,
        sortOrder: colorGroupColor.sortOrder,
      })
      .from(colorGroupColor)
      .innerJoin(color, eq(colorGroupColor.colorId, color.id))
      .where(eq(colorGroupColor.colorGroupId, groupId))
      .orderBy(colorGroupColor.sortOrder);
    return rows.map((r) => ({
      colorGroupId: r.colorGroupId,
      colorId: r.colorId,
      colorCode: r.colorCode,
      colorName: r.colorName,
      sortOrder: Number(r.sortOrder ?? 0),
    }));
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
  ): Promise<{ items: ColorGroup[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(colorGroup.code, `%${escaped}%`), ilike(colorGroup.name, `%${escaped}%`)));
    }

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<ColorGroup> {
    const row = await this.findByIdOrThrow(id, '颜色组不存在');
    return this.toDto(row);
  }

  async create(dto: { code: string; name: string; colors: { name: string; value: string }[] }): Promise<ColorGroup> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!Array.isArray(dto.colors)) throw new BadRequestException('颜色列表格式错误');

    const existing = await this.db.select().from(colorGroup).where(eq(colorGroup.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: ColorGroupInsert = {
      code: dto.code,
      name: dto.name,
      colors: dto.colors as any,
    };

    const row = await this.insertRow(values);
    if (dto.colors.length > 0) {
      await this.replaceColorMembers(row.id, dto.colors);
      await this.rebuildColorsJsonb(row.id);
    }
    return this.detail(row.id);
  }

  async update(
    id: string,
    dto: { code?: string; name?: string; colors?: { name: string; value: string }[] },
  ): Promise<ColorGroup> {
    const patch: ColorGroupUpdate = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.colors !== undefined) {
      if (!Array.isArray(dto.colors)) throw new BadRequestException('颜色列表格式错误');
      patch.colors = dto.colors as any;
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '颜色组不存在');
    if (dto.colors !== undefined) {
      await this.replaceColorMembers(id, dto.colors);
      await this.rebuildColorsJsonb(id);
    }
    return this.detail(id);
  }

  async remove(id: string): Promise<void> {
    await super.remove(id, '颜色组不存在');
  }
}
