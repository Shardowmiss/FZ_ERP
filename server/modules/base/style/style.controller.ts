import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { StyleService } from './style.service';
import type { Style, Sku, PaginationResult, StyleCreateAutoRequest } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/style')
export class StyleController {
  constructor(private readonly styleService: StyleService) {}

  @Get('options')
  async options(): Promise<{ id: string; styleNo: string; name: string }[]> {
    return this.styleService.options();
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Style>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.styleService.list(p, ps, keyword, category, brand, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Style & { skus: Sku[] }> {
    return this.styleService.detail(id);
  }

  @CheckPermission('base:style')
  @Post()
  async create(@Body() body: {
    styleNo: string;
    name: string;
    category?: string;
    season?: string;
    brand?: string;
    wave?: string;
    tagPrice?: number;
    costPrice?: number;
    supplyPrice?: number;
    colorGroupId: string;
    sizeGroupId: string;
    status?: string;
    remark?: string;
    codeRuleId?: string;
  }): Promise<Style & { skus: Sku[] }> {
    return this.styleService.create(body);
  }

  @CheckPermission('base:style')
  @Post('auto')
  async createAuto(@Body() body: StyleCreateAutoRequest): Promise<Style & { skus: Sku[] }> {
    return this.styleService.createAuto(body);
  }

  @CheckPermission('base:style')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    styleNo?: string;
    name?: string;
    category?: string | null;
    season?: string | null;
    brand?: string | null;
    wave?: string | null;
    tagPrice?: number;
    costPrice?: number;
    supplyPrice?: number;
    colorGroupId?: string;
    sizeGroupId?: string;
    status?: string;
    remark?: string | null;
    codeRuleId?: string | null;
  }): Promise<Style> {
    return this.styleService.update(id, body);
  }

  @CheckPermission('base:style')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.styleService.remove(id);
    return { success: true };
  }
}
