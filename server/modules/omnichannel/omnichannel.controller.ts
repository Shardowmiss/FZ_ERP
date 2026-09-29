import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { OmnichannelService } from './omnichannel.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  OmnichannelOrder,
  ListResponse,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/omnichannel')
export class OmnichannelController {
  constructor(private readonly omnichannelService: OmnichannelService) {}

  @Get('orders')
  async getOrders(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('channel') channel?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<OmnichannelOrder>> {
    // P0-1：全渠道订单列表强制门店作用域，跨店读取自动降权到本店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.omnichannelService.getOrders({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      type,
      channel,
      keyword,
    });
  }

  @Get('orders/:id')
  async getOrderDetail(@Param('id') id: string): Promise<OmnichannelOrder> {
    return this.omnichannelService.getOrderDetail(id);
  }

  @Post('orders/:id/ship')
  async shipOrder(
    @Param('id') id: string,
    @Body('logisticsCompany') logisticsCompany?: string,
    @Body('trackingNo') trackingNo?: string,
  ): Promise<OmnichannelOrder> {
    return this.omnichannelService.shipOrder(id, logisticsCompany, trackingNo);
  }

  @Post('orders/:id/pickup')
  async pickupOrder(
    @Param('id') id: string,
    @Body('pickupCode') pickupCode: string,
  ): Promise<OmnichannelOrder> {
    return this.omnichannelService.pickupOrder(id, pickupCode);
  }
}
