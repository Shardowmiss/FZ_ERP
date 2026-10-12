import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SizeService } from './size.service';
import type { Size, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/size')
export class SizeController {
  constructor(private readonly sizeService: SizeService) {}

  // #811 ②：list/detail 补 res:view（对齐 color.controller 范式，收敛「任意登录用户可读主数据」）。
  // 安全性依据（scripts/analyze-read-guard-safety.cjs）：GET 调用方仅 base 模块页面
  // (SizePage/SizeGroupRelationPage/SkuPage)，其角色(data_governor/dealer/super_admin)均持 base:size ⇒ 零 403 回归。
  @CheckPermission('base:size:view')
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

  @CheckPermission('base:size:view')
  @Get(':id')
  async detail(@Param('id') id: string): Promise<Size> {
    return this.sizeService.detail(id);
  }

  @CheckPermission('base:size:create')
  @Post()
  async create(
    @Body() body: { code: string; name: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Size> {
    return this.sizeService.create(body);
  }

  @CheckPermission('base:size:edit')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { code?: string; name?: string; sortOrder?: number; status?: string; remark?: string },
  ): Promise<Size> {
    return this.sizeService.update(id, body);
  }

  @CheckPermission('base:size:delete')
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
