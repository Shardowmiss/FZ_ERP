import { Controller, Get, Post, Delete, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ReportService } from './report.service';
import { PivotTemplateService } from './pivot-template.service';
import { RbacService } from '../rbac/rbac.service';
import { PivotSemanticService } from './pivot-semantic.service';
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
    private readonly rbacService: RbacService,
    private readonly semanticService: PivotSemanticService,
  ) {}

  /**
   * 毛利类字段的权限码（复用既有的 finance:profit「财务-利润」，不新增权限码）。
   *
   * 为什么单独控：透视的粗粒度权限是 `report:pivot`——拿到就能用任何指标。
   * 但毛利/成本属敏感经营数据，导购、店长等角色不应看到全公司利润。
   * `report:pivot` 管「能不能用透视」，`finance:profit` 管「能不能看毛利」，
   * 两级权限各司其职。
   */
  private static readonly PROFIT_FIELDS = new Set(['cost', 'profit']);

  /** 取当前用户 token（与 CheckPermission 装饰器同源：x-auth-token） */
  private static extractToken(req: Request): string {
    const h = req.headers['x-auth-token'] ?? req.headers['authorization'];
    return (Array.isArray(h) ? h[0] : h ?? '').replace(/^Bearer\s+/i, '');
  }

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
  async pivot(@Req() req: Request, @Body() body: PivotConfig): Promise<PivotResponse> {
    // 毛利/成本字段做字段级权限控制：无 finance:profit 则直接剥离，
    // 返回体中不含任何毛利数据（而非仅前端隐藏），杜绝越权取数。
    const canSeeProfit = await this.rbacService.checkPermission(
      ReportController.extractToken(req),
      'finance:profit',
    );
    const values = canSeeProfit
      ? body.values
      : (body.values ?? []).filter((v) => !ReportController.PROFIT_FIELDS.has(v.key));
    return this.reportService.getPivotData({ ...body, values });
  }

  /**
   * 透视语义清单：维度/指标的 key、中文标签、分类、格式化、敏感标记。
   *
   * 前端维度选择器改为读本接口，从而**不必再在前端维护一份中文字典**——
   * 新增维度时后端语义表与前端标签自动对齐，不会出现「后端能查、前端无标签」。
   *
   * 敏感指标（毛利/成本）对无 finance:profit 的角色不下发，
   * 与 pivot() 的剥离逻辑同源，保证「界面可见」与「接口可取」一致。
   *
   * 引擎白名单仍是唯一执行授权：语义层不新增可执行字段，
   * 语义表里写了引擎未实现的 key 也不会被放行（见 pivot-engine 校验）。
   */
  @CheckPermission('report:pivot')
  @Get('pivot/semantics')
  async pivotSemantics(@Req() req: Request) {
    const [fields, canSeeProfit] = await Promise.all([
      this.semanticService.listEnabled(),
      this.rbacService.checkPermission(
        ReportController.extractToken(req),
        'finance:profit',
      ),
    ]);
    return {
      // 按 category 分组，前端直接渲染成分组下拉
      groups: fields
        .filter((f) => canSeeProfit || !f.sensitive)
        .reduce<Record<string, Array<{ key: string; label: string; kind: string; valueFormat: string }>>>(
          (acc, f) => {
            const g = acc[f.category] ?? [];
            g.push({ key: f.key, label: f.label, kind: f.kind, valueFormat: f.valueFormat });
            acc[f.category] = g;
            return acc;
          },
          {},
        ),
      canSeeProfit,
    };
  }

  /**
   * 返回当前用户可用的透视指标清单（前端据此隐藏毛利/成本指标）。
   * 与 pivot() 的剥离逻辑共用同一权限码，保证「界面可见」与「接口可取」一致。
   */
  @CheckPermission('report:pivot')
  @Get('pivot/capabilities')
  async pivotCapabilities(@Req() req: Request): Promise<{ canSeeProfit: boolean }> {
    const canSeeProfit = await this.rbacService.checkPermission(
      ReportController.extractToken(req),
      'finance:profit',
    );
    return { canSeeProfit };
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
