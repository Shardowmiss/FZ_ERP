import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { ProfitService } from './profit.service';
import type { ProfitAnalysis } from '@shared/api.interface';

@NeedLogin()
@Controller('api/finance/profit')
export class ProfitController {
  constructor(private readonly profitService: ProfitService) {}

  @Get('order')
  async orderProfit(@Query('orderId') orderId: string): Promise<ProfitAnalysis> {
    if (!orderId) throw new BadRequestException('orderId 必填');
    return this.profitService.getOrderProfit(orderId);
  }
}
