import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { colorGroup } from '@server/database/schema';
import { eq, or, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { ColorGroup } from '@shared/api.interface';

type ColorGroupInsert = typeof colorGroup.$inferInsert;
type ColorGroupUpdate = Partial<ColorGroupInsert>;

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
    return this.toDto(row);
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
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await super.remove(id, '颜色组不存在');
  }
}
