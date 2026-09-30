import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SizeService } from './size.service';
import type { Size, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/size')
export class SizeController {
  constructor(private readonly sizeService: SizeService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<Size>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.sizeService.list(p, ps, keyword);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Size> {
    return this.sizeService.detail(id);
  }

  @CheckPermission('base:size')
  @Post()
  async create(
    @Body() body: { code: string; name: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Size> {
    return this.sizeService.create(body);
  }

  @CheckPermission('base:size')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { code?: string; name?: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Size> {
    return this.sizeService.update(id, body);
  }

  @CheckPermission('base:size')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.sizeService.remove(id);
    return { success: true };
  }

  @Get('options/list')
  async options(): Promise<{ id: string; code: string; name: string }[]> {
    return this.sizeService.options();
  }
}
