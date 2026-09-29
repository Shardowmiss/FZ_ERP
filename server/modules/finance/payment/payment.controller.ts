import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { PaymentService } from './payment.service';
import type {
  FinancePayment,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/finance/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<FinancePayment>> {
    return this.paymentService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      startDate,
      endDate,
      keyword,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<FinancePayment & {
    writeoffs: Array<{
      id: string;
      paymentId: string;
      payableId: string;
      payableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    return this.paymentService.get(id) as Promise<FinancePayment & {
      writeoffs: Array<{
        id: string;
        paymentId: string;
        payableId: string;
        payableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }

  @CheckPermission('finance:payment')
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      paymentDate: string;
      supplierId: string;
      supplierName: string;
      amount: number;
      paymentMethod: string;
      handler?: string;
      remark?: string;
      writeoffs: Array<{
        payableId: string;
        payableNo: string;
        writeoffAmount: number;
      }>;
    },
  ): Promise<FinancePayment & {
    writeoffs: Array<{
      id: string;
      paymentId: string;
      payableId: string;
      payableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    const { userId } = req.userContext;
    return this.paymentService.create(body, userId) as Promise<FinancePayment & {
      writeoffs: Array<{
        id: string;
        paymentId: string;
        payableId: string;
        payableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }

  @CheckPermission('finance:payment')
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      paymentDate?: string;
      supplierId?: string;
      supplierName?: string;
      amount?: number;
      paymentMethod?: string;
      handler?: string;
      remark?: string;
      writeoffs?: Array<{
        payableId: string;
        payableNo: string;
        writeoffAmount: number;
      }>;
    },
  ): Promise<FinancePayment & {
    writeoffs: Array<{
      id: string;
      paymentId: string;
      payableId: string;
      payableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    const { userId } = req.userContext;
    return this.paymentService.update(id, body, userId) as Promise<FinancePayment & {
      writeoffs: Array<{
        id: string;
        paymentId: string;
        payableId: string;
        payableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }

  @CheckPermission('finance:payment')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.paymentService.voidDoc(id);
  }

  @CheckPermission('finance:payment')
  @Delete(':id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.paymentService.remove(id, userId);
  }

  @CheckPermission('finance:payment')
  @Post(':id/approve')
  async approve(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<FinancePayment & {
    writeoffs: Array<{
      id: string;
      paymentId: string;
      payableId: string;
      payableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    const { userId } = req.userContext;
    return this.paymentService.approve(id, userId) as Promise<FinancePayment & {
      writeoffs: Array<{
        id: string;
        paymentId: string;
        payableId: string;
        payableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }
}
