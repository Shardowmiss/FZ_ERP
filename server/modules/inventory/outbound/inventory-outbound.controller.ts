import { Body, Controller, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { InventoryOutboundService } from './inventory-outbound.service';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/inventory/outbound')
export class InventoryOutboundController {
  constructor(
    private readonly inventoryOutboundService: InventoryOutboundService,
  ) {}

  @CheckPermission('inventory:outbound')
  @Post()
  async createProductionOutbound(
    @Req() req: Request,
    @Body()
    body: {
      warehouseId: string;
      outboundDate: string;
      itemType: 'sku' | 'material';
      remark?: string;
      items: {
        skuId?: string;
        materialId?: string;
        quantity: number;
        batchNo?: string;
      }[];
    },
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.inventoryOutboundService.createProductionOutbound(
      body,
      userId,
    );
  }
}
