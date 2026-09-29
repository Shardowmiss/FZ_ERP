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
import { GarmentPurchaseInboundService } from './garment-purchase-inbound.service';
import type {
  GarmentPurchaseInbound,
  GarmentPurchaseInboundCreateDto,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/garment-inbound')
export class GarmentPurchaseInboundController {
  constructor(
    private readonly garmentPurchaseInboundService: GarmentPurchaseInboundService,
  ) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('orderNo') orderNo?: string,
  ): Promise<PaginationResult<GarmentPurchaseInbound>> {
    return this.garmentPurchaseInboundService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      orderNo,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.getDetail(id);
  }

  @CheckPermission('purchase:inbound')
  @Post()
  async create(
    @Body()
    body: GarmentPurchaseInboundCreateDto,
  ): Promise<GarmentPurchaseInbound> {
    return this.garmentPurchaseInboundService.create(body);
  }

  @CheckPermission('purchase:inbound')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseInboundService.approve(id);
  }

  @CheckPermission('purchase:inbound')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseInboundService.voidDoc(id);
  }

@CheckPermission('purchase:inbound')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseInboundService.delete(id);
  }
}
