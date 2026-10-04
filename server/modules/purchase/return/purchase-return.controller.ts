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
import { PurchaseReturnService } from './purchase-return.service';
import type { PaginationResult, PurchaseReturn } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/return')
export class PurchaseReturnController {
  constructor(private readonly purchaseReturnService: PurchaseReturnService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('supplierId') supplierId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<PurchaseReturn>> {
    return this.purchaseReturnService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
      startDate,
      endDate,
      supplierId,
      warehouseId,
      keyword,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<PurchaseReturn> {
    return this.purchaseReturnService.getDetail(id);
  }

  @CheckPermission('purchase:return')
  @Post()
  async create(
    @Body()
    body: {
      inboundId: string;
      returnDate: string;
      remark?: string;
      items: {
        materialId: string;
        quantity: number;
        price: number;
        batchNo?: string;
      }[];
    },
  ): Promise<PurchaseReturn> {
    return this.purchaseReturnService.create(body);
  }

  @CheckPermission('purchase:return')
  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<void> {
    return this.purchaseReturnService.approve(id);
  }

  @CheckPermission('purchase:return')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.purchaseReturnService.voidDoc(id);
  }

@CheckPermission('purchase:return')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.purchaseReturnService.delete(id);
  }
}
