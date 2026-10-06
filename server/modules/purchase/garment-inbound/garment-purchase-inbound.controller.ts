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
import { GarmentPurchaseInboundService } from './garment-purchase-inbound.service';
import type {
  GarmentPurchaseInbound,
  GarmentPurchaseInboundCreateDto,
  GarmentPurchaseInboundUpdateDto,
  GarmentPurchaseInboundAcceptDto,
  GarmentPurchaseInboundResolveResult,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/garment-inbound')
export class GarmentPurchaseInboundController {
  constructor(
    private readonly garmentPurchaseInboundService: GarmentPurchaseInboundService,
  ) {}

  @CheckPermission('purchase:inbound:view')
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
  ): Promise<PaginationResult<GarmentPurchaseInbound>> {
    return this.garmentPurchaseInboundService.list({
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

  @CheckPermission('purchase:inbound:view')
  @Get(':id')
  async detail(@Param('id') id: string): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.getDetail(id);
  }

  @CheckPermission('purchase:inbound:view')
  @Get(':id/resolve-barcode')
  async resolveBarcode(
    @Param('id') id: string,
    @Query('code') code?: string,
  ): Promise<GarmentPurchaseInboundResolveResult> {
    return this.garmentPurchaseInboundService.resolveBarcode(id, code ?? '');
  }

  @CheckPermission('purchase:inbound:create')
  @Post()
  async create(
    @Body()
    body: GarmentPurchaseInboundCreateDto,
  ): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.create(body);
  }

  @CheckPermission('purchase:inbound:approve')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseInboundService.approve(id);
  }

  @CheckPermission('purchase:inbound:edit')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: GarmentPurchaseInboundUpdateDto,
  ): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.update(id, body);
  }

  @CheckPermission('purchase:inbound:accept')
  @Put(':id/acceptance')
  async saveAcceptance(
    @Param('id') id: string,
    @Body() body: GarmentPurchaseInboundAcceptDto,
  ): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.saveAcceptance(id, body);
  }

  @CheckPermission('purchase:inbound:accept')
  @Post(':id/complete-acceptance')
  async completeAcceptance(@Param('id') id: string): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.completeAcceptance(id);
  }

  @CheckPermission('purchase:inbound:void')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseInboundService.voidDoc(id);
  }

@CheckPermission('purchase:inbound:delete')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseInboundService.delete(id);
  }
}
