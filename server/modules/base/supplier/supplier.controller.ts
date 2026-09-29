import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SupplierService } from './supplier.service';
import type { Supplier, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/supplier')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get('options')
  async options(): Promise<{ id: string; code: string; name: string }[]> {
    return this.supplierService.options();
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Supplier>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.supplierService.list(p, ps, keyword, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Supplier> {
    return this.supplierService.detail(id);
  }

  @CheckPermission('base:supplier')
  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    supplyCategory?: string;
    remark?: string;
    status?: string;
  }): Promise<Supplier> {
    return this.supplierService.create(body);
  }

  @CheckPermission('base:supplier')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    code?: string;
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    address?: string | null;
    supplyCategory?: string | null;
    remark?: string | null;
    status?: string;
  }): Promise<Supplier> {
    return this.supplierService.update(id, body);
  }

  @CheckPermission('base:supplier')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.supplierService.remove(id);
    return { success: true };
  }
}
