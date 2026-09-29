import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MaterialService } from './material.service';
import type { Material, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/material')
export class MaterialController {
  constructor(private readonly materialService: MaterialService) {}

  @Get('options')
  async options(): Promise<{ id: string; code: string; name: string; unit: string }[]> {
    return this.materialService.options();
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Material>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.materialService.list(p, ps, keyword, category, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Material> {
    return this.materialService.detail(id);
  }

  @CheckPermission('base:material')
  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    spec?: string;
    unit: string;
    defaultSupplierId?: string;
    stdPrice?: number;
    category?: string;
    remark?: string;
    status?: string;
  }): Promise<Material> {
    return this.materialService.create(body);
  }

  @CheckPermission('base:material')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    code?: string;
    name?: string;
    spec?: string | null;
    unit?: string;
    defaultSupplierId?: string | null;
    stdPrice?: number;
    category?: string | null;
    remark?: string | null;
    status?: string;
  }): Promise<Material> {
    return this.materialService.update(id, body);
  }

  @CheckPermission('base:material')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.materialService.remove(id);
    return { success: true };
  }
}
