import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { UniqueCodeService } from './unique-code.service';

/**
 * 公开溯源控制器（面向消费者 / 门店，无需登录）
 *
 * 路由前缀：/api/trace-public
 *  - GET /trace-public/:code          公开溯源摘要（消费者安全：不含操作人/内部单号）
 *  - GET /trace-public/qr/:code       溯源二维码（SVG），扫码后跳转公开溯源页
 *
 * 两个接口均标 @Public()，跳过全局 AuthGuard；仅暴露"消费者可看"的字段，
 * 与内部 /api/unique-code/trace（含操作人、内部单号）区分，避免内部信息外泄。
 */
@Public()
@Controller('api/trace-public')
export class TracePublicController {
  constructor(private readonly svc: UniqueCodeService) {}

  /** 公开溯源摘要 */
  @Get(':code')
  trace(@Param('code') code: string) {
    return this.svc.getPublicTrace(code);
  }

  /**
   * 溯源二维码（SVG）。
   * 编码目标 URL：配置 PUBLIC_TRACE_BASE_URL（生产必配，指向公网可访问的溯源页）
   * 或退回「当前请求 host」拼出 /trace/:code。消费者扫码即跳转到公开溯源页。
   */
  @Get('qr/:code')
  async qr(
    @Req() req: Request,
    @Res() res: Response,
    @Param('code') code: string,
    @Query('size') size?: string,
  ) {
    const base =
      process.env.PUBLIC_TRACE_BASE_URL ||
      `${req.protocol}://${req.get('host')}`;
    const url = `${base}/trace/${encodeURIComponent(code)}`;
    // qrcode 以运行期 require 引入，避免对类型声明的依赖，并保持服务端可独立打包
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: size ? parseInt(size, 10) || 240 : 240,
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(svg);
  }
}
