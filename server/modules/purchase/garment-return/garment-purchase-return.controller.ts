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
import { GarmentPurchaseReturnService } from './garment-purchase-return.service';
import type {
  GarmentPurchaseReturn,
  GarmentPurchaseReturnCreateDto,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/garment-return')
export class GarmentPurchaseReturnController {
  constructor(
    private readonly garmentPurchaseReturnService: GarmentPurchaseReturnService,
  ) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
  ): Promise<PaginationResult<GarmentPurchaseReturn>> {
    return this.garmentPurchaseReturnService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<GarmentPurchaseReturn> {
    return this.garmentPurchaseReturnService.getDetail(id);
  }

  @CheckPermission('purchase:return')
  @Post()
  async create(
    @Body()
    body: GarmentPurchaseReturnCreateDto,
  ): Promise<GarmentPurchaseReturn> {
    return this.garmentPurchaseReturnService.create(body);
  }

  @CheckPermission('purchase:return')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseReturnService.approve(id);
  }

  @CheckPermission('purchase:return')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseReturnService.voidDoc(id);
  }

@CheckPermission('purchase:return')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.garmentPurchaseReturnService.delete(id);
  }
}
