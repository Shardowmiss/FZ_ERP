import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { PayableService } from './payable.service';
import type { PaginationResult, Payable } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/finance/payable')
export class PayableController {
  constructor(private readonly payableService: PayableService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<Payable>> {
    return this.payableService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierId,
      status,
      keyword,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<Payable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }> {
    return this.payableService.getDetail(id) as Promise<Payable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }>;
  }

  @CheckPermission('finance:payable')
  @Post(':id/payment')
  async addPayment(
    @Param('id') id: string,
    @Body() body: {
      paymentDate: string;
      amount: number;
      paymentMethod?: string;
      remark?: string;
    },
  ): Promise<Payable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }> {
    return this.payableService.addPayment(id, body) as Promise<Payable & { payments: Array<{ id: string; paymentDate: string; amount: number; paymentMethod: string; remark: string | null }> }>;
  }
}
