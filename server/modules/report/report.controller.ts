import { Controller, Get, Post, Delete, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ReportService } from './report.service';
import { PivotTemplateService } from './pivot-template.service';
import type {
  ReportPurchaseItem,
  ReportSalesItem,
  ReportRetailItem,
  ReportInventoryItem,
  ReportTransferItem,
  ReportStockMovementItem,
  ReportSummaryBase,
  ReportRetailSummary,
  PivotConfig,
  PivotResponse,
} from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

interface ReportListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportSummaryBase;
}

interface RetailReportResponse {
  items: ReportRetailItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReportRetailSummary;
}

interface StockMovementReportResponse {
  items: ReportStockMovementItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    beginQty: number;
    purchaseInQty: number;
    salesOutQty: number;
    retailOutQty: number;
    transferNetQty: number;
    endQty: number;
    endAmount: number;
  };
}

@NeedLogin()
@Controller('api/report')
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly pivotTemplateService: PivotTemplateService,
  ) {}

  @Get('purchase')
  async purchaseReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('partnerIds') partnerIds: string,
    @Query('keyword') keyword: string,
    @Query('brand') brand: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('all') all: string,
  ): Promise<ReportListResponse<ReportPurchaseItem>> {
    return this.reportService.getPurchaseReport({
      startDate,
      endDate,
      partnerIds,
      keyword,
      brand,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      allowFullRange: all === 'true' || all === '1',
    });
  }

  @Get('sales')
  async salesReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('partnerIds') partnerIds: string,
    @Query('keyword') keyword: string,
    @Query('brand') brand: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('all') all: string,
  ): Promise<ReportListResponse<ReportSalesItem> & { summary: ReportSummaryBase & { totalDiscountAmount: number } }> {
    return this.reportService.getSalesReport({
      startDate,
      endDate,
      partnerIds,
      keyword,
      brand,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      allowFullRange: all === 'true' || all === '1',
    });
  }

  @Get('retail/summary')
  async retailSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('storeId') storeId: string,
    @Query('brand') brand: string,
    @Query('all') all: string,
  ): Promise<ReportRetailSummary> {
    return this.reportService.getRetailSummary({
      startDate,
      endDate,
      storeId,
      brand,
      allowFullRange: all === 'true' || all === '1',
    });
  }

  @Get('retail')
  async retailReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('partnerIds') partnerIds: string,
    @Query('keyword') keyword: string,
    @Query('brand') brand: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('all') all: string,
  ): Promise<RetailReportResponse> {
    return this.reportService.getRetailReport({
      startDate,
      endDate,
      partnerIds,
      keyword,
      brand,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      allowFullRange: all === 'true' || all === '1',
    });
  }

  @Get('inventory')
  async inventoryReport(
    @Query('warehouseId') warehouseId: string,
    @Query('keyword') keyword: string,
    @Query('brand') brand: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ): Promise<ReportListResponse<ReportInventoryItem>> {
    return this.reportService.getInventoryReport({
      warehouseId,
      keyword,
      brand,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
    });
  }

  @Get('transfer')
  async transferReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('partnerIds') partnerIds: string,
    @Query('keyword') keyword: string,
    @Query('brand') brand: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('all') all: string,
  ): Promise<ReportListResponse<ReportTransferItem>> {
    return this.reportService.getTransferReport({
      startDate,
      endDate,
      partnerIds,
      keyword,
      brand,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      allowFullRange: all === 'true' || all === '1',
    });
  }

  @Get('stock-movement')
  async stockMovementReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('warehouseId') warehouseId: string,
    @Query('keyword') keyword: string,
    @Query('brand') brand: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('all') all: string,
  ): Promise<StockMovementReportResponse> {
    return this.reportService.getStockMovementReport({
      startDate,
      endDate,
      warehouseId,
      keyword,
      brand,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      allowFullRange: all === 'true' || all === '1',
    });
  }

  @CheckPermission('report:pivot')
  @Post('pivot')
  async pivot(@Body() body: PivotConfig): Promise<PivotResponse> {
    return this.reportService.getPivotData(body);
  }

  /* ============ 透视个人模板（迁移 0060） ============
   * 全部接口按 req.userContext.userId 做 owner 隔离：
   * 只能读写自己的模板，DB 层 where 恒带 owner 条件，不存在越权可能。
   */

  /** 我的模板列表（含「最后一次查询」标记，最近更新在前） */
  @CheckPermission('report:pivot')
  @Get('pivot/templates')
  async listPivotTemplates(@Req() req: Request) {
    return this.pivotTemplateService.listMine(req.userContext.userId);
  }

  /** 保存为我的模板（同名则覆盖，便于「调好参数存回原模板」） */
  @CheckPermission('report:pivot')
  @Post('pivot/templates')
  async savePivotTemplate(
    @Req() req: Request,
    @Body() body: { name: string; config: PivotConfig; remark?: string },
  ) {
    return this.pivotTemplateService.save(req.userContext.userId, body);
  }

  /** 记住我最后一次查询（每次查询后调用，自动覆盖旧的） */
  @CheckPermission('report:pivot')
  @Post('pivot/templates/last')
  async rememberPivotLastQuery(
    @Req() req: Request,
    @Body() body: PivotConfig,
  ) {
    return this.pivotTemplateService.rememberLastQuery(
      req.userContext.userId,
      body,
    );
  }

  /** 恢复我最后一次查询；从未记录过返回 null（前端走默认，不报错） */
  @CheckPermission('report:pivot')
  @Get('pivot/templates/last')
  async getPivotLastQuery(@Req() req: Request) {
    return this.pivotTemplateService.getLastQuery(req.userContext.userId);
  }

  /** 删除我的模板（owner 条件在 where 内，越权会得到「不存在」） */
  @CheckPermission('report:pivot')
  @Delete('pivot/templates/:id')
  async deletePivotTemplate(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.pivotTemplateService.remove(req.userContext.userId, id);
    return { success: true };
  }
}
