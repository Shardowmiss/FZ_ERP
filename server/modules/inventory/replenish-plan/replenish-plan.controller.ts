import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';
import { ReplenishPlanService } from './replenish-plan.service';

@NeedLogin()
@CheckPermission('inventory:replenish-plan')
@Controller('api/inventory/replenish-plan')
export class ReplenishPlanController {
  constructor(private readonly replenishPlanService: ReplenishPlanService) {}

  /**
   * 计算建议补货量。
   * body: { storeId, n, expectedDays, leadTimeDays?, safetyDays?, caseQty?, skuFilter?, useForecast? }
   * useForecast=true 时接入 analytics.forecast 趋势+季节指数替代常数预计天数（P2-2）。
   */
  @Post('calc')
  async calc(
    @Body()
    body: {
      storeId: string;
      n: number;
      expectedDays: number;
      leadTimeDays?: number;
      safetyDays?: number;
      caseQty?: number;
      skuFilter?: string[];
      useForecast?: boolean;
    },
  ) {
    return this.replenishPlanService.calc(body);
  }

  /**
   * 生成补货单据（按门店类型：经销商→销售订单 / 直营店→调拨单，均草稿）。
   * body: { storeId, items: [{ skuId, suggestedQty }], sourceWarehouseId?, remark? }
   */
  @Post('generate')
  async generate(
    @Body()
    body: {
      storeId: string;
      items: { skuId: string; suggestedQty: number }[];
      sourceWarehouseId?: string;
      remark?: string;
    },
  ) {
    return this.replenishPlanService.generate(body);
  }

  /** 补货计划列表（查询/追溯）。 */
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.replenishPlanService.list({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      storeId,
    });
  }
}
