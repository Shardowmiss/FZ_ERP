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
import { MaterialPurchaseOrderService } from './material-purchase-order.service';
import type {
  MaterialPurchaseOrder,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/production/material-purchase-order')
export class MaterialPurchaseOrderController {
  constructor(
    private readonly materialPurchaseOrderService: MaterialPurchaseOrderService,
  ) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<MaterialPurchaseOrder>> {
    return this.materialPurchaseOrderService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<MaterialPurchaseOrder> {
    return this.materialPurchaseOrderService.getDetail(id);
  }

  @CheckPermission('production:material_order')
  @Post()
  async create(
    @Body()
    body: {
      supplierId: string;
      orderDate: string;
      expectDate?: string;
      remark?: string;
      items: { materialId: string; quantity: number; price: number }[];
    },
  ): Promise<MaterialPurchaseOrder> {
    return this.materialPurchaseOrderService.create(body);
  }

  @CheckPermission('production:material_order')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      supplierId: string;
      orderDate: string;
      expectDate?: string;
      remark?: string;
      items: { materialId: string; quantity: number; price: number }[];
    },
  ): Promise<MaterialPurchaseOrder> {
    return this.materialPurchaseOrderService.update(id, body);
  }

  @CheckPermission('production:material_order')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseOrderService.voidDoc(id);
  }

@CheckPermission('production:material_order')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseOrderService.delete(id);
  }

  @CheckPermission('production:material_order')
  @Post(':id/submit')
  async submit(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseOrderService.submit(id);
  }

  @CheckPermission('production:material_order')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseOrderService.approve(id);
  }

  @CheckPermission('production:material_order')
  @Post(':id/unapprove')
  async unapprove(@Param('id') id: string): Promise<void> {
    return this.materialPurchaseOrderService.unapprove(id);
  }
}
