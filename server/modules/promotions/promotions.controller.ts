import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
  Query,
  Param,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard } from '../auth/auth.guard';
import { PromotionsService } from './promotions.service';
import type {
  Promotion,
  ListResponse,
  CalculatePromotionDto,
  PromotionCalculateResult,
} from '@shared/api.interface';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  async getPromotions(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<Promotion>> {
    return this.promotionsService.getPromotions({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
      type,
      keyword,
    });
  }

  @Get(':id')
  async getPromotion(@Param('id') id: string): Promise<Promotion> {
    return this.promotionsService.getPromotion(id);
  }

  @Post('calculate')
  async calculate(
    @Body() dto: CalculatePromotionDto,
  ): Promise<PromotionCalculateResult> {
    return this.promotionsService.calculate(dto);
  }
}
