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
import { SalesReconciliationService } from './reconciliation.service';
import type {
  SalesReconciliation,
  SalesReconPreview,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/sales/reconciliation')
export class SalesReconciliationController {
  constructor(private readonly reconciliationService: SalesReconciliationService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('dealerId') dealerId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<SalesReconciliation>> {
    return this.reconciliationService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      dealerId,
      status,
      startDate,
      endDate,
    });
  }

  @Get('preview')
  async previewRoute(): Promise<void> {
    return;
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<SalesReconciliation> {
    return this.reconciliationService.get(id);
  }

  @CheckPermission('sales:reconciliation')
  @Post('preview')
  async preview(
    @Body() body: {
      dealerId: string;
      customerName: string;
      startDate: string;
      endDate: string;
    },
  ): Promise<SalesReconPreview> {
    return this.reconciliationService.preview(body);
  }

  @CheckPermission('sales:reconciliation')
  @Post()
  async create(
    @Req() req: Request,
    @Body() body: {
      dealerId: string;
      customerName: string;
      startDate: string;
      endDate: string;
      outboundAmount: number;
      returnAmount: number;
      totalAmount: number;
      remark?: string;
    },
  ): Promise<SalesReconciliation> {
    const { userId } = req.userContext;
    return this.reconciliationService.create(body, userId);
  }

  @CheckPermission('sales:reconciliation')
  @Post(':id/confirm')
  async confirm(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<SalesReconciliation> {
    const { userId } = req.userContext;
    return this.reconciliationService.confirm(id, userId);
  }
}
