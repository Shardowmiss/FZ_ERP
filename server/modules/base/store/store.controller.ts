import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { StoreService } from './store.service';
import type { Store, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get('options')
  async options(): Promise<{
    id: string;
    code: string;
    name: string;
    storeType: string;
    dealerId: string | null;
    warehouseId: string | null;
  }[]> {
    return this.storeService.options();
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('storeType') storeType?: string,
    @Query('dealerId') dealerId?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Store>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.storeService.list(p, ps, keyword, storeType, dealerId, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Store> {
    return this.storeService.detail(id);
  }

  @CheckPermission('base:store')
  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    storeType: string;
    dealerId?: string;
    warehouseId?: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    remark?: string;
    status?: string;
  }): Promise<Store> {
    return this.storeService.create(body);
  }

  @CheckPermission('base:store')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    code?: string;
    name?: string;
    storeType?: string;
    dealerId?: string | null;
    warehouseId?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
    address?: string | null;
    remark?: string | null;
    status?: string;
  }): Promise<Store> {
    return this.storeService.update(id, body);
  }

  @CheckPermission('base:store')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.storeService.remove(id);
    return { success: true };
  }
}
