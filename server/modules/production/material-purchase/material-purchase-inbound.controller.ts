import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MaterialPurchaseInboundService } from './material-purchase-inbound.service';
import type {
  MaterialPurchaseInbound,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/production/material-purchase-inbound')
export class MaterialPurchaseInboundController {
  constructor(
    private readonly materialPurchaseInboundService: MaterialPurchaseInboundService,
  ) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('orderNo') orderNo?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('docStartDate') docStartDate?: string,
    @Query('docEndDate') docEndDate?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<MaterialPurchaseInbound>> {
    return this.materialPurchaseInboundService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      orderNo,
      warehouseId,
      docStartDate,
      docEndDate,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<MaterialPurchaseInbound> {
    return this.materialPurchaseInboundService.getDetail(id);
  }

  @CheckPermission('production:material_inbound')
  @Post()
  async create(
    @Body()
    body: {
      orderId: string;
      warehouseId: string;
      inboundDate: string;
      remark?: string;
      items: { orderItemId: string; quantity: number; batchNo?: string }[];
    },
  ): Promise<MaterialPurchaseInbound> {
    return this.materialPurchaseInboundService.create(body);
  }

  @CheckPermission('production:material_inbound')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseInboundService.approve(id);
  }

  @CheckPermission('production:material_inbound')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseInboundService.voidDoc(id);
  }

@CheckPermission('production:material_inbound')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseInboundService.delete(id);
  }
}
