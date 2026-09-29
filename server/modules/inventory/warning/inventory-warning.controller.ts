import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InventoryWarningService } from './inventory-warning.service';
import type {
  InventoryWarningItem,
  PaginationResult,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/inventory/warning')
export class InventoryWarningController {
  constructor(
    private readonly inventoryWarningService: InventoryWarningService,
  ) {}

  @Get()
  async getWarningList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('warningType') warningType?: 'below_min' | 'above_max',
    @Query('warehouseId') warehouseId?: string,
  ): Promise<PaginationResult<InventoryWarningItem>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    if (warningType && warningType !== 'below_min' && warningType !== 'above_max') {
      throw new BadRequestException('warningType 参数无效');
    }
    return this.inventoryWarningService.getWarningList({
      page: pageNum,
      pageSize: pageSizeNum,
      warningType,
      warehouseId,
    });
  }
}
