import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SalesOrderService } from './sales-order.service';
import type { PaginationResult, SalesOrder } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/sales/order')
export class SalesOrderController {
  constructor(private readonly salesOrderService: SalesOrderService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('dealerId') dealerId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('cursor') cursor?: string,
    @Query('sourceType') sourceType?: string,
  ): Promise<PaginationResult<SalesOrder>> {
    return this.salesOrderService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      dealerId,
      status,
      startDate,
      endDate,
      cursor,
      sourceType,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<SalesOrder> {
    return this.salesOrderService.getDetail(id);
  }

  @CheckPermission('sales:order')
  @Post()
  async create(
    @Body()
    body: {
      dealerId: string;
      orderDate: string;
      deliveryDate?: string;
      remark?: string;
      items: { skuId: string; quantity: number; price: number }[];
    },
  ): Promise<SalesOrder> {
    return this.salesOrderService.create(body);
  }

  @CheckPermission('sales:order')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      dealerId: string;
      orderDate: string;
      deliveryDate?: string;
      remark?: string;
      items: { skuId: string; quantity: number; price: number }[];
    },
  ): Promise<SalesOrder> {
    return this.salesOrderService.update(id, body);
  }

  @CheckPermission('sales:order')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.salesOrderService.voidDoc(id);
  }

  @CheckPermission('sales:order')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.salesOrderService.delete(id);
  }

  /** 还原被误删的销售订单（软删后可恢复） */
  @CheckPermission('sales:order')
  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<void> {
    return this.salesOrderService.restore(id);
  }

  @CheckPermission('sales:order')
  @Post(':id/audit')
  async audit(@Param('id') id: string): Promise<void> {
    return this.salesOrderService.audit(id);
  }

  @CheckPermission('sales:order')
  @Post(':id/cancel-audit')
  async cancelAudit(@Param('id') id: string): Promise<void> {
    return this.salesOrderService.cancelAudit(id);
  }

  @CheckPermission('sales:order')
  @Post(':id/book')
  async book(@Param('id') id: string): Promise<void> {
    return this.salesOrderService.book(id);
  }
}
