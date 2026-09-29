import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InventoryReplenishService } from './inventory-replenish.service';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/inventory/replenish')
export class InventoryReplenishController {
  constructor(
    private readonly inventoryReplenishService: InventoryReplenishService,
  ) {}

  @Get('suggest')
  async suggest(
    @Query('warehouseId') warehouseId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.inventoryReplenishService.suggest({ warehouseId, keyword });
  }

  @CheckPermission('inventory:inbound')
  @Post('generate')
  async generate(
    @Body()
    body: {
      orderDate: string;
      items: { skuId: string; supplierId: string; quantity: number }[];
    },
  ) {
    if (!body.orderDate) {
      throw new BadRequestException('订单日期不能为空');
    }
    return this.inventoryReplenishService.generate(body);
  }
}
