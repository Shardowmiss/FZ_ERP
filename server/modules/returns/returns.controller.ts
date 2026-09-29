import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard } from '../auth/auth.guard';
import { ReturnsService } from './returns.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  ReturnOrder,
  ListResponse,
  SaleOrder,
} from '@shared/api.interface';
import { CreateReturnOrderDto } from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get('original-order')
  async findOriginalOrder(
    @Query('orderNo') orderNo: string,
    @Query('phone') phone?: string,
  ): Promise<SaleOrder | null> {
    return this.returnsService.findOriginalOrder(orderNo, phone);
  }

  @Post()
  async createReturn(@Body() dto: CreateReturnOrderDto): Promise<ReturnOrder> {
    return this.returnsService.createReturn(dto);
  }

  @Get()
  async getReturns(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<ReturnOrder>> {
    // P0-1：退货列表强制门店作用域，跨店读取自动降权到本店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.returnsService.getReturnList({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      startDate,
      endDate,
      keyword,
    });
  }

  @Get(':id')
  async getReturnDetail(@Param('id') id: string): Promise<ReturnOrder> {
    return this.returnsService.getReturnDetail(id);
  }
}
