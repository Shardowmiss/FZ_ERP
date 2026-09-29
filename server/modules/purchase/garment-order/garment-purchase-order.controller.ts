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
import { GarmentPurchaseOrderService } from './garment-purchase-order.service';
import type {
  GarmentPurchaseOrder,
  GarmentPurchaseOrderCreateDto,
  GarmentPurchaseOrderUpdateDto,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/garment-order')
export class GarmentPurchaseOrderController {
  constructor(
    private readonly garmentPurchaseOrderService: GarmentPurchaseOrderService,
  ) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('styleNo') styleNo?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<GarmentPurchaseOrder>> {
    return this.garmentPurchaseOrderService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      startDate,
      endDate,
      styleNo,
      keyword,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<GarmentPurchaseOrder> {
    return this.garmentPurchaseOrderService.getDetail(id);
  }

  @CheckPermission('purchase:order')
  @Post()
  async create(
    @Body()
    body: GarmentPurchaseOrderCreateDto,
  ): Promise<GarmentPurchaseOrder> {
    return this.garmentPurchaseOrderService.create(body);
  }

  @CheckPermission('purchase:order')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: GarmentPurchaseOrderUpdateDto,
  ): Promise<GarmentPurchaseOrder> {
    return this.garmentPurchaseOrderService.update(id, body);
  }

  @CheckPermission('purchase:order')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseOrderService.voidDoc(id);
  }

@CheckPermission('purchase:order')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseOrderService.delete(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/submit')
  async submit(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseOrderService.submit(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseOrderService.approve(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/unapprove')
  async unapprove(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseOrderService.unapprove(id);
  }
}
