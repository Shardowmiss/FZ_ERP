import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { UniqueCodeService } from './unique-code.service';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ParseTagDto,
  RegisterInboundDto,
  ReturnUniqueCodeDto,
  ScanDocumentDto,
  ScanOutboundDto,
  ScanTransferDto,
  StocktakeDto,
  VerifySoldDto,
} from './unique-code.dto';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

/**
 * 宽松校验管道：对声明字段做类型校验与转换，但不剥离/拒绝前端可能额外携带的字段，
 * 避免误伤现有前端请求（与全局管道策略一致：仅校验、不剥离）。
 */
const PERMISSIVE_VALIDATION = new ValidationPipe({
  transform: true,
  whitelist: false,
  forbidNonWhitelisted: false,
});

/**
 * 唯一码引擎控制器
 *
 * 路由前缀：/api/unique-code
 *  - POST /unique-code/parse            扫码解析（识别款色码 + 唯一码 + 校验位）
 *  - POST /unique-code/register-inbound 采购入库登记唯一码
 *  - POST /unique-code/scan-outbound    出库/零售扫码校验（三拒绝 + 去重）
 *  - POST /unique-code/scan-document    单据扫码统一入口（inbound/outbound/return/sold）
 *  - POST /unique-code/scan-transfer    调拨扫码（源仓出 + 目标仓入）
 *  - POST /unique-code/stocktake        盘点扫码对账（实扫 vs 在库）
 *  - POST /unique-code/verify-sold      结算核销（out → sold）
 *  - POST /unique-code/return           退货回滚（out/sold → in_stock）
 *  - GET  /unique-code/stock/:code      查询唯一码库存状态
 *  - GET  /unique-code/lifecycle-report 唯一码生命周期报表
 *
 * 受全局 AuthGuard 保护，需携带有效 x-auth-token。
 */
@Controller('unique-code')
export class UniqueCodeController {
  constructor(private readonly svc: UniqueCodeService) {}

  @Post('parse')
  @UsePipes(PERMISSIVE_VALIDATION)
  parse(
    @Headers('x-auth-token') _t: string,
    @Body() body: ParseTagDto,
  ) {
    if (!body?.raw) {
      return { matched: false, message: 'raw 不能为空' };
    }
    return this.svc.parseTagCode(body.raw, {
      separator: body.separator,
      validateChecksum: body.validateChecksum,
    });
  }

  @Post('register-inbound')
  @UsePipes(PERMISSIVE_VALIDATION)
  registerInbound(@Headers('x-auth-token') _t: string, @Body() body: RegisterInboundDto) {
    return this.svc.registerInbound(body);
  }

  @Post('scan-outbound')
  @UsePipes(PERMISSIVE_VALIDATION)
  scanOutbound(@Headers('x-auth-token') _t: string, @Body() body: ScanOutboundDto) {
    return this.svc.scanOutboundUniqueCode(body);
  }

  @Post('scan-document')
  @UsePipes(PERMISSIVE_VALIDATION)
  scanDocument(@Headers('x-auth-token') _t: string, @Body() body: ScanDocumentDto) {
    return this.svc.scanDocument(body);
  }

  @Post('scan-transfer')
  @UsePipes(PERMISSIVE_VALIDATION)
  scanTransfer(@Headers('x-auth-token') _t: string, @Body() body: ScanTransferDto) {
    return this.svc.scanTransfer(body);
  }

  @Post('stocktake')
  @UsePipes(PERMISSIVE_VALIDATION)
  stocktake(@Headers('x-auth-token') _t: string, @Body() body: StocktakeDto) {
    return this.svc.reconcileStocktake(body);
  }

  @Post('verify-sold')
  @UsePipes(PERMISSIVE_VALIDATION)
  verifySold(@Headers('x-auth-token') _t: string, @Body() body: VerifySoldDto) {
    return this.svc.verifySold(body);
  }

  @Post('return')
  @UsePipes(PERMISSIVE_VALIDATION)
  returnUniqueCode(@Headers('x-auth-token') _t: string, @Body() body: ReturnUniqueCodeDto) {
    return this.svc.returnUniqueCode(body);
  }

  @Get('stock/:code')
  stock(@Headers('x-auth-token') _t: string, @Param('code') code: string) {
    return this.svc.getUniqueCodeStock(code);
  }

  @Get('lifecycle-report')
  lifecycleReport(
    @Headers('x-auth-token') _t: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('styleNo') styleNo?: string,
  ) {
    return this.svc.getLifecycleReport({ warehouseId, styleNo });
  }

  /**
   * 唯一码溯源：单码历史出入库查询。
   * GET /api/unique-code/trace/:code
   * 可选 query: from / to (ISO 时间) / eventTypes (逗号分隔 inbound,outbound,sold,returned)
   */
  @Get('trace/:code')
  trace(
    @Headers('x-auth-token') _t: string,
    @Param('code') code: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('eventTypes') eventTypes?: string,
  ) {
    const opts: any = {};
    if (from) opts.from = new Date(from);
    if (to) opts.to = new Date(to);
    if (eventTypes) opts.eventTypes = eventTypes.split(',').map((s) => s.trim()).filter(Boolean);
    return this.svc.getTrace(code, opts);
  }

