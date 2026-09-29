import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { PricingService } from './pricing.service';
import { PromotionPushService } from './promotion-push.service';
import type {
  PriceListDto,
  PriceListItemDto,
  PromotionDto,
  CouponDto,
  AddPriceListItemsDto,
} from './dto/pricing.dto';
import type { PaginationResult } from '@shared/api.interface';
import { resolvePagination } from '@server/common/dto/pagination';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly promotionPushService: PromotionPushService,
  ) {}

  /* ========== Price List ========== */

  @Get('price-list')
  listPriceLists(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Record<string, unknown>>> {
    return this.pricingService.listPriceLists({
      ...resolvePagination({ page, pageSize }),
      keyword,
      type,
      status,
    });
  }

  @Get('price-list/:id')
  getPriceList(@Param('id') id: string) {
    return this.pricingService.getPriceList(id);
  }

  @CheckPermission('pricing:manage')
  @Post('price-list')
  createPriceList(@Body() body: PriceListDto) {
    return this.pricingService.createPriceList(body);
  }

  @CheckPermission('pricing:manage')
  @Put('price-list/:id')
  updatePriceList(@Param('id') id: string, @Body() body: Partial<PriceListDto>) {
    return this.pricingService.updatePriceList(id, body);
  }

  @CheckPermission('pricing:manage')
  @Delete('price-list/:id')
  deletePriceList(@Param('id') id: string) {
    return this.pricingService.deletePriceList(id);
  }

  @CheckPermission('pricing:manage')
  @Post('price-list/:id/items')
  addPriceListItems(@Param('id') id: string, @Body() body: AddPriceListItemsDto) {
    return this.pricingService.addPriceListItems(id, body.items);
  }

  @CheckPermission('pricing:manage')
  @Put('price-list/item/:itemId')
  updatePriceListItem(@Param('itemId') itemId: string, @Body() body: Partial<PriceListItemDto>) {
    return this.pricingService.updatePriceListItem(itemId, body);
  }

  @CheckPermission('pricing:manage')
  @Delete('price-list/item/:itemId')
  removePriceListItem(@Param('itemId') itemId: string) {
    return this.pricingService.removePriceListItem(itemId);
  }

  /* ========== Promotion ========== */

  @Get('promotion')
  listPromotions(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Record<string, unknown>>> {
    return this.pricingService.listPromotions({
      ...resolvePagination({ page, pageSize }),
      keyword,
      type,
      status,
    });
  }

  /**
   * Wave 4-C：促销中心下行（ERP → POS）。
   *
   * 这是促销数据从 ERP 走到门店收银台的**唯一出口**。POS 的
   * `syncDownstream('promotions')` 以 `mode=snapshot` 调本接口拿到全量生效促销，
   * 按 `erpPromotionId` 幂等 upsert 到 pos_promotion，并对本轮未出现的
   * ERP 促销执行墓碑软删。
   *
   * - storeId：缺省返回全部门店可见的促销；传入则按 storeIds 命中过滤。
   * - asOf：生效期判定基准日（YYYY-MM-DD），默认当天；测试可注入固定值。
   *
   * 注意：必须声明在 `promotion/:id` **之前**，否则 Express 会先匹配到
   * `promotion/:id`（id='push'）而返回 404。
   */
  @Get('promotion/push')
  getPromotionPush(
    @Query('storeId') storeId?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.promotionPushService.getPushPayload({ storeId, asOf });
  }

  @Get('promotion/:id')
  getPromotion(@Param('id') id: string) {
    return this.pricingService.getPromotion(id);
  }

  @CheckPermission('pricing:manage')
  @Post('promotion')
  createPromotion(@Body() body: PromotionDto) {
    return this.pricingService.createPromotion(body);
  }

  @CheckPermission('pricing:manage')
  @Put('promotion/:id')
  updatePromotion(@Param('id') id: string, @Body() body: Partial<PromotionDto>) {
    return this.pricingService.updatePromotion(id, body);
  }

  @CheckPermission('pricing:manage')
  @Delete('promotion/:id')
  deletePromotion(@Param('id') id: string) {
    return this.pricingService.deletePromotion(id);
  }

  /* ========== Coupon ========== */

  @Get('coupon')
  listCoupons(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Record<string, unknown>>> {
    return this.pricingService.listCoupons({
      ...resolvePagination({ page, pageSize }),
      keyword,
      type,
      status,
    });
  }

  @Get('coupon/:id')
  getCoupon(@Param('id') id: string) {
    return this.pricingService.getCoupon(id);
  }

  @CheckPermission('pricing:manage')
  @Post('coupon')
  createCoupon(@Body() body: CouponDto) {
    return this.pricingService.createCoupon(body);
  }

  @CheckPermission('pricing:manage')
  @Put('coupon/:id')
  updateCoupon(@Param('id') id: string, @Body() body: Partial<CouponDto>) {
    return this.pricingService.updateCoupon(id, body);
  }

  @CheckPermission('pricing:manage')
  @Delete('coupon/:id')
  deleteCoupon(@Param('id') id: string) {
    return this.pricingService.deleteCoupon(id);
  }

  /* ========== Price Resolution ========== */

  @Get('resolve')
  resolvePrice(
    @Query('skuId') skuId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('styleNo') styleNo?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.pricingService.resolvePrice({ skuId, skuCode, styleNo, storeId });
  }
}
