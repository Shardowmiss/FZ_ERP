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
import { PurchaseOrderService } from './purchase-order.service';
import type { PaginationResult, PurchaseOrder } from '@shared/api.interface';
import { resolvePagination } from '../../../common/dto/pagination';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/order')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<PurchaseOrder>> {
    const p = resolvePagination({ page, pageSize });
    return this.purchaseOrderService.list({
      page: p.page,
      pageSize: p.pageSize,
      supplierId,
      status,
      startDate,
      endDate,
    });
  }

  /** 可导入的采购订单：已记账/已验收（真正生效）的订单数据 */
  @Get('importable')
  async importable(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<PurchaseOrder>> {
    const p = resolvePagination({ page, pageSize });
    return this.purchaseOrderService.listImportable({
      page: p.page,
      pageSize: p.pageSize,
      supplierId,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<PurchaseOrder> {
    return this.purchaseOrderService.getDetail(id);
  }

  @CheckPermission('purchase:order')
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
  ): Promise<PurchaseOrder> {
    return this.purchaseOrderService.create(body);
  }

  @CheckPermission('purchase:order')
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
  ): Promise<PurchaseOrder> {
    return this.purchaseOrderService.update(id, body);
  }

  @CheckPermission('purchase:order')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.voidDoc(id);
  }

  @CheckPermission('purchase:order')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.delete(id);
  }

  /** 还原被误删的采购订单（软删后可恢复） */
  @CheckPermission('purchase:order')
  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.restore(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/audit')
  async audit(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.audit(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/cancel-audit')
  async cancelAudit(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.cancelAudit(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/book')
  async book(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.book(id);
  }

  @CheckPermission('purchase:order')
  @Post(':id/accept')
  async accept(@Param('id') id: string): Promise<void> {
    return this.purchaseOrderService.accept(id);
  }
}
