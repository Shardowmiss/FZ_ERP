import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { RetailService } from './retail.service';
import type {
  RetailOrder,
  RetailReturn,
  RetailPayMethod,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

/**
 * 零售单 / 零售退货单 共用本控制器，但属两个可分别授权的资源：
 *   · 类级守卫 sales:retail        → 覆盖零售单全部端点（含此前无守卫的 GET）
 *   · 方法级守卫 sales:retail_return → 覆盖退货单端点（getAllAndOverride：方法级优先）
 * 此前两者均误用 retail:view（会员运营的码），导致「持 sales:order 者页面能开、接口 403」，
 * 反向持 retail:view 者却能操作零售单——已按真实调用链对齐。
 */
@NeedLogin()
@CheckPermission('sales:retail')
@Controller('api/retail')
export class RetailController {
  constructor(private readonly retailService: RetailService) {}

  /* ========== Retail Order ========== */

  @Get()
  async getRetailOrderList(
    @Req() req: Request,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('storeId') storeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PaginationResult<RetailOrder>> {
    return this.retailService.getRetailOrderList({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      storeId,
      startDate,
      endDate,
      status,
      keyword,
      userId: req.userContext?.userId,
      cursor,
    });
  }

  @Get('sku-by-barcode')
  async getSkuByBarcode(@Query('barcode') barcode: string): Promise<{
    id: string;
    skuCode: string;
    styleNo: string;
    color: string;
    size: string;
    tagPrice: number;
  }> {
    return this.retailService.getSkuByBarcode(barcode);
  }

  @Get('sku-by-code')
  async getSkuByCode(@Query('code') code: string): Promise<{
    id: string;
    skuCode: string;
    styleNo: string;
    color: string;
    size: string;
    tagPrice: number;
  }> {
    return this.retailService.getSkuByCode(code);
  }

  /* ========== Retail Return ========== */

  @CheckPermission('sales:retail_return:view')
  @Get('return')
  async getReturnList(
    @Req() req: Request,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('docStartDate') docStartDate?: string,
    @Query('docEndDate') docEndDate?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<RetailReturn>> {
    return this.retailService.getReturnList({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      storeId,
      status,
      keyword,
      docStartDate,
      docEndDate,
      startDate,
      endDate,
      userId: req.userContext?.userId,
    });
  }

  @CheckPermission('sales:retail_return:view')
  @Get('return/:id')
  async getReturnDetail(
    @Param('id') id: string,
  ): Promise<RetailReturn> {
    return this.retailService.getReturnDetail(id);
  }

  @CheckPermission('sales:retail_return:create')
  @Post('return')
  async createReturn(
    @Req() req: Request,
    @Body()
    body: {
      originalRetailId: string;
      items: { retailItemId: string; quantity: number }[];
      remark?: string;
    },
  ): Promise<{ id: string }> {
    const { userId } = req.userContext;
    return this.retailService.createReturn(body, userId);
  }

  @CheckPermission('sales:retail_return:create')
  @Post('return/:id/refund')
  async refundReturn(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<RetailReturn> {
    const { userId } = req.userContext;
    return this.retailService.refundReturn(id, userId);
  }

  /* ========== Retail Order dynamic routes ========== */

  @Get(':id')
  async getRetailOrderDetail(
    @Param('id') id: string,
  ): Promise<RetailOrder> {
    return this.retailService.getRetailOrderDetail(id);
  }

  @CheckPermission('sales:retail:create')
  @Post()
  async createDraftRetail(
    @Req() req: Request,
    @Body()
    body: {
      storeId: string;
      saleDate?: string;
      cashierName?: string;
      memberId?: string;
      source?: string;
      items: {
        skuId: string;
        quantity: number;
        dealPrice?: number;
        discountRate?: number;
      }[];
      remark?: string;
    },
  ): Promise<{ id: string }> {
    const { userId } = req.userContext;
    return this.retailService.createDraftRetail(body, userId);
  }

  @CheckPermission('sales:retail:edit')
  @Put(':id')
  async updateRetailItems(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      items: {
        skuId: string;
        quantity: number;
        dealPrice?: number;
        discountRate?: number;
      }[];
      remark?: string;
    },
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.retailService.updateRetailItems(id, body, userId);
  }

  @CheckPermission('sales:retail:create')
  @Post(':id/settle')
  async settleRetailOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      payMethods: RetailPayMethod[];
      receivedAmount?: number;
      wholeDiscount?: number;
    },
  ): Promise<RetailOrder> {
    const { userId } = req.userContext;
    return this.retailService.settleRetailOrder(id, body, userId);
  }

  @CheckPermission('sales:retail:void')
  @Post(':id/void')
  async voidOrder(@Param('id') id: string): Promise<void> {
    return this.retailService.voidOrder(id);
  }
  @CheckPermission('sales:retail_return')
  @Post('return/:id/void')
  async voidReturn(@Param('id') id: string): Promise<void> {
    return this.retailService.voidReturn(id);
  }

}

