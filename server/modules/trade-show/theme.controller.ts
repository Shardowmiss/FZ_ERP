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
import { ThemeService } from './theme.service';
import type { TradeShowTheme, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/trade-show/theme')
export class ThemeController {
  constructor(private readonly themeService: ThemeService) {}

  @Get()
  async list(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('keyword') keyword?: string,
    @Query('year') year?: string,
    @Query('season') season?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<TradeShowTheme>> {
    return this.themeService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      keyword,
      year,
      season,
      status,
    });
  }

  @Get('options')
  async getOptions(): Promise<{ id: string; themeCode: string; themeName: string }[]> {
    return this.themeService.getOptions();
  }

  @Get(':id')
  async getDetail(@Param('id') id: string): Promise<TradeShowTheme> {
    return this.themeService.getDetail(id);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:theme')
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    dto: {
      themeCode?: string;
      themeName: string;
      year?: string;
      season?: string;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<TradeShowTheme> {
    const { userId } = req.userContext;
    return this.themeService.create(dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:theme')
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    dto: {
      themeName?: string;
      year?: string;
      season?: string;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<TradeShowTheme> {
    const { userId } = req.userContext;
    return this.themeService.update(id, dto, userId);
  }

  @NeedLogin()
  @CheckPermission('tradeshow:theme')
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.themeService.delete(id, userId);
  }
}
