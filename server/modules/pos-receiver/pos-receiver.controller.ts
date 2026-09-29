import {
  Body,
  Controller,
  Headers,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { Public } from '../../common/decorators/public.decorator';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { PosReceiverService } from './pos-receiver.service';
import { UpstreamTokenGuard } from './upstream-token.guard';
import {
  normalizeSales,
  normalizeReturns,
  normalizeStocktake,
  normalizeRequisition,
  normalizeEod,
} from './normalize';
import type { PosReceiveResult } from './dto/pos-receiver.dto';

/**
 * ERP 侧「POS 数据接收端」。
 * 与云裁POS RealErpAdapter.pushToErp 对齐（已按真实适配器 upstreamPath 校准）：
 *   POST {baseUrl}/sales
 *   POST {baseUrl}/returns
 *   POST {baseUrl}/stocktakes
 *   POST {baseUrl}/transfer-requests   ← 注意连字符（POS upstreamPath 即 'transfer-requests'）
 *   POST {baseUrl}/eods                ← 注意复数（POS upstreamPath 即 'eods'）
 *   其中 {baseUrl} = ERP_UPSTREAM_BASE_URL，须包含前缀 '/api/pos-receiver'
 *   Header: Idempotency-Key: {bizType}:{docNo}:{attempt}
 *   Body: JSON 单据（兼容 ERP camelCase / 下划线 / POS 业务对象 Id 风格，见 normalize.ts）
 *   Resp: { success, erpNo? }
 *
 * 鉴权：接收接口为 server-to-server（POS 适配器主动推送），使用 @Public() 跳过用户态鉴权，
 * 由 UpstreamTokenGuard 校验共享密钥头 X-Erp-Upstream-Token（= ERP_UPSTREAM_TOKEN）。
 * 补偿管理接口（failures/replay）为 ERP 内部运营接口，需 @NeedLogin + @CheckPermission，
 * 故不在此处类级统一加 @Public/@UseGuards，各接口单独声明。
 */
@Controller('api/pos-receiver')
export class PosReceiverController {
  constructor(private readonly receiver: PosReceiverService) {}

  @Public()
  @UseGuards(UpstreamTokenGuard)
  @Post('sales')
  receiveSales(
    @Headers('idempotency-key') _idem: string,
    @Body() body: any,
  ): Promise<PosReceiveResult> {
    return this.receiver.receiveSales(normalizeSales(body));
  }

  @Public()
  @UseGuards(UpstreamTokenGuard)
  @Post('returns')
  receiveReturns(
    @Headers('idempotency-key') _idem: string,
    @Body() body: any,
  ): Promise<PosReceiveResult> {
    return this.receiver.receiveReturns(normalizeReturns(body));
  }

  @Public()
  @UseGuards(UpstreamTokenGuard)
  @Post('stocktakes')
  receiveStocktake(
    @Headers('idempotency-key') _idem: string,
    @Body() body: any,
  ): Promise<PosReceiveResult> {
    return this.receiver.receiveStocktake(normalizeStocktake(body));
  }

  @Public()
  @UseGuards(UpstreamTokenGuard)
  @Post('transfer-requests')
  receiveTransferRequest(
    @Headers('idempotency-key') _idem: string,
    @Body() body: any,
  ): Promise<PosReceiveResult> {
    return this.receiver.receiveTransferRequest(normalizeRequisition(body));
  }

  @Public()
  @UseGuards(UpstreamTokenGuard)
  @Post('eods')
  receiveEod(
    @Headers('idempotency-key') _idem: string,
    @Body() body: any,
  ): Promise<PosReceiveResult> {
    return this.receiver.receiveEod(normalizeEod(body));
  }

  /* ---------------- 补偿管理（ERP 内部运营，需授权） ---------------- */

  @NeedLogin()
  @CheckPermission('pos:receiver:manage')
  @Get('failures')
  listFailures(
    @Query('status') status?: 'pending' | 'failed',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.receiver.listFailures({
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @NeedLogin()
  @CheckPermission('pos:receiver:manage')
  @Post('replay/:id')
  replay(@Param('id') id: string) {
    return this.receiver.replay(id);
  }
}
