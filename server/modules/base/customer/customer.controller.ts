import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CustomerService } from './customer.service';
import type { Customer, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('options')
  async options(): Promise<{ id: string; code: string; name: string }[]> {
    return this.customerService.options();
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Customer>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.customerService.list(p, ps, keyword, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Customer> {
    return this.customerService.detail(id);
  }

  @CheckPermission('base:customer')
  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    creditPeriod?: number;
    level?: string;
    remark?: string;
    status?: string;
  }): Promise<Customer> {
    return this.customerService.create(body);
  }

  @CheckPermission('base:customer')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    code?: string;
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    address?: string | null;
    creditPeriod?: number;
    level?: string | null;
    remark?: string | null;
    status?: string;
  }): Promise<Customer> {
    return this.customerService.update(id, body);
  }

  @CheckPermission('base:customer')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.customerService.remove(id);
    return { success: true };
  }
}
