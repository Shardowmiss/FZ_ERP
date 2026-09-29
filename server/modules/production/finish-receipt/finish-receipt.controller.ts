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
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { FinishReceiptService } from './finish-receipt.service';
import type { PaginationResult } from '@shared/api.interface';
import type { Request } from 'express';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

interface FinishReceiptItemResponse {
  id: string;
  receiptId: string;
  skuId: string;
  skuCode?: string;
  color?: string;
  size?: string;
  qty: number;
}

interface FinishReceiptResponse {
  id: string;
  receiptNo: string;
  workOrderId: string;
  workOrderNo?: string;
  warehouseId: string;
  warehouseName?: string;
  receiptDate: string;
  finishedQty: number;
  defectiveQty: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: FinishReceiptItemResponse[];
}

@NeedLogin()
@Controller('api/production/finish-receipt')
export class FinishReceiptController {
  constructor(private readonly finishReceiptService: FinishReceiptService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<FinishReceiptResponse>> {
    return this.finishReceiptService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
      workOrderId,
      keyword,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<FinishReceiptResponse> {
    return this.finishReceiptService.get(id);
  }

  @CheckPermission('production:finish_receipt')
  @Post()
  async create(
    @Body()
    body: {
      workOrderId: string;
      warehouseId: string;
      receiptDate: string;
      finishedQty: number;
      defectiveQty: number;
      remark?: string;
      items: { skuId: string; qty: number }[];
    },
  ): Promise<FinishReceiptResponse> {
    return this.finishReceiptService.create(body);
  }

  @CheckPermission('production:finish_receipt')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      workOrderId: string;
      warehouseId: string;
      receiptDate: string;
      finishedQty: number;
      defectiveQty: number;
      remark?: string;
      items: { skuId: string; qty: number }[];
    },
  ): Promise<FinishReceiptResponse> {
    return this.finishReceiptService.update(id, body);
  }

  @CheckPermission('production:finish_receipt')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.finishReceiptService.voidDoc(id);
  }

  @CheckPermission('production:finish_receipt')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.finishReceiptService.remove(id, {
      userId,
      userName: userName ?? '',
      module: 'production_finish_receipt',
    });
  }

  @CheckPermission('production:finish_receipt')
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.finishReceiptService.approve(id, {
      userId,
      userName: userName ?? '',
      module: 'production_finish_receipt',
    });
  }
}
