import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PayMethod } from '@server/common/enums';

/** 单个结算商品行 */
export class PosCheckoutItemDto {
  @IsOptional()
  @IsString({ message: 'skuId 必须为字符串' })
  skuId?: string;

  @IsOptional()
  @IsString({ message: 'skuCode 必须为字符串' })
  skuCode?: string;

  @IsNumber({}, { message: 'quantity 必须为数字' })
  @IsInt({ message: 'quantity 必须为整数' })
  @Min(1, { message: 'quantity 必须大于0' })
  quantity!: number;
}

/** 开班（开班备用金 / 收银员） */
export class OpenSessionDto {
  @IsString({ message: 'storeId 必须为字符串' })
  @IsNotEmpty({ message: 'storeId 门店ID不能为空' })
  storeId!: string;

  @IsOptional()
  @IsNumber({}, { message: 'openAmount 必须为数字' })
  @Min(0, { message: 'openAmount 不能为负数' })
  openAmount?: number;

  @IsOptional()
  @IsString({ message: 'cashierName 必须为字符串' })
  cashierName?: string;
}

/** 闭班（实点现金） */
export class CloseSessionDto {
  @IsNumber({}, { message: 'closeAmount 必须为数字' })
  @Min(0, { message: 'closeAmount 不能为负数' })
  closeAmount!: number;
}

/** 一站式结算 */
export class PosCheckoutDto {
  @IsString({ message: 'storeId 必须为字符串' })
  @IsNotEmpty({ message: 'storeId 门店ID不能为空' })
  storeId!: string;

  @IsOptional()
  @IsString({ message: 'cashierName 必须为字符串' })
  cashierName?: string;

  @IsOptional()
  @IsString({ message: 'memberId 必须为字符串' })
  memberId?: string;

  @IsOptional()
  @IsString({ message: 'sessionId 必须为字符串' })
  sessionId?: string;

  @IsArray({ message: 'items 必须为数组' })
  @ArrayMinSize(1, { message: 'items 购物车不能为空' })
  @ValidateNested({ each: true })
  @Type(() => PosCheckoutItemDto)
  items!: PosCheckoutItemDto[];

  @IsArray({ message: 'payMethods 必须为数组' })
  payMethods!: Array<{ method: string; amount: string | number }>;

  @IsOptional()
  @IsNumber({}, { message: 'receivedAmount 必须为数字' })
  @Min(0, { message: 'receivedAmount 不能为负数' })
  receivedAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'wholeDiscount 必须为数字' })
  wholeDiscount?: number;

  @IsOptional()
  @IsString({ message: 'remark 必须为字符串' })
  remark?: string;

  /**
   * 幂等键（客户端生成的 UUID）。网络重试时携带相同 key，
   * 服务端会直接返回首次结算结果，避免重复零售单与重复扣库存。
   */
  @IsOptional()
  @IsString({ message: 'idempotencyKey 必须为字符串' })
  idempotencyKey?: string;
}

/** 报价/优惠预览（前端购物车） */
export class PosQuoteDto {
  @IsString({ message: 'storeId 必须为字符串' })
  @IsNotEmpty({ message: 'storeId 门店ID不能为空' })
  storeId!: string;

  @IsArray({ message: 'items 必须为数组' })
  @ArrayMinSize(1, { message: 'items 购物车不能为空' })
  @ValidateNested({ each: true })
  @Type(() => PosCheckoutItemDto)
  items!: PosCheckoutItemDto[];
}

// 让 PayMethod 在 DTO 校验场景可被引用（避免未使用告警的同时明确支付方式取值来源）
export const SUPPORTED_PAY_METHODS = Object.values(PayMethod);
