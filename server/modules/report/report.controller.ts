import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { ReportService } from './report.service';
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
  constructor(private readonly reportService: ReportService) {}

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
}
