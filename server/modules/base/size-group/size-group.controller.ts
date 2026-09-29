import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SizeGroupService } from './size-group.service';
import type { SizeGroup, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/size-group')
export class SizeGroupController {
  constructor(private readonly sizeGroupService: SizeGroupService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<SizeGroup>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.sizeGroupService.list(p, ps, keyword);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<SizeGroup> {
    return this.sizeGroupService.detail(id);
  }

  @CheckPermission('base:style')
  @Post()
  async create(@Body() body: { code: string; name: string; sizes: string[] }): Promise<SizeGroup> {
    return this.sizeGroupService.create(body);
  }

  @CheckPermission('base:style')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { code?: string; name?: string; sizes?: string[] }): Promise<SizeGroup> {
    return this.sizeGroupService.update(id, body);
  }

  @CheckPermission('base:style')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.sizeGroupService.remove(id);
    return { success: true };
  }
}
