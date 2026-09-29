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
import { ReceiptService } from './receipt.service';
import type {
  FinanceReceipt,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/finance/receipt')
export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<FinanceReceipt>> {
    return this.receiptService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      customerId,
      status,
      startDate,
      endDate,
      keyword,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<FinanceReceipt & {
    writeoffs: Array<{
      id: string;
      receiptId: string;
      receivableId: string;
      receivableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    return this.receiptService.get(id) as Promise<FinanceReceipt & {
      writeoffs: Array<{
        id: string;
        receiptId: string;
        receivableId: string;
        receivableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }

  @CheckPermission('finance:receipt')
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      receiptDate: string;
      customerId: string;
      customerName: string;
      amount: number;
      paymentMethod: string;
      handler?: string;
      remark?: string;
      writeoffs: Array<{
        receivableId: string;
        receivableNo: string;
        writeoffAmount: number;
      }>;
    },
  ): Promise<FinanceReceipt & {
    writeoffs: Array<{
      id: string;
      receiptId: string;
      receivableId: string;
      receivableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    const { userId } = req.userContext;
    return this.receiptService.create(body, userId) as Promise<FinanceReceipt & {
      writeoffs: Array<{
        id: string;
        receiptId: string;
        receivableId: string;
        receivableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }

  @CheckPermission('finance:receipt')
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      receiptDate?: string;
      customerId?: string;
      customerName?: string;
      amount?: number;
      paymentMethod?: string;
      handler?: string;
      remark?: string;
      writeoffs?: Array<{
        receivableId: string;
        receivableNo: string;
        writeoffAmount: number;
      }>;
    },
  ): Promise<FinanceReceipt & {
    writeoffs: Array<{
      id: string;
      receiptId: string;
      receivableId: string;
      receivableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    const { userId } = req.userContext;
    return this.receiptService.update(id, body, userId) as Promise<FinanceReceipt & {
      writeoffs: Array<{
        id: string;
        receiptId: string;
        receivableId: string;
        receivableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }

  @CheckPermission('finance:receipt')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.receiptService.voidDoc(id);
  }

  @CheckPermission('finance:receipt')
  @Delete(':id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.receiptService.remove(id, userId);
  }

  @CheckPermission('finance:receipt')
  @Post(':id/approve')
  async approve(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<FinanceReceipt & {
    writeoffs: Array<{
      id: string;
      receiptId: string;
      receivableId: string;
      receivableNo: string;
      writeoffAmount: number;
      createdAt: string;
    }>;
  }> {
    const { userId } = req.userContext;
    return this.receiptService.approve(id, userId) as Promise<FinanceReceipt & {
      writeoffs: Array<{
        id: string;
        receiptId: string;
        receivableId: string;
        receivableNo: string;
        writeoffAmount: number;
        createdAt: string;
      }>;
    }>;
  }
}
