import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { color } from '@server/database/schema';
import { eq, or, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { Color } from '@shared/api.interface';

type ColorInsert = typeof color.$inferInsert;
type ColorUpdate = Partial<ColorInsert>;

@Injectable()
export class ColorService extends BaseCrudService<
  typeof color,
  Color,
  ColorInsert,
  ColorUpdate
> {
  private readonly logger = new Logger(ColorService.name);

  constructor() {
    super(color);
  }

  private toDto(row: any): Color {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      hex: row.hex,
      sortOrder: Number(row.sortOrder ?? 0),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
  ): Promise<{ items: Color[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        or(
          ilike(color.code, `%${escaped}%`),
          ilike(color.name, `%${escaped}%`),
          ilike(color.hex, `%${escaped}%`),
        ),
      );
    }

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<Color> {
    const row = await this.findByIdOrThrow(id, '颜色不存在');
    return this.toDto(row);
  }

  async create(dto: {
    code: string;
    name: string;
    hex: string;
    sortOrder?: number;
    status?: string;
    remark?: string;
  }): Promise<Color> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!dto.hex?.trim()) throw new BadRequestException('色值不能为空');

    const existing = await this.db.select().from(color).where(eq(color.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: ColorInsert = {
      code: dto.code,
      name: dto.name,
      hex: dto.hex,
      sortOrder: dto.sortOrder ?? 0,
      status: dto.status ?? 'active',
      remark: dto.remark ?? null,
    };

    const row = await this.insertRow(values);
    return this.toDto(row);
  }

  async update(
    id: string,
    dto: { code?: string; name?: string; hex?: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Color> {
    const patch: ColorUpdate = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.hex !== undefined) {
      if (!dto.hex.trim()) throw new BadRequestException('色值不能为空');
      patch.hex = dto.hex;
    }
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '颜色不存在');
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await super.remove(id, '颜色不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string; hex: string }[]> {
    const rows = await this.db
      .select({ id: color.id, code: color.code, name: color.name, hex: color.hex })
      .from(color)
      .where(eq(color.status, 'active'))
      .orderBy(color.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, hex: row.hex }));
  }
}
