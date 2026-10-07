import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { OpsService, ValidationParams } from './ops.service';

/**
 * 系统运维 - 数据质量校验控制器
 *
 * 路由前缀：/api/ops
 *  - GET  /ops/checks            获取全部可用校验项元数据
 *  - POST /ops/validate          触发批量数据校验，返回结构化报告(JSON)
 *  - POST /ops/report/download   生成并下载 CSV 校验报告（附件）
 *
 * 注：接口受全局 AuthGuard 保护，需携带有效 x-auth-token；未声明 @CheckPermission，
 * 默认放行（运维为内部角色）。
 */
@Controller('api/ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  /** 获取全部可用校验项 */
  @Get('checks')
  getChecks() {
    return this.ops.getChecks();
  }

  /** 批量校验，返回结构化报告 */
  @Post('validate')
  async validate(
    @Headers('x-auth-token') _token: string,
    @Body() body?: Partial<ValidationParams>,
  ) {
    return this.ops.runValidation(body);
  }

  /** 生成并下载 CSV 校验报告 */
  @Post('report/download')
  async downloadReport(
    @Headers('x-auth-token') _token: string,
    @Res() res: Response,
    @Body() body?: Partial<ValidationParams>,
  ) {
    const report = await this.ops.runValidation(body);
    const csv = this.ops.toCsv(report);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `数据校验报告_${ts}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  }
}
