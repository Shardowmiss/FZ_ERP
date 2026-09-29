import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { ReceivableService } from './receivable.service';
import type { PaginationResult, Receivable } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/finance/receivable')
export class ReceivableController {
  constructor(private readonly receivableService: ReceivableService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<Receivable>> {
    return this.receivableService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      customerId,
      status,
      keyword,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Receivable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }> {
    return this.receivableService.getDetail(id) as Promise<Receivable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }>;
  }

  @CheckPermission('finance:receivable')
  @Post(':id/payment')
  async addPayment(
    @Param('id') id: string,
    @Body() body: {
      paymentDate: string;
      amount: number;
      paymentMethod?: string;
      remark?: string;
    },
  ): Promise<Receivable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }> {
    return this.receivableService.addPayment(id, body) as Promise<Receivable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }>;
  }
}
