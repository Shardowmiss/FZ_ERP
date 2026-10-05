import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { InventoryStocktakeService } from './inventory-stocktake.service';
import type {
  InventoryStocktake,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/inventory/stocktake')
export class InventoryStocktakeController {
  constructor(
    private readonly inventoryStocktakeService: InventoryStocktakeService,
  ) {}

  @Get()
  async getStocktakeList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('stocktakeDateStart') stocktakeDateStart?: string,
    @Query('stocktakeDateEnd') stocktakeDateEnd?: string,
    @Query('warehouseName') warehouseName?: string,
  ): Promise<PaginationResult<InventoryStocktake>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryStocktakeService.getStocktakeList({
      page: pageNum,
      pageSize: pageSizeNum,
      status,
      stocktakeDateStart,
      stocktakeDateEnd,
      warehouseName,
    });
  }

  @Get(':id')
  async getStocktakeDetail(@Param('id') id: string): Promise<InventoryStocktake> {
    return this.inventoryStocktakeService.getStocktakeDetail(id);
  }

  @CheckPermission('inventory:stocktake')
  @Post()
  async createStocktake(
    @Req() req: Request,
    @Body()
    body: {
      warehouseId: string;
      stocktakeDate: string;
      itemType: 'sku' | 'material';
      remark?: string;
      items: {
        skuId?: string;
        materialId?: string;
        itemCode: string;
        itemName: string;
        color?: string;
        size?: string;
        bookQty: number;
        actualQty: number;
      }[];
    },
  ): Promise<InventoryStocktake> {
    const { userId } = req.userContext;
    return this.inventoryStocktakeService.createStocktake(body, userId);
  }

  @CheckPermission('inventory:stocktake')
  @Post(':id/approve')
  async approveStocktake(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<InventoryStocktake> {
    const { userId } = req.userContext;
    return this.inventoryStocktakeService.approveStocktake(id, userId);
  }

  @CheckPermission('inventory:stocktake')
  @Post(':id/post')
  async postStocktake(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<InventoryStocktake> {
    const { userId } = req.userContext;
    return this.inventoryStocktakeService.postStocktake(id, userId);
  }

  @CheckPermission('inventory:stocktake')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.inventoryStocktakeService.voidDoc(id);
  }

  @CheckPermission('inventory:stocktake')
  @Delete(':id')
  async deleteStocktake(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.inventoryStocktakeService.deleteStocktake(id, userId);
  }
}
