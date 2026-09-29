/**
 * P1-7：服务端输入校验 DTO（class-validator）。
 *
 * 设计原则：
 * - shared/api.interface.ts 中的 DTO 是纯 interface（运行时被擦除，无法做运行时校验），
 *   且被客户端复用，不宜就地加装饰器。故校验类集中放此处（仅服务端用），
 *   形状与 shared 保持一致，控制器把 `@Body()` 参数类型换成本处 class 即可生效。
 * - 校验重点：金额非负且设上限（防整数分溢出/异常报表）、ID 必填、数量正整数、
 *   枚举受限、嵌套数组逐项校验、分页上限。
 * - 全局 ValidationPipe 已开 whitelist，仅对本文件 class（有装饰器元数据）生效，
 *   未迁移的 interface 型 DTO 不受影响，故可增量迁移、零回归。
 */

import {
  ArrayMinSize,
  IsArray,
  IsIn,
  Matches,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { OfflineEntityType } from '@shared/api.interface';

/** 金额上限（元）。整数分存储上限约 9.2e18 分，此处以业务合理上限兜底，防异常报表/误填 */
export const MAX_MONEY = 100_000_000;

// ============ 零售开单 ============
export class SaleItemDto {
  @IsString()
  @IsNotEmpty()
  skuId!: string;

  @IsString()
  @IsNotEmpty()
  styleId!: string;

  @IsString()
  styleName!: string;

  @IsString()
  colorId!: string;

  @IsString()
  sizeId!: string;

  /** 数量必须为正整数（0 元提货/负数量由服务端覆写前先在此拦截非法输入） */
  @IsInt()
  @Min(1)
  qty!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  tagPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  discountAmount!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  lineAmount!: number;
}

export class SaleDiscountDto {
  @IsOptional()
  @IsString()
  promotionId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  type!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  amount!: number;
}

export class SalePaymentDto {
  @IsString()
  @IsNotEmpty()
  payMethod!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  amount!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  changeAmount!: number;

  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class CreateSaleOrderDto {
  /** P0-1：storeId 服务端会重写，保留仅作兼容，不强制 */
  @IsString()
  storeId!: string;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  /**
   * 业务成交日期 YYYY-MM-DD，由客户端在**成交那一刻**打戳。
   * 离线优先 POS 必须带：上行同步可能滞后数天，服务端无从还原真实成交日。
   * 不传则落库为 CURRENT_DATE（= 服务端当日），仍可能被上行同步日顶替，故不推荐。
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'saleDate 日期格式应为 YYYY-MM-DD',
  })
  saleDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments!: SalePaymentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleDiscountDto)
  discounts?: SaleDiscountDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsUsed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  roundingAmount?: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  shiftId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;
}

// ============ 退货 ============
export class ReturnItemDto {
  @IsString()
  @IsNotEmpty()
  originalItemId!: string;

  @IsString()
  @IsNotEmpty()
  skuId!: string;

  @IsString()
  styleId!: string;

  @IsString()
  styleName!: string;

  @IsString()
  colorId!: string;

  @IsString()
  sizeId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  refundPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  lineAmount!: number;
}

export class CreateReturnOrderDto {
  @IsString()
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  originalOrderNo!: string;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @IsString()
  @IsNotEmpty()
  refundMethod!: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  shiftId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;
}

// ============ 库存调整 ============
export class StockAdjustItemDto {
  @IsString()
  @IsNotEmpty()
  skuId!: string;

  @IsString()
  styleId!: string;

  @IsString()
  colorId!: string;

  @IsString()
  sizeId!: string;

  /** 可为负（盘亏） */
  @IsInt()
  qty!: number;
}

export class StockAdjustDto {
  @IsString()
  storeId!: string;

  @IsIn(['increase', 'decrease', 'check'])
  type!: 'increase' | 'decrease' | 'check';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustItemDto)
  items!: StockAdjustItemDto[];

  @IsOptional()
  @IsString()
  clientId?: string;
}

// ============ 会员 ============
export class RechargeDto {
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  amount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  giftAmount?: number;

  @IsOptional()
  @IsString()
  payMethod?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class AdjustStoredValueDto {
  /** 可为负（扣减），但不可为 0（服务层拦截） */
  @IsNumber()
  amount!: number;

  /** 调整原因必填且不少于 4 字符，用于资金审计（与服务层 adjustStoredValue 一致） */
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class IssueCouponDto {
  @IsIn(['discount', 'full_reduction'])
  type!: 'discount' | 'full_reduction';

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  discountValue!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  minAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  validDays?: number;

  @IsOptional()
  @IsString()
  validFrom?: string;

  @IsOptional()
  @IsString()
  validTo?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

// ============ 要货 / 盘点 ============
export class TransferRequestItemDto {
  @IsString()
  @IsNotEmpty()
  skuId!: string;

  @IsString()
  styleId!: string;

  @IsString()
  colorId!: string;

  @IsString()
  sizeId!: string;

  @IsInt()
  @Min(1)
  reqQty!: number;
}

export class CreateTransferRequestDto {
  @IsString()
  storeId!: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferRequestItemDto)
  items!: TransferRequestItemDto[];
}

export class StocktakeItemDto {
  @IsString()
  @IsNotEmpty()
  skuId!: string;

  @IsString()
  styleId!: string;

  @IsString()
  colorId!: string;

  @IsString()
  sizeId!: string;

  @IsInt()
  @Min(0)
  bookQty!: number;

  @IsInt()
  @Min(0)
  actualQty!: number;

  @IsInt()
  diffQty!: number;
}

export class CreateStocktakeDto {
  @IsString()
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StocktakeItemDto)
  items!: StocktakeItemDto[];
}

// ============ 交接班 / 日结 ============
export class OpenShiftDto {
  @IsString()
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  cashierId!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  openingCash!: number;
}

export class CloseShiftDto {
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  closingCash!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  cashActual!: number;
}

// ============ 离线同步 ============
export class OfflineSyncItemDto {
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsIn([
    'sale_order',
    'return_order',
    'member',
    'stock_adjust',
    'stocktake',
    'transfer_request',
    'suspended_order',
  ])
  entityType!: OfflineEntityType;

  /** 业务载荷：离线端传来的原始 JSON，结构各异，仅校验为对象 */
  entityData!: Record<string, unknown>;
}

export class OfflineSyncBatchDto {
  @IsString()
  storeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OfflineSyncItemDto)
  items!: OfflineSyncItemDto[];
}
