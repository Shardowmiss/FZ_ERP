import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { PurchaseReconciliationService } from './reconciliation.service';
import type {
  PurchaseReconciliation,
  PurchaseReconPreview,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/purchase/reconciliation')
export class PurchaseReconciliationController {
  constructor(private readonly reconciliationService: PurchaseReconciliationService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<PurchaseReconciliation>> {
    return this.reconciliationService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      startDate,
      endDate,
    });
  }

  @Get('preview')
  async previewRoute(): Promise<void> {
    // 占位：静态路由在前，避免被 :id 匹配
    return;
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<PurchaseReconciliation> {
    return this.reconciliationService.get(id);
  }

  @CheckPermission('purchase:reconciliation')
  @Post('preview')
  async preview(
    @Body() body: {
      supplierId: string;
      supplierName: string;
      startDate: string;
      endDate: string;
    },
  ): Promise<PurchaseReconPreview> {
    return this.reconciliationService.preview(body);
  }

  @CheckPermission('purchase:reconciliation')
  @Post()
  async create(
    @Req() req: Request,
    @Body() body: {
      supplierId: string;
      supplierName: string;
      startDate: string;
      endDate: string;
      inboundAmount: number;
      returnAmount: number;
      totalAmount: number;
      remark?: string;
    },
  ): Promise<PurchaseReconciliation> {
    const { userId } = req.userContext;
    return this.reconciliationService.create(body, userId);
  }

  @CheckPermission('purchase:reconciliation')
  @Post(':id/confirm')
  async confirm(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<PurchaseReconciliation> {
    const { userId } = req.userContext;
    return this.reconciliationService.confirm(id, userId);
  }
}
