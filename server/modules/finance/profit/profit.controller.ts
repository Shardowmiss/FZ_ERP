import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';
import { ProfitService } from './profit.service';
import type { ProfitAnalysis } from '@shared/api.interface';

// 毛利分析：此前无任何守卫（任何登录用户都能看全公司毛利）。
// 月结管理已拆出独立码 finance:month_close，两者不再共用 finance:profit。
@NeedLogin()
@CheckPermission('finance:profit')
@Controller('api/finance/profit')
export class ProfitController {
  constructor(private readonly profitService: ProfitService) {}

  @Get('order')
  async orderProfit(@Query('orderId') orderId: string): Promise<ProfitAnalysis> {
    if (!orderId) throw new BadRequestException('orderId 必填');
    return this.profitService.getOrderProfit(orderId);
  }
}