  /** 按 SKU 批量溯源：GET /api/unique-code/trace-by-sku?skuId=xxx */
  @Get('trace-by-sku')
  traceBySku(@Headers('x-auth-token') _t: string, @Query('skuId') skuId?: string) {
    if (!skuId) return { enabled: false, skuId: null, totalCodes: 0, items: [] };
    return this.svc.getTraceBySku(skuId);
  }

  /** 溯源导出 CSV：GET /api/unique-code/trace-export?code=xxx （UTF-8 BOM） */
  @Get('trace-export')
  async traceExport(
    @Headers('x-auth-token') _t: string,
    @Res() res: any,
    @Query('code') code?: string,
  ) {
    if (!code) {
      res.status(400).send('code 不能为空');
      return;
    }
    const trace = await this.svc.getTrace(code);
    const csv = this.svc.buildTraceCsv(trace);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trace_${code}.csv"`);
    res.send(csv);
  }

  /**
   * 跨区间批量溯源：GET /api/unique-code/trace-range
   * query: from / to (ISO) / skuId / styleNo / color / size / warehouseId / eventTypes(逗号) / limit
   * 返回扁平件级流水（含业务单号、操作人、串货标记）。
   */
  @Get('trace-range')
  traceRange(
    @Headers('x-auth-token') _t: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skuId') skuId?: string,
    @Query('styleNo') styleNo?: string,
    @Query('color') color?: string,
    @Query('size') size?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('eventTypes') eventTypes?: string,
    @Query('limit') limit?: string,
  ) {
    const opts: any = {};
    if (from) opts.from = new Date(from);
    if (to) opts.to = new Date(to);
    if (skuId) opts.skuId = skuId;
    if (styleNo) opts.styleNo = styleNo;
    if (color) opts.color = color;
    if (size) opts.size = size;
    if (warehouseId) opts.warehouseId = warehouseId;
    if (eventTypes) opts.eventTypes = eventTypes.split(',').map((s) => s.trim()).filter(Boolean);
    if (limit) opts.limit = parseInt(limit, 10) || undefined;
    return this.svc.getTraceByRange(opts);
  }

  /**
   * 串货违规检出：GET /api/unique-code/channel-violations
   * query: skuId / styleNo / warehouseId
   * 返回所有"未经调拨即从非原始采购入库仓销售出库"的疑似串货件。
   */
  @Get('channel-violations')
  channelViolations(
    @Headers('x-auth-token') _t: string,
    @Query('skuId') skuId?: string,
    @Query('styleNo') styleNo?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.svc.getChannelViolations({ skuId, styleNo, warehouseId });
  }

  /**
   * 流水归档统计：GET /api/unique-code/trace-archive-stats
   * 返回热表 / 归档表 各自条数与时间范围（P2 冷热分离治理视图）。
   * 仅管理员（system:config）可访问。
   */
  @Get('trace-archive-stats')
  @UseGuards(PermissionGuard)
  @CheckPermission('system:config')
  traceArchiveStats(@Headers('x-auth-token') _t: string) {
    return this.svc.getArchiveStats();
  }

  /**
   * 流水归档（P2 冷热分离）：POST /api/unique-code/trace-archive
   * body: { before?: ISO 时间, days?: 归档天数, batchSize?: 每批条数 }
   * 优先级：before > days > 默认 1 年前。days<=0 时按默认（向后兼容）。
   * 将 scan_at 早于 before 的热表流水分批搬移到归档表；返回搬移条数 moved。
   * 仅管理员（system:config）可调用。
   */
  @Post('trace-archive')
  @UseGuards(PermissionGuard)
  @CheckPermission('system:config')
  async traceArchive(
    @Headers('x-auth-token') _t: string,
    @Body() body?: { before?: string; days?: number; batchSize?: number },
  ): Promise<{ moved: number; before: string; days: number; enabled: boolean }> {
    const batchSize =
      body?.batchSize && body.batchSize > 0 ? Math.trunc(body.batchSize) : 2000;
    // 显式 before（ISO 时间）优先：直接按时间搬移，标记 enabled=true
    if (body?.before) {
      const before = new Date(body.before);
      if (Number.isNaN(before.getTime())) {
        return { moved: 0, before: body.before, days: 0, enabled: false };
      }
      const r = await this.svc.archiveOldEvents(before, batchSize);
      return { ...r, days: 0, enabled: true };
    }
    // 其次 days（归档天数）：交由 archiveByDays 计算 before 并返回完整结果（含 days/enabled）
    const days = body?.days && body.days > 0 ? Math.trunc(body.days) : 365;
    return this.svc.archiveByDays(days, batchSize);
  }
}
