import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { ColorService } from './color.service';
import type { Color, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/color')
export class ColorController {
  constructor(private readonly colorService: ColorService) {}

  @CheckPermission('base:color:view')
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<Color>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.colorService.list(p, ps, keyword);
  }

  @CheckPermission('base:color:view')
  @Get(':id')
  async detail(@Param('id') id: string): Promise<Color> {
    return this.colorService.detail(id);
  }

  @CheckPermission('base:color:create')
  @Post()
  async create(
    @Body() body: { code: string; name: string; hex: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Color> {
    return this.colorService.create(body);
  }

  @CheckPermission('base:color:edit')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { code?: string; name?: string; hex?: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Color> {
    return this.colorService.update(id, body);
  }

  @CheckPermission('base:color:delete')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.colorService.remove(id);
    return { success: true };
  }

  @Get('options/list')
  async options(): Promise<{ id: string; code: string; name: string; hex: string }[]> {
    return this.colorService.options();
  }
}
