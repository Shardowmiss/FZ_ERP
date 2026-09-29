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
import { AuthGuard, Roles } from '../auth/auth.guard';
import { StockService } from './stock.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  StockDetail,
  StockMatrix,
  ListResponse,
  LowStockAlert,
} from '@shared/api.interface';
import { StockAdjustDto } from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  async getStockList(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('styleId') styleId?: string,
    @Query('keyword') keyword?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
  ): Promise<ListResponse<StockDetail>> {
    // P0-1：库存列表强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.stockService.getStockList({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      styleId,
      keyword,
      lowStockOnly: lowStockOnly === 'true',
    });
  }

  @Get('matrix/:styleId')
  async getStockMatrix(
    @Req() req: Request,
    @Param('styleId') styleId: string,
    @Query('storeId') storeId?: string,
  ): Promise<StockMatrix> {
    // P0-1：库存矩阵强制约束在登录主体门店
    return this.stockService.getStockMatrix(styleId, enforceStoreScope(principalFromReq(req), storeId));
  }

  @Roles('admin', 'manager')
  @Post('adjust')
  async adjustStock(
    @Req() req: Request,
    @Body() dto: StockAdjustDto,
  ): Promise<{ success: boolean; adjustNo: string }> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导（不再信任 Body.storeId）
    // P1-3：库存调整影响账目，限定店长/管理员
    return this.stockService.adjustStock(dto, principalFromReq(req));
  }

  @Roles('admin', 'manager')
  @Get('adjust/:adjustNo')
  async getStockAdjustDetail(
    @Req() req: Request,
    @Param('adjustNo') adjustNo: string,
  ) {
    // P0-1：读接口强制约束在登录主体门店（跨店查询隐藏存在性）
    const scopedStoreId = enforceStoreScope(principalFromReq(req), undefined);
    return this.stockService.getStockAdjustDetail(adjustNo, scopedStoreId);
  }

  @Get('low-stock')
  async getLowStock(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('threshold') threshold?: string,
  ): Promise<LowStockAlert[]> {
    // P0-1：低库存预警强制约束在登录主体门店
    return this.stockService.getLowStock(
      enforceStoreScope(principalFromReq(req), storeId),
      threshold ? parseInt(threshold, 10) : 10,
    );
  }
}
