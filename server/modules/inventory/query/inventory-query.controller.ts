import { Controller, Get, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InventoryQueryService } from './inventory-query.service';
import type {
  InventoryStock,
  MaterialStock,
  PaginationResult,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/inventory/query')
export class InventoryQueryController {
  constructor(
    private readonly inventoryQueryService: InventoryQueryService,
  ) {}

  @Get('sku')
  async getSkuStock(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('styleId') styleId?: string,
    @Query('brand') brand?: string,
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<InventoryStock>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryQueryService.getSkuStock({
      page: pageNum,
      pageSize: pageSizeNum,
      styleId,
      brand,
      color,
      size,
      warehouseId,
      keyword,
    });
  }

  @Get('material')
  async getMaterialStock(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('materialId') materialId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<MaterialStock>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryQueryService.getMaterialStock({
      page: pageNum,
      pageSize: pageSizeNum,
      materialId,
      warehouseId,
      keyword,
    });
  }
}
