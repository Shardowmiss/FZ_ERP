import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { DashboardService } from './dashboard.service';
import type {
  DashboardStats,
  SalesTrendItem,
  TopStyleItem,
  InventoryWarningItem,
} from '@shared/api.interface';

/**
 * 数据看板：此前 4 个端点完全无守卫（任何登录用户都能看全公司经营概览）。
 * 补 dashboard:view 守卫；因历史上人人可看，同步脚本会把该码补授给全部既有角色（零回归）。
 */
@NeedLogin()
@CheckPermission('dashboard:view')
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async stats(): Promise<DashboardStats> {
    return this.dashboardService.getStats();
  }

  @Get('sales-trend')
  async salesTrend(): Promise<SalesTrendItem[]> {
    return this.dashboardService.getSalesTrend(30);
  }

  /** days：畅销款统计的时间窗（天）。缺省走服务端默认窗口（90 天）。 */
  @Get('top-styles')
  async topStyles(
    @Query('limit') limit = '10',
    @Query('days') days = '90',
  ): Promise<TopStyleItem[]> {
    const parsed = parseInt(days, 10);
    return this.dashboardService.getTopStyles(
      parseInt(limit, 10),
      // days<=0 表示显式豁免时间窗（全历史），由 service 打日志留痕
      parsed > 0 ? parsed : 0,
    );
  }

  @Get('warnings')
  async warnings(@Query('limit') limit = '10'): Promise<InventoryWarningItem[]> {
    return this.dashboardService.getWarnings(parseInt(limit, 10));
  }
}
