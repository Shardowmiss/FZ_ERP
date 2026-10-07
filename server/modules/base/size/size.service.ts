import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { size } from '@server/database/schema';
import { eq, or, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { Size } from '@shared/api.interface';

type SizeInsert = typeof size.$inferInsert;
type SizeUpdate = Partial<SizeInsert>;

@Injectable()
export class SizeService extends BaseCrudService<
  typeof size,
  Size,
  SizeInsert,
  SizeUpdate
> {
  private readonly logger = new Logger(SizeService.name);

  constructor() {
    super(size);
  }

  private toDto(row: any): Size {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: Number(row.sortOrder ?? 0),
      status: row.status,
      // 服装人体尺寸（迁移 0051）：null 表示该维度不适用（如均码、上衣无裤内长）
      bodyHeight: row.bodyHeight != null ? Number(row.bodyHeight) : null,
      bodyWeight: row.bodyWeight != null ? Number(row.bodyWeight) : null,
      chest: row.chest != null ? Number(row.chest) : null,
      waist: row.waist != null ? Number(row.waist) : null,
      hip: row.hip != null ? Number(row.hip) : null,
      shoulder: row.shoulder != null ? Number(row.shoulder) : null,
      neck: row.neck != null ? Number(row.neck) : null,
      sleeve: row.sleeve != null ? Number(row.sleeve) : null,
      lengthCm: row.lengthCm != null ? Number(row.lengthCm) : null,
      inseam: row.inseam != null ? Number(row.inseam) : null,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
  ): Promise<{ items: Size[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(size.code, `%${escaped}%`), ilike(size.name, `%${escaped}%`)));
    }

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<Size> {
    const row = await this.findByIdOrThrow(id, '尺码不存在');
    return this.toDto(row);
  }

  async create(dto: {
    code: string;
    name: string;
    sortOrder?: number;
    status?: string;
    remark?: string;
  }): Promise<Size> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');

    const existing = await this.db.select().from(size).where(eq(size.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: SizeInsert = {
      code: dto.code,
      name: dto.name,
      sortOrder: dto.sortOrder ?? 0,
      status: dto.status ?? 'active',
      remark: dto.remark ?? null,
    };

    const row = await this.insertRow(values);
    return this.toDto(row);
  }

  async update(
    id: string,
    dto: { code?: string; name?: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Size> {
    const patch: SizeUpdate = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '尺码不存在');
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await super.remove(id, '尺码不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string }[]> {
    const rows = await this.db
      .select({ id: size.id, code: size.code, name: size.name })
      .from(size)
      .where(eq(size.status, 'active'))
      .orderBy(size.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }
}
