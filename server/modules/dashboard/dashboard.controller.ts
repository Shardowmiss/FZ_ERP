import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard } from '../auth/auth.guard';
import { DashboardService } from './dashboard.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  TodayKpi,
  SalesTrendPoint,
  TopStyleItem,
  ListResponse,
  EmployeeRankingItem,
  CategorySalesItem,
} from '@shared/api.interface';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('today')
  async getToday(@Req() req: Request, @Query('storeId') storeId?: string): Promise<TodayKpi> {
    // P0-1：看板指标强制约束在登录主体门店
    return this.dashboardService.getTodayKpi(enforceStoreScope(principalFromReq(req), storeId));
  }

  @Get('sales-trend')
  async getSalesTrend(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity: 'hour' | 'day' = 'day',
  ): Promise<SalesTrendPoint[]> {
    // P0-1：销售趋势强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.dashboardService.getSalesTrend({
      storeId: scopedStoreId,
      startDate,
      endDate,
      granularity,
    });
  }

  @Get('top-styles')
  async getTopStyles(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('category') category?: string,
  ): Promise<ListResponse<TopStyleItem>> {
    // P0-1：热销款强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.dashboardService.getTopStyles({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      startDate,
      endDate,
      category,
    });
  }

  @Get('employee-ranking')
  async getEmployeeRanking(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ListResponse<EmployeeRankingItem>> {
    // P0-1：员工排行强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.dashboardService.getEmployeeRanking({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      startDate,
      endDate,
    });
  }

  @Get('category-sales')
  async getCategorySales(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<CategorySalesItem[]> {
    // P0-1：品类销售强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.dashboardService.getCategorySales({
      storeId: scopedStoreId,
      startDate,
      endDate,
    });
  }
}
