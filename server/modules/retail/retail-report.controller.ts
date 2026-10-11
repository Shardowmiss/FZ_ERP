import { Controller, Get, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { RetailReportService } from './retail-report.service';
import type {
  RetailReportSummary,
  RetailStoreRankItem,
  RetailStyleTopItem,
  RetailPayMethodStat,
  RetailTrendItem,
} from '@shared/api.interface';

interface RetailReportResponse {
  summary: RetailReportSummary;
  storeRank: RetailStoreRankItem[];
  styleTop: RetailStyleTopItem[];
  payMethodStats: RetailPayMethodStat[];
  trend: RetailTrendItem[];
}

// 零售报表：此前菜单挂 sales:order（与销售订单复用，权限树看不到），且本端点无守卫。
@NeedLogin()
@CheckPermission('report:retail_report')
@Controller('api/retail/report')
export class RetailReportController {
  constructor(private readonly retailReportService: RetailReportService) {}

  @Get('summary')
  async getSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('storeId') storeId?: string,
    @Query('brand') brand?: string,
  ): Promise<RetailReportResponse> {
    return this.retailReportService.getReport({
      startDate,
      endDate,
      storeId,
      brand,
    });
  }
}
