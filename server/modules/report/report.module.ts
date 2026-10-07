import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportPurchaseService } from './report-purchase.service';
import { ReportSalesService } from './report-sales.service';
import { ReportRetailService } from './report-retail.service';
import { ReportRetailSummaryService } from './report-retail-summary.service';
import { ReportInventoryService } from './report-inventory.service';
import { ReportTransferService } from './report-transfer.service';
import { ReportStockMovementService } from './report-stock-movement.service';
import { PivotEngineService } from './pivot-engine';
import { PivotTemplateService } from './pivot-template.service';

/**
 * 报表模块。
 *
 * `ReportService` 已退化为纯门面（只委托装配）。7 个报表域服务与透视引擎同处模块内部，
 * 只导出门面，避免外部越过门面直接依赖某个域（后续重构域边界不会波及调用方）。
 */
@Module({
  controllers: [ReportController],
  providers: [
    ReportService,
    ReportPurchaseService,
    ReportSalesService,
    ReportRetailService,
    ReportRetailSummaryService,
    ReportInventoryService,
    ReportTransferService,
    ReportStockMovementService,
    PivotEngineService,
    // 透视个人模板（迁移 0060）：按 owner 隔离，仅 ReportController 内部使用
    PivotTemplateService,
  ],
  exports: [ReportService],
})
export class ReportModule {}
