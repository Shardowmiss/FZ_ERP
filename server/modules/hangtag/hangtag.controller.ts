import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { HangtagService } from './hangtag.service';

/**
 * 吊牌打印模块控制器
 *
 * 路由前缀：/api/hangtag
 *  - GET    /hangtag/config                    获取唯一码参数配置
 *  - POST   /hangtag/config                    设置唯一码参数配置（启用/长度）
 *  - GET    /hangtag/templates                 模板列表
 *  - POST   /hangtag/templates                 新建模板
 *  - GET    /hangtag/templates/:id             模板详情
 *  - PUT    /hangtag/templates/:id             更新模板
 *  - DELETE /hangtag/templates/:id             删除模板
 *  - POST   /hangtag/grid/purchase-order       按采购单生成二维表（自动带数量）
 *  - POST   /hangtag/grid/style                按款号生成二维表（数量为 0）
 *  - POST   /hangtag/print                     批量打印（生成任务/明细/日志 + 唯一码）
 *  - GET    /hangtag/logs                      打印日志列表
 *  - GET    /hangtag/logs/:id/items            某次打印明细
 *  - POST   /hangtag/logs/download             导出打印日志 CSV
 *
 * 注：受全局 AuthGuard 保护，需携带有效 x-auth-token。
 */
@Controller('api/hangtag')
export class HangtagController {
  constructor(private readonly svc: HangtagService) {}

  /* 唯一码参数配置 */
  @Get('config')
  getConfig(@Headers('x-auth-token') _t: string) {
    return this.svc.getUniqueCodeConfig();
  }

  @Post('config')
  setConfig(
    @Headers('x-auth-token') _t: string,
    @Body()
    body: {
      enabled: boolean;
      length?: number | null;
      /** 唯一码前缀（品牌码+年份），如 GM26 */
      prefix?: string | null;
      /** 是否启用模10校验位（防伪） */
      checksum?: boolean | null;
      /** 已发码后变更防伪/关闭开关需显式 force=true */
      force?: boolean;
    },
  ) {
    return this.svc.setUniqueCodeConfig(body);
  }

  /* 模板 */
  @Get('templates')
  listTemplates(@Headers('x-auth-token') _t: string) {
    return this.svc.listTemplates();
  }

  @Post('templates')
  createTemplate(@Headers('x-auth-token') _t: string, @Body() body: any) {
    return this.svc.createTemplate(body);
  }

  @Get('templates/:id')
  getTemplate(@Headers('x-auth-token') _t: string, @Param('id') id: string) {
    return this.svc.getTemplate(id);
  }

  @Put('templates/:id')
  updateTemplate(
    @Headers('x-auth-token') _t: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.updateTemplate(id, body);
  }

  @Delete('templates/:id')
  deleteTemplate(@Headers('x-auth-token') _t: string, @Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  /* 二维表生成 */
  @Post('grid/purchase-order')
  gridFromPO(@Headers('x-auth-token') _t: string, @Body() body: { orderNo: string }) {
    return this.svc.buildGridFromPurchaseOrder(body.orderNo);
  }

  @Post('grid/style')
  gridFromStyle(@Headers('x-auth-token') _t: string, @Body() body: { styleNo: string }) {
    return this.svc.buildGridFromStyle(body.styleNo);
  }

  /* 批量打印 */
  @Post('print')
  print(@Headers('x-auth-token') _t: string, @Body() body: any) {
    return this.svc.printTags(body);
  }

  /* 打印日志 */
  @Get('logs')
  listLogs(
    @Headers('x-auth-token') _t: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    return this.svc.listLogs({ from, to, sourceType });
  }

  @Get('logs/:id/items')
  logItems(@Headers('x-auth-token') _t: string, @Param('id') id: string) {
    return this.svc.getLogItems(id);
  }

  @Post('logs/download')
  async downloadLogs(
    @Headers('x-auth-token') _t: string,
    @Res() res: Response,
    @Body() body?: { from?: string; to?: string; sourceType?: string },
  ) {
    const rows = await this.svc.listLogs(body || {});
    const csv = this.svc.toLogsCsv(rows);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `吊牌打印日志_${ts}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  }
}
