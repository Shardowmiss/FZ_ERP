import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { WarehouseService } from './warehouse.service';
import type { Warehouse, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('options')
  async options(): Promise<{ id: string; code: string; name: string; type: string }[]> {
    return this.warehouseService.options();
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Warehouse>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.warehouseService.list(p, ps, keyword, type, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Warehouse> {
    return this.warehouseService.detail(id);
  }

  @CheckPermission('base:warehouse')
  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    type: string;
    address?: string;
    remark?: string;
    status?: string;
  }): Promise<Warehouse> {
    return this.warehouseService.create(body);
  }

  @CheckPermission('base:warehouse')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    code?: string;
    name?: string;
    type?: string;
    address?: string | null;
    remark?: string | null;
    status?: string;
  }): Promise<Warehouse> {
    return this.warehouseService.update(id, body);
  }

  @CheckPermission('base:warehouse')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.warehouseService.remove(id);
    return { success: true };
  }
}
