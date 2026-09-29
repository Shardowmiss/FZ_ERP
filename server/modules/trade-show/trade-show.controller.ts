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
import { TradeShowService } from './trade-show.service';
import type { TradeShow, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/trade-show')
export class TradeShowController {
  constructor(private readonly tradeShowService: TradeShowService) {}

  @Get()
  async list(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('keyword') keyword?: string,
    @Query('year') year?: string,
    @Query('season') season?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<TradeShow>> {
    return this.tradeShowService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      keyword,
      year,
      season,
      status,
    });
  }

  @Get('options')
  async getOptions(): Promise<
    { id: string; showNo: string; name: string; status: string }[]
  > {
    return this.tradeShowService.getOptions();
  }

  @Get(':id')
  async getDetail(@Param('id') id: string): Promise<TradeShow> {
    return this.tradeShowService.getDetail(id);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    dto: {
      showNo?: string;
      name: string;
      year?: string;
      season?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      remark?: string;
    },
  ): Promise<TradeShow> {
    const { userId } = req.userContext;
    return this.tradeShowService.create(dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      year?: string;
      season?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      remark?: string;
    },
  ): Promise<TradeShow> {
    const { userId } = req.userContext;
    return this.tradeShowService.update(id, dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.tradeShowService.delete(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.tradeShowService.voidDoc(id);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Post(':id/start')
  async start(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<TradeShow> {
    const { userId } = req.userContext;
    return this.tradeShowService.start(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Post(':id/end')
  async end(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<TradeShow> {
    const { userId } = req.userContext;
    return this.tradeShowService.end(id, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:manage')
  @Post(':id/close')
  async close(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<TradeShow> {
    const { userId } = req.userContext;
    return this.tradeShowService.close(id, userId);
  }
}
