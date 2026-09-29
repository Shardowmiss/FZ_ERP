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
import { SalesReturnService } from './sales-return.service';
import type { PaginationResult, SalesReturn } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/sales/return')
export class SalesReturnController {
  constructor(private readonly salesReturnService: SalesReturnService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
  ): Promise<PaginationResult<SalesReturn>> {
    return this.salesReturnService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<SalesReturn> {
    return this.salesReturnService.getDetail(id);
  }

  @CheckPermission('sales:return')
  @Post()
  async create(
    @Body()
    body: {
      outboundId: string;
      returnDate: string;
      remark?: string;
      items: { skuId: string; quantity: number; price: number; batchNo?: string }[];
    },
  ): Promise<SalesReturn> {
    return this.salesReturnService.create(body);
  }

  @CheckPermission('sales:return')
  @Post(':id/audit')
  async audit(@Param('id') id: string): Promise<void> {
    return this.salesReturnService.audit(id);
  }

  @CheckPermission('sales:return')
  @Post(':id/cancel-audit')
  async cancelAudit(@Param('id') id: string): Promise<void> {
    return this.salesReturnService.cancelAudit(id);
  }

  @CheckPermission('sales:return')
  @Post(':id/book')
  async book(@Param('id') id: string): Promise<void> {
    return this.salesReturnService.book(id);
  }

  @CheckPermission('sales:return')
  @Post(':id/accept')
  async accept(@Param('id') id: string): Promise<void> {
    return this.salesReturnService.accept(id);
  }

  @CheckPermission('sales:return')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.salesReturnService.voidDoc(id);
  }

@CheckPermission('sales:return')
@Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.salesReturnService.delete(id);
  }
}
