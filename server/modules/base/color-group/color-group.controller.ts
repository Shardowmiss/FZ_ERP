import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { ColorGroupService } from './color-group.service';
import type { ColorGroup, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/color-group')
export class ColorGroupController {
  constructor(private readonly colorGroupService: ColorGroupService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<ColorGroup>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.colorGroupService.list(p, ps, keyword);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ColorGroup> {
    return this.colorGroupService.detail(id);
  }

  @CheckPermission('base:style')
  @Post()
  async create(@Body() body: { code: string; name: string; colors: { name: string; value: string }[] }): Promise<ColorGroup> {
    return this.colorGroupService.create(body);
  }

  @CheckPermission('base:style')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { code?: string; name?: string; colors?: { name: string; value: string }[] }): Promise<ColorGroup> {
    return this.colorGroupService.update(id, body);
  }

  @CheckPermission('base:style')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.colorGroupService.remove(id);
    return { success: true };
  }
}
