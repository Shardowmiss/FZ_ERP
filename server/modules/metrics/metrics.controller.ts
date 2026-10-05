import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MetricsService } from './metrics.service';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

/**
 * Wave 2-2 指标物化视图层 HTTP 接口。
 *
 * 全部读取接口复用 dashboard:view 权限（仪表盘-查看），与既有 Dashboard 模块同源；
 * 手动刷新端点同样需要该权限（运维/管理员触发）。所有列表接口返回 { items, total }，
 * 与 Report 模块列表响应结构一致，便于前端统一消费。
 */
@NeedLogin()
@Controller('api/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('store-sales-daily')
  @CheckPermission('dashboard:view')
  async storeSalesDaily(
    @Query('storeId') storeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const items = await this.metrics.storeSalesDaily({ storeId, from, to });
    return { items, total: items.length };
  }

  @Get('inventory-by-store')
  @CheckPermission('dashboard:view')
  async inventoryByStore(
    @Query('storeId') storeId?: string,
    @Query('skuId') skuId?: string,
  ) {
    const items = await this.metrics.inventoryByStore({ storeId, skuId });
    return { items, total: items.length };
  }

  @Get('member-summary')
  @CheckPermission('dashboard:view')
  async memberSummary() {
    const items = await this.metrics.memberSummary();
    return { items, total: items.length };
  }

  @Post('refresh')
  @CheckPermission('dashboard:view')
  async refresh(@Body() _body?: Record<string, unknown>) {
    await this.metrics.refresh();
    return { ok: true as const };
  }
}
