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
import { PurchaseInboundService } from './purchase-inbound.service';
import type { PaginationResult, PurchaseInbound } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/inbound')
export class PurchaseInboundController {
  constructor(private readonly purchaseInboundService: PurchaseInboundService) {}

  @CheckPermission('purchase:inbound:view')
  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('orderNo') orderNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('docStartDate') docStartDate?: string,
    @Query('docEndDate') docEndDate?: string,
  ): Promise<PaginationResult<PurchaseInbound>> {
    return this.purchaseInboundService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      orderNo,
      startDate,
      endDate,
      warehouseId,
      docStartDate,
      docEndDate,
    });
  }

  @CheckPermission('purchase:inbound:view')
  @Get(':id')
  async detail(@Param('id') id: string): Promise<PurchaseInbound> {
    return this.purchaseInboundService.getDetail(id);
  }

  @CheckPermission('purchase:inbound:create')
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
  ): Promise<PurchaseInbound> {
    return this.purchaseInboundService.create(body);
  }

  @CheckPermission('purchase:inbound:approve')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.purchaseInboundService.approve(id);
  }

  @CheckPermission('purchase:inbound:void')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.purchaseInboundService.voidDoc(id);
  }

@CheckPermission('purchase:inbound:delete')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.purchaseInboundService.delete(id);
  }
}
