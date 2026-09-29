import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COMMON_STATUS_VALUES,
  COUPON_TYPE_VALUES,
  PRICE_LIST_TYPE_VALUES,
  PROMOTION_TYPE_VALUES,
} from '@server/common/enums';

/** 价格表明细行 */
export class PriceListItemDto {
  @IsOptional()
  @IsString({ message: 'styleNo 必须为字符串' })
  styleNo?: string;

  @IsOptional()
  @IsString({ message: 'skuId 必须为字符串' })
  skuId?: string;

  @IsOptional()
  @IsString({ message: 'skuCode 必须为字符串' })
  skuCode?: string;

  @IsOptional()
  @IsNumber({}, { message: 'tagPrice 必须为数字' })
  tagPrice?: number;

  @IsNumber({}, { message: 'price 必须为数字' })
  @Min(0, { message: 'price 不能为负数' })
  price!: number;

  @IsOptional()
  @IsNumber({}, { message: 'discountRate 必须为数字' })
  discountRate?: number;

  @IsOptional()
  @IsString({ message: 'status 必须为字符串' })
  @IsIn(COMMON_STATUS_VALUES, { message: 'status 状态值不合法' })
  status?: string;
}

/** 价格表 */
export class PriceListDto {
  @IsString({ message: 'code 必须为字符串' })
  @IsNotEmpty({ message: 'code 价格表编码不能为空' })
  code!: string;

  @IsString({ message: 'name 必须为字符串' })
  @IsNotEmpty({ message: 'name 价格表名称不能为空' })
  name!: string;

  @IsString({ message: 'type 必须为字符串' })
  @IsIn(PRICE_LIST_TYPE_VALUES, { message: 'type 价格表类型不合法' })
  type!: string;

  @IsOptional()
  @IsString({ message: 'scopeId 必须为字符串' })
  scopeId?: string | null;

  @IsOptional()
  @IsNumber({}, { message: 'priority 必须为数字' })
  @IsInt({ message: 'priority 必须为整数' })
  priority?: number;

  @IsOptional()
  @IsString({ message: 'status 必须为字符串' })
  @IsIn(COMMON_STATUS_VALUES, { message: 'status 状态值不合法' })
  status?: string;

  @IsOptional()
  @IsString({ message: 'effectiveFrom 必须为字符串' })
  effectiveFrom?: string | null;

  @IsOptional()
  @IsString({ message: 'effectiveTo 必须为字符串' })
  effectiveTo?: string | null;

  @IsOptional()
  @IsString({ message: 'remark 必须为字符串' })
  remark?: string;
}

/** 促销活动 */
export class PromotionDto {
  @IsString({ message: 'code 必须为字符串' })
  @IsNotEmpty({ message: 'code 活动编码不能为空' })
  code!: string;

  @IsString({ message: 'name 必须为字符串' })
  @IsNotEmpty({ message: 'name 活动名称不能为空' })
  name!: string;

  @IsString({ message: 'type 必须为字符串' })
  @IsIn(PROMOTION_TYPE_VALUES, { message: 'type 促销类型不合法' })
  type!: string;

  @IsOptional()
  @IsNumber({}, { message: 'threshold 必须为数字' })
  @Min(0, { message: 'threshold 不能为负数' })
  threshold?: number;

  @IsOptional()
  @IsNumber({}, { message: 'reduceAmount 必须为数字' })
  @Min(0, { message: 'reduceAmount 不能为负数' })
  reduceAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'discountRate 必须为数字' })
  discountRate?: number;

  @IsOptional()
  @IsString({ message: 'beginDate 必须为字符串' })
  beginDate?: string | null;

  @IsOptional()
  @IsString({ message: 'endDate 必须为字符串' })
  endDate?: string | null;

  @IsOptional()
  @IsArray({ message: 'storeIds 必须为数组' })
  storeIds?: string[];

  @IsOptional()
  @IsNumber({}, { message: 'priority 必须为数字' })
  @IsInt({ message: 'priority 必须为整数' })
  priority?: number;

  @IsOptional()
  @IsString({ message: 'status 必须为字符串' })
  @IsIn(COMMON_STATUS_VALUES, { message: 'status 状态值不合法' })
  status?: string;

  @IsOptional()
  @IsString({ message: 'remark 必须为字符串' })
  remark?: string;
}

/** 优惠券 */
export class CouponDto {
  @IsString({ message: 'code 必须为字符串' })
  @IsNotEmpty({ message: 'code 券编码不能为空' })
  code!: string;

  @IsString({ message: 'name 必须为字符串' })
  @IsNotEmpty({ message: 'name 券名称不能为空' })
  name!: string;

  @IsString({ message: 'type 必须为字符串' })
  @IsIn(COUPON_TYPE_VALUES, { message: 'type 券类型不合法' })
  type!: string;

  @IsOptional()
  @IsNumber({}, { message: 'value 必须为数字' })
  @Min(0, { message: 'value 不能为负数' })
  value?: number;

  @IsOptional()
  @IsNumber({}, { message: 'discountRate 必须为数字' })
  discountRate?: number;

  @IsOptional()
  @IsNumber({}, { message: 'minSpend 必须为数字' })
  @Min(0, { message: 'minSpend 不能为负数' })
  minSpend?: number;

  @IsOptional()
  @IsString({ message: 'beginDate 必须为字符串' })
  beginDate?: string | null;

  @IsOptional()
  @IsString({ message: 'endDate 必须为字符串' })
  endDate?: string | null;

  @IsOptional()
  @IsNumber({}, { message: 'totalQty 必须为数字' })
  @IsInt({ message: 'totalQty 必须为整数' })
  @Min(0, { message: 'totalQty 不能为负数' })
  totalQty?: number;

  @IsOptional()
  @IsString({ message: 'status 必须为字符串' })
  @IsIn(COMMON_STATUS_VALUES, { message: 'status 状态值不合法' })
  status?: string;

  @IsOptional()
  @IsString({ message: 'remark 必须为字符串' })
  remark?: string;
}

/** 批量新增价格表明细 */
export class AddPriceListItemsDto {
  @IsArray({ message: 'items 必须为数组' })
  @ArrayMinSize(1, { message: 'items 明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => PriceListItemDto)
  items!: PriceListItemDto[];
}
