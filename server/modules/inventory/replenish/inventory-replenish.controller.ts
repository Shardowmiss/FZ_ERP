import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InventoryReplenishService } from './inventory-replenish.service';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

// 补货建议（采购向）：此前 generate 守卫误用 inventory:inbound（入库单的码），
// 与菜单声明的 inventory:warning 对不上 → 持补货权限者点生成必 403。统一为 inventory:replenish。
@NeedLogin()
@CheckPermission('inventory:replenish')
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

  @CheckPermission('inventory:replenish')
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
