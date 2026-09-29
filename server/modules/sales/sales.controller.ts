import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalesService } from './sales.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  SaleOrder,
  ListResponse,
  SuspendedOrder,
  SuspendOrderDto,
} from '@shared/api.interface';
import { CreateSaleOrderDto } from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('orders')
  async createOrder(
    @Body() dto: CreateSaleOrderDto,
    @Req() req: Request,
  ): Promise<SaleOrder> {
    return this.salesService.createOrder(dto, req.posUser);
  }

  @Get('orders')
  async getOrders(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('keyword') keyword?: string,
    @Query('memberId') memberId?: string,
  ): Promise<ListResponse<SaleOrder>> {
    // P0-1：门店作用域由 SalesService 按登录主体强制约束，控制器仅透传参数
    return this.salesService.getOrderList(
      {
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
        storeId,
        status,
        startDate,
        endDate,
        keyword,
        memberId,
      },
      req.posUser,
    );
  }

  @Get('orders/:id')
  async getOrderDetail(@Param('id') id: string): Promise<SaleOrder> {
    return this.salesService.getOrderDetail(id);
  }

  @Post('suspended-orders')
  async suspendOrder(
    @Body() dto: SuspendOrderDto,
    @Req() req: Request,
  ): Promise<SuspendedOrder> {
    return this.salesService.suspendOrder(dto, req.posUser);
  }

  @Get('suspended-orders')
  async getSuspended(@Req() req: Request, @Query('storeId') storeId?: string): Promise<SuspendedOrder[]> {
    // P0-1：挂单列表强制约束在登录主体门店
    return this.salesService.getSuspendedList(enforceStoreScope(principalFromReq(req), storeId));
  }

  @Post('suspended-orders/:id/activate')
  async activateSuspended(@Param('id') id: string): Promise<SuspendedOrder> {
    return this.salesService.activateSuspended(id);
  }
}
