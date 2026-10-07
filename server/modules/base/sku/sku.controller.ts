import { Controller, Get, Put, Post, Body, Param, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SkuService, SkuImportItem } from './sku.service';
import type { Sku, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/sku')
export class SkuController {
  constructor(private readonly skuService: SkuService) {}

  @Get('by-style/:styleId')
  async listByStyle(@Param('styleId') styleId: string): Promise<Sku[]> {
    return this.skuService.listByStyle(styleId);
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('styleId') styleId?: string,
    @Query('keyword') keyword?: string,
    @Query('color') color?: string,
    @Query('size') size?: string,
  ): Promise<PaginationResult<Sku>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.skuService.list(p, ps, styleId, keyword, color, size);
  }

  // 注意：本路由必须声明在 @Get(':id') 之前，否则会被 :id 通配吞掉。
  // 按款号的「色组 × 尺码组」笛卡尔积批量生成 SKU 矩阵（幂等，重复调用不产生重复 SKU）。
  @CheckPermission('base:sku')
  @Post('generate-matrix')
  async generateMatrix(@Body() body: { styleId: string }): Promise<{
    styleNo: string;
    total: number;
    inserted: number;
    skipped: number;
    colors: number;
    sizes: number;
  }> {
    return this.skuService.generateMatrix(body.styleId);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Sku> {
    return this.skuService.detail(id);
  }

  @CheckPermission('base:sku')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: {
    barcode?: string | null;
    costPrice?: number;
    tagPrice?: number;
    supplyPrice?: number;
    safetyStockMin?: number;
    safetyStockMax?: number;
    status?: string;
  }): Promise<Sku> {
    return this.skuService.update(id, body);
  }

  @CheckPermission('base:sku')
  @Post('bulk')
  async bulkImport(@Body() body: { items: SkuImportItem[] }): Promise<{
    total: number;
    inserted: number;
    skipped: number;
    errors: { index: number; skuCode?: string; reason: string }[];
  }> {
    return this.skuService.bulkImport(body.items);
  }
}
