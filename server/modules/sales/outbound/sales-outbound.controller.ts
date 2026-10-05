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
import { SalesOutboundService } from './sales-outbound.service';
import type { PaginationResult, SalesOutbound } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/sales/outbound')
export class SalesOutboundController {
  constructor(private readonly salesOutboundService: SalesOutboundService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('dealerId') dealerId?: string,
    @Query('status') status?: string,
    @Query('orderNo') orderNo?: string,
    @Query('brand') brand?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('docStartDate') docStartDate?: string,
    @Query('docEndDate') docEndDate?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<SalesOutbound>> {
    return this.salesOutboundService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      dealerId,
      status,
      orderNo,
      brand,
      warehouseId,
      docStartDate,
      docEndDate,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<SalesOutbound> {
    return this.salesOutboundService.getDetail(id);
  }

  @CheckPermission('sales:outbound')
  @Post()
  async create(
    @Body()
    body: {
      orderId: string;
      warehouseId: string;
      outboundDate: string;
      remark?: string;
      items: { orderItemId: string; quantity: number; batchNo?: string }[];
    },
  ): Promise<SalesOutbound> {
    return this.salesOutboundService.create(body);
  }

  @CheckPermission('sales:outbound')
  @Post(':id/audit')
  async audit(@Param('id') id: string): Promise<void> {
    return this.salesOutboundService.audit(id);
  }

  @CheckPermission('sales:outbound')
  @Post(':id/cancel-audit')
  async cancelAudit(@Param('id') id: string): Promise<void> {
    return this.salesOutboundService.cancelAudit(id);
  }

  @CheckPermission('sales:outbound')
  @Post(':id/book')
  async book(@Param('id') id: string): Promise<void> {
    return this.salesOutboundService.book(id);
  }

  @CheckPermission('sales:outbound')
  @Post(':id/accept')
  async accept(@Param('id') id: string): Promise<void> {
    return this.salesOutboundService.accept(id);
  }

  @CheckPermission('sales:outbound')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.salesOutboundService.voidDoc(id);
  }

@CheckPermission('sales:outbound')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.salesOutboundService.delete(id);
  }
}
