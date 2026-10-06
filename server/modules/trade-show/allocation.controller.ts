import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AllocationService } from './allocation.service';
import type {
  AllocationOrder,
  PaginationResult,
  PreOrderSummary,
  PreOrderSkuSummary,
} from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/trade-show')
export class AllocationController {
  constructor(private readonly allocationService: AllocationService) {}

  // ========== 预订汇总 ==========

  @Get('summary')
  async getStyleSummary(
    @Query('tradeShowId') tradeShowId: string,
    @Query('brand') brand?: string,
  ): Promise<PreOrderSummary[]> {
    if (!tradeShowId) throw new BadRequestException('tradeShowId 必填');
    return this.allocationService.getStyleSummary(tradeShowId, brand);
  }

  @Get('summary/:styleId')
  async getSkuSummary(
    @Query('tradeShowId') tradeShowId: string,
    @Param('styleId') styleId: string,
  ): Promise<PreOrderSkuSummary> {
    return this.allocationService.getSkuSummary(tradeShowId, styleId);
  }

  // ========== 配货单 ==========

  @Get('allocation')
  async listAllocations(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('tradeShowId') tradeShowId?: string,
    @Query('styleId') styleId?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<AllocationOrder>> {
    return this.allocationService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      tradeShowId,
      styleId,
      status,
    });
  }

  @Get('allocation/:id')
  async getAllocationDetail(@Param('id') id: string): Promise<AllocationOrder> {
    return this.allocationService.getDetail(id);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:allocation')
  @Post('allocation')
  async createAllocation(
    @Req() req: Request,
    @Body()
    dto: {
      tradeShowId: string;
      styleId: string;
      totalArrivedQty: number;
      remark?: string;
    },
  ): Promise<AllocationOrder> {
    const { userId } = req.userContext;
    return this.allocationService.create(dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:allocation')
  @Put('allocation/:id')
  async updateAllocation(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    dto: {
      totalArrivedQty?: number;
      remark?: string;
      items?: {
        id?: string;
        skuId: string;
        allocatedQty: number;
      }[];
    },
  ): Promise<AllocationOrder> {
    const { userId } = req.userContext;
    return this.allocationService.update(id, dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:allocation')
  @Post('allocation/:id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.allocationService.voidDoc(id);
  }

  @CheckPermission('tradeshow:allocation')
  @Delete('allocation/:id')
  async deleteAllocation(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<void> {
    const { userId } = req.userContext;
    return this.allocationService.delete(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:allocation')
  @Post('allocation/:id/approve')
  async approveAllocation(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<AllocationOrder> {
    const { userId } = req.userContext;
    return this.allocationService.approve(id, userId);
  }
}
