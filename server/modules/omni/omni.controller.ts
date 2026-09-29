import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { OmniService } from './omni.service';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/omni')
export class OmniController {
  constructor(private readonly omniService: OmniService) {}

  @Get('channels')
  async channels() {
    return this.omniService.listChannels();
  }

  @CheckPermission('omni:manage')
  @Post('channels')
  async createChannel(@Body() body: Record<string, unknown>) {
    if (!body?.name || !body?.channelCode)
      throw new BadRequestException('name 与 channelCode 必填');
    return this.omniService.createChannel(body as never);
  }

  @Get('orders')
  async orders(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.omniService.listOrders({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
      channelId,
    });
  }

  @Get('orders/:id')
  async order(@Param('id') id: string) {
    return this.omniService.getOrder(id);
  }

  @CheckPermission('omni:manage')
  @Post('orders')
  async createOrder(@Body() body: Record<string, unknown>) {
    return this.omniService.createOrder(body as never);
  }

  @CheckPermission('omni:manage')
  @Post('orders/audit')
  async audit(@Body() body: { orderId: string }) {
    if (!body?.orderId) throw new BadRequestException('orderId 必填');
    return this.omniService.audit(body.orderId);
  }

  @CheckPermission('omni:manage')
  @Post('orders/allocate')
  async allocate(@Body() body: { orderId: string }) {
    if (!body?.orderId) throw new BadRequestException('orderId 必填');
    return this.omniService.allocate(body.orderId);
  }

  @CheckPermission('omni:manage')
  @Post('orders/ship')
  async ship(@Body() body: { orderId: string }) {
    if (!body?.orderId) throw new BadRequestException('orderId 必填');
    return this.omniService.ship(body.orderId);
  }
}
