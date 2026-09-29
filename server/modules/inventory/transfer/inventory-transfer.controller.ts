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
import { InventoryTransferService } from './inventory-transfer.service';
import type {
  InventoryTransfer,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/inventory/transfer')
export class InventoryTransferController {
  constructor(
    private readonly inventoryTransferService: InventoryTransferService,
  ) {}

  @Get()
  async getTransferList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('fromWarehouseId') fromWarehouseId?: string,
    @Query('toWarehouseId') toWarehouseId?: string,
  ): Promise<PaginationResult<InventoryTransfer>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.inventoryTransferService.getTransferList({
      page: pageNum,
      pageSize: pageSizeNum,
      status,
      fromWarehouseId,
      toWarehouseId,
    });
  }

  @Get(':id')
  async getTransferDetail(@Param('id') id: string): Promise<InventoryTransfer> {
    return this.inventoryTransferService.getTransferDetail(id);
  }

  @CheckPermission('inventory:transfer')
  @Post()
  async createTransfer(
    @Req() req: Request,
    @Body()
    body: {
      fromWarehouseId?: string;
      toWarehouseId?: string;
      fromStoreId?: string;
      toStoreId?: string;
      transferDate: string;
      itemType: 'sku' | 'material';
      remark?: string;
      items: {
        skuId?: string;
        materialId?: string;
        itemCode: string;
        itemName: string;
        color?: string;
        size?: string;
        quantity: number;
      }[];
    },
  ): Promise<InventoryTransfer> {
    const { userId } = req.userContext;
    return this.inventoryTransferService.createTransfer(body, userId);
  }

  @CheckPermission('inventory:transfer')
  @Post(':id/approve')
  async approveTransfer(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<InventoryTransfer> {
    const { userId } = req.userContext;
    return this.inventoryTransferService.approveTransfer(id, userId);
  }

  @CheckPermission('inventory:transfer')
  @Post(':id/receive')
  async receiveTransfer(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<InventoryTransfer> {
    const { userId } = req.userContext;
    return this.inventoryTransferService.receiveTransfer(id, userId);
  }

  @CheckPermission('inventory:transfer')
  @Post(':id/accept')
  async acceptTransfer(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<InventoryTransfer> {
    const { userId } = req.userContext;
    return this.inventoryTransferService.acceptTransfer(id, userId);
  }

  @CheckPermission('inventory:transfer')
  @Post(':id/void')
  async voidTransfer(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<InventoryTransfer> {
    const { userId } = req.userContext;
    return this.inventoryTransferService.voidTransfer(id, userId);
  }

  @CheckPermission('inventory:transfer')
  @Delete(':id')
  async deleteTransfer(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.inventoryTransferService.deleteTransfer(id, userId);
  }
}
