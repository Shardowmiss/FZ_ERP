import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InventoryMobileService } from './inventory-mobile.service';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/inventory')
export class InventoryMobileController {
  constructor(
    private readonly inventoryMobileService: InventoryMobileService,
  ) {}

  @CheckPermission('inventory:stocktake')
  @Post('barcode/generate')
  async generateBarcodes(): Promise<{ generated: number; skipped: number }> {
    return this.inventoryMobileService.generateBarcodes();
  }

  @CheckPermission('inventory:stocktake')
  @Post('mobile/lookup')
  async lookup(
    @Body() body: { barcode: string; warehouseId: string },
  ) {
    if (!body.barcode || !body.warehouseId) {
      throw new BadRequestException('条码与仓库不能为空');
    }
    return this.inventoryMobileService.lookup(body);
  }

  @CheckPermission('inventory:stocktake')
  @Post('mobile/stocktake')
  async submitStocktake(
    @Body()
    body: {
      warehouseId: string;
      stocktakeDate: string;
      items: { barcode: string; actualQty: number; batchNo?: string }[];
    },
  ) {
    if (!body.warehouseId || !body.stocktakeDate) {
      throw new BadRequestException('仓库与盘点日期不能为空');
    }
    return this.inventoryMobileService.submit(body);
  }

  @Get('batch')
  async listBatches(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('skuCode') skuCode?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('batchNo') batchNo?: string,
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryMobileService.listBatches({
      page: pageNum,
      pageSize: pageSizeNum,
      skuCode,
      warehouseId,
      batchNo,
    });
  }
}
