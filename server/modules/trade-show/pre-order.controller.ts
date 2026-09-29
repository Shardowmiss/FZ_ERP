import {
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
import { PreOrderService } from './pre-order.service';
import type { PreOrder, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/trade-show/pre-order')
export class PreOrderController {
  constructor(private readonly preOrderService: PreOrderService) {}

  @Get()
  async list(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('tradeShowId') tradeShowId?: string,
    @Query('submitterType') submitterType?: string,
    @Query('dealerId') dealerId?: string,
    @Query('storeId') storeId?: string,
    @Query('styleId') styleId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<PreOrder>> {
    return this.preOrderService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      tradeShowId,
      submitterType,
      dealerId,
      storeId,
      styleId,
      status,
      keyword,
    });
  }

  @Get(':id')
  async getDetail(@Param('id') id: string): Promise<PreOrder> {
    return this.preOrderService.getDetail(id);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:preorder')
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    dto: {
      tradeShowId: string;
      submitterType: 'dealer' | 'direct';
      dealerId?: string;
      storeId?: string;
      styleId: string;
      items: {
        skuId: string;
        skuCode: string;
        color?: string;
        size?: string;
        qty: number;
      }[];
      remark?: string;
    },
  ): Promise<PreOrder> {
    const { userId } = req.userContext;
    return this.preOrderService.create(dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:preorder')
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    dto: {
      styleId?: string;
      items?: {
        skuId: string;
        skuCode: string;
        color?: string;
        size?: string;
        qty: number;
      }[];
      remark?: string;
    },
  ): Promise<PreOrder> {
    const { userId } = req.userContext;
    return this.preOrderService.update(id, dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:preorder')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.preOrderService.voidDoc(id);
  }

  @CheckPermission('tradeshow:preorder')
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.preOrderService.delete(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:preorder')
  @Post(':id/submit')
  async submit(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<PreOrder> {
    const { userId } = req.userContext;
    return this.preOrderService.submit(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:preorder')
  @Post(':id/confirm')
  async confirm(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<PreOrder> {
    const { userId } = req.userContext;
    return this.preOrderService.confirm(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:preorder')
  @Post(':id/reject')
  async reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body?: { backToDraft?: boolean },
  ): Promise<PreOrder> {
    const { userId } = req.userContext;
    return this.preOrderService.reject(id, userId, body?.backToDraft);
  }
}
