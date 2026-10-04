import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AnalyticsService } from './analytics.service';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@UseGuards(PermissionGuard)
@CheckPermission('dashboard')
@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // P1-1 销量预测
  @CheckPermission('dashboard:view')
  @Get('forecast')
  async forecast(
    @Query('skuId') skuId: string,
    @Query('horizon') horizon = '3',
  ) {
    if (!skuId) throw new BadRequestException('skuId 必填');
    return this.analyticsService.forecast(skuId, parseInt(horizon, 10) || 3);
  }

  // P1-2 生命周期列表
  @CheckPermission('dashboard:view')
  @Get('lifecycle')
  async lifecycle(@Query('days') days = '90') {
    return this.analyticsService.lifecycleList(parseInt(days, 10) || 90);
  }

  @Post('lifecycle/set')
  async setLifecycle(
    @Body() body: { styleNo: string; status: string },
  ) {
    if (!body?.styleNo || !body?.status)
      throw new BadRequestException('styleNo 与 status 必填');
    return this.analyticsService.setLifecycle(body.styleNo, body.status);
  }

  // P1-5 自助 BI 钻取
  @CheckPermission('dashboard:view')
  @Get('bi')
  async bi(
    @Query('dim') dim: string,
    @Query('metric') metric = 'amount',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all') all = 'false',
  ) {
    if (!dim) throw new BadRequestException('dim 必填');
    return this.analyticsService.bi(
      dim,
      metric,
      from,
      to,
      all === 'true' || all === '1',
    );
  }

  @Post('approve')
  async approve(@Body() body: { docType: string; docId: string }) {
    if (!body?.docType || !body?.docId)
      throw new BadRequestException('docType 与 docId 必填');
    return this.analyticsService.approveDoc(body.docType, body.docId);
  }
}
