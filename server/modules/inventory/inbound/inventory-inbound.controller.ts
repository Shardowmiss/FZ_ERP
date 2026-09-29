import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { InventoryInboundService } from './inventory-inbound.service';
import type { InventoryFlow, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/inventory/inbound')
export class InventoryInboundController {
  constructor(
    private readonly inventoryInboundService: InventoryInboundService,
  ) {}

  @Get()
  async getInboundList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
  ): Promise<PaginationResult<InventoryFlow>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryInboundService.getInboundList({
      page: pageNum,
      pageSize: pageSizeNum,
      status,
    });
  }

  @CheckPermission('inventory:inbound')
  @Post()
  async createProductionInbound(
    @Req() req: Request,
    @Body()
    body: {
      warehouseId: string;
      inboundDate: string;
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
    return this.inventoryInboundService.createProductionInbound(body, userId);
  }
}
