import { Controller, Get, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InventoryFlowService } from './inventory-flow.service';
import type { InventoryFlow, PaginationResult } from '@shared/api.interface';

@NeedLogin()
@Controller('api/inventory/flow')
export class InventoryFlowController {
  constructor(
    private readonly inventoryFlowService: InventoryFlowService,
  ) {}

  @Get()
  async getFlowList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('itemType') itemType?: string,
    @Query('skuId') skuId?: string,
    @Query('materialId') materialId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('flowType') flowType?: string,
    @Query('bizDateStart') bizDateStart?: string,
    @Query('bizDateEnd') bizDateEnd?: string,
    @Query('bizNo') bizNo?: string,
    @Query('warehouseName') warehouseName?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PaginationResult<InventoryFlow>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryFlowService.getFlowList({
      page: pageNum,
      pageSize: pageSizeNum,
      itemType,
      skuId,
      materialId,
      warehouseId,
      flowType,
      bizDateStart,
      bizDateEnd,
      bizNo,
      warehouseName,
      startDate,
      endDate,
      cursor,
    });
  }
}
