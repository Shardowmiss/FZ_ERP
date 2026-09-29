import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { sizeGroup } from '@server/database/schema';
import { eq, or, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { SizeGroup } from '@shared/api.interface';

type SizeGroupInsert = typeof sizeGroup.$inferInsert;
type SizeGroupUpdate = Partial<SizeGroupInsert>;

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
    return this.toDto(row);
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
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await super.remove(id, '尺码组不存在');
  }
}
