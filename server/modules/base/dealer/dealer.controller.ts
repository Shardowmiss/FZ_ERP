import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { DealerService } from './dealer.service';
import type { Dealer, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/dealer')
export class DealerController {
  constructor(private readonly dealerService: DealerService) {}

  @Get('options')
  async options(
    @Query('excludeId') excludeId?: string,
  ): Promise<{ id: string; code: string; name: string }[]> {
    return this.dealerService.options(excludeId);
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Dealer>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.dealerService.list(p, ps, keyword, status);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Dealer> {
    return this.dealerService.detail(id);
  }

  @CheckPermission('base:dealer')
  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    remark?: string;
    status?: string;
    parentId?: string | null;
  }): Promise<Dealer> {
    return this.dealerService.create(body);
  }

  @CheckPermission('base:dealer')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    code?: string;
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    address?: string | null;
    remark?: string | null;
    status?: string;
    parentId?: string | null;
  }): Promise<Dealer> {
    return this.dealerService.update(id, body);
  }

  @CheckPermission('base:dealer')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.dealerService.remove(id);
    return { success: true };
  }
}
