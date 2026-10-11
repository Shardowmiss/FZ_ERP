import { Controller, Get, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';
import { InventoryFlowService } from './inventory-flow.service';
import type { InventoryFlow, PaginationResult } from '@shared/api.interface';

/**
 * 注意：本端点被「入库单 / 出库单」页面内联调用（查单据流水），属跨页依赖。
 * 因此补守卫的同时，须由 scripts/sync-permission-split.cjs 把 inventory:flow
 * 补授给所有持有 inventory:inbound / inventory:outbound 的角色，避免既有流程 403。
 */
@NeedLogin()
@CheckPermission('inventory:flow')
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
