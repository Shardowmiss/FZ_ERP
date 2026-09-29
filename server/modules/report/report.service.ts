import { Injectable } from '@nestjs/common';
import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { PivotEngineService } from './pivot-engine';
import { ReportPurchaseService } from './report-purchase.service';
import { ReportSalesService } from './report-sales.service';
import { ReportRetailService } from './report-retail.service';
import { ReportRetailSummaryService } from './report-retail-summary.service';
import { ReportInventoryService } from './report-inventory.service';
import { ReportTransferService } from './report-transfer.service';
import { ReportStockMovementService } from './report-stock-movement.service';
import type {
  BaseQueryParams,
  InventoryQueryParams,
  StockMovementQueryParams,
  RetailSummaryParams,
  PurchaseReportResult,
  SalesReportResult,
  RetailReportResult,
  InventoryReportResult,
  TransferReportResult,
  StockMovementReportResult,
} from './report-interfaces';
import type { ReportRetailSummary, PivotConfig, PivotResponse } from '@shared/api.interface';

/**
 * 报表引擎【门面】。
 *
 * 原 `report.service.ts` 把 7 张报表的查询逻辑（约 870 行）与透视引擎一起堆在门面里，
 * 经 `check_facade_delegation.cjs` 复核确认 7/8 方法"半委托半代理"。本次按报表数据源拆成
 * 7 个职责域服务，门面只做委托装配：
 *
 *   ① 采购入库   ReportPurchaseService        getPurchaseReport
 *   ② 销售出库   ReportSalesService            getSalesReport
 *   ③ 门店零售   ReportRetailService           getRetailReport
 *   ④ 零售汇总   ReportRetailSummaryService    getRetailSummary
 *   ⑤ 库存       ReportInventoryService        getInventoryReport
 *   ⑥ 调拨       ReportTransferService         getTransferReport
 *   ⑦ 库存收发存 ReportStockMovementService    getStockMovementReport
 *   ⑧ 透视       PivotEngineService            getPivotData（此前已迁出）
 *
 * 依赖关系：门面依赖全部 7 个域（无环，各域只依赖 db + 共享纯函数
 * resolveReportWindow / buildAggregationScope / escapeLike）。
 *
 * 对外契约保持不变：controller、下游调用方与行为护栏仍只与门面打交道，
 * 拆域前后方法签名 / 返回值 / SQL 逐字一致。构造方式：Nest DI 提供，
 * `createReportService(db)` 供脚本直构。
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly purchase: ReportPurchaseService,
    private readonly sales: ReportSalesService,
    private readonly retail: ReportRetailService,
    private readonly retailSummary: ReportRetailSummaryService,
    private readonly inventory: ReportInventoryService,
    private readonly transfer: ReportTransferService,
    private readonly stockMovement: ReportStockMovementService,
    private readonly pivotEngine: PivotEngineService,
  ) {}

  /* --------------------------- ① 采购入库 --------------------------- */
  getPurchaseReport(params: BaseQueryParams): Promise<PurchaseReportResult> {
    return this.purchase.getPurchaseReport(params);
  }

  /* --------------------------- ② 销售出库 --------------------------- */
  getSalesReport(params: BaseQueryParams): Promise<SalesReportResult> {
    return this.sales.getSalesReport(params);
  }

  /* --------------------------- ③ 门店零售 --------------------------- */
  getRetailReport(params: BaseQueryParams): Promise<RetailReportResult> {
    return this.retail.getRetailReport(params);
  }

  /* --------------------------- ④ 零售汇总 --------------------------- */
  getRetailSummary(params: RetailSummaryParams): Promise<ReportRetailSummary> {
    return this.retailSummary.getRetailSummary(params);
  }

  /* --------------------------- ⑤ 库存 --------------------------- */
  getInventoryReport(params: InventoryQueryParams): Promise<InventoryReportResult> {
    return this.inventory.getInventoryReport(params);
  }

  /* --------------------------- ⑥ 调拨 --------------------------- */
  getTransferReport(params: BaseQueryParams): Promise<TransferReportResult> {
    return this.transfer.getTransferReport(params);
  }

  /* --------------------------- ⑦ 库存收发存 --------------------------- */
  getStockMovementReport(
    params: StockMovementQueryParams,
  ): Promise<StockMovementReportResult> {
    return this.stockMovement.getStockMovementReport(params);
  }

  /**
   * 透视分析入口（Wave 4-D）：实现整体在 `pivot-engine.ts` 的 `PivotEngineService`。
   * 门面只做薄委托，controller 调用契约与返回结构完全不变。
   * 行为锁定见 test/report-pivot.spec.ts。
   */
  getPivotData(config: PivotConfig): Promise<PivotResponse> {
    return this.pivotEngine.run(config);
  }
}

/**
 * 唯一装配点：Nest DI 与脚本直构共用。
 * 各子服务只依赖 db（由 @Inject(DRIZZLE_DATABASE) 提供），依次直构即可，依赖图无环。
 */
export function createReportService(db: PostgresJsDatabase): ReportService {
  const purchase = new ReportPurchaseService(db);
  const sales = new ReportSalesService(db);
  const retail = new ReportRetailService(db);
  const retailSummary = new ReportRetailSummaryService(db);
  const inventory = new ReportInventoryService(db);
  const transfer = new ReportTransferService(db);
  const stockMovement = new ReportStockMovementService(db);
  const pivot = new PivotEngineService(db);
  return new ReportService(
    purchase,
    sales,
    retail,
    retailSummary,
    inventory,
    transfer,
    stockMovement,
    pivot,
  );
}
