import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** 入库/单据明细项（扫码件级数据） */
export class UcItemDto {
  @IsString()
  styleNo: string;

  @IsString()
  color: string;

  @IsString()
  size: string;

  @IsOptional()
  @IsString()
  uniqueCode?: string;

  @IsOptional()
  @IsString()
  skuId?: string;
}

/** POST /unique-code/register-inbound 采购/调拨/退货入库登记 */
export class RegisterInboundDto {
  @IsString()
  docType: string;

  @IsString()
  docId: string;

  @IsString()
  warehouseId: string;

  @IsOptional()
  @IsString()
  operatorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UcItemDto)
  items: UcItemDto[];
}

/** POST /unique-code/scan-outbound 出库扫码校验（三拒绝 + 去重） */
export class ScanOutboundDto {
  @IsString()
  docType: string;

  @IsString()
  docId: string;

  @IsString()
  warehouseId: string;

  @IsString()
  styleNo: string;

  @IsString()
  color: string;

  @IsString()
  size: string;

  @IsString()
  uniqueCode: string;

  @IsOptional()
  @IsString()
  docItemId?: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}

/** POST /unique-code/verify-sold 结算核销（out → sold） */
export class VerifySoldDto {
  @IsString()
  docType: string;

  @IsString()
  docId: string;

  @IsString()
  uniqueCode: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}

/** POST /unique-code/return 退货回滚（out/sold → in_stock） */
export class ReturnUniqueCodeDto {
  @IsString()
  docType: string;

  @IsString()
  docId: string;

  @IsString()
  warehouseId: string;

  @IsString()
  uniqueCode: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}

/** POST /unique-code/scan-document 单据扫码统一入口 */
export class ScanDocumentDto {
  @IsIn(['inbound', 'outbound', 'return', 'sold'])
  direction: 'inbound' | 'outbound' | 'return' | 'sold';

  @IsString()
  docType: string;

  @IsString()
  docId: string;

  @IsString()
  warehouseId: string;

  @IsOptional()
  @IsString()
  docItemId?: string;

  @IsOptional()
  @IsString()
  operatorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UcItemDto)
  items: UcItemDto[];
}

/** POST /unique-code/scan-transfer 调拨扫码（源仓出 + 目标仓入） */
export class ScanTransferItemDto {
  @IsString()
  styleNo: string;

  @IsString()
  color: string;

  @IsString()
  size: string;

  @IsString()
  uniqueCode: string;
}

export class ScanTransferDto {
  @IsString()
  docId: string;

  @IsString()
  fromWarehouseId: string;

  @IsString()
  toWarehouseId: string;

  @IsOptional()
  @IsString()
  operatorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScanTransferItemDto)
  items: ScanTransferItemDto[];
}

/** POST /unique-code/stocktake 盘点扫码对账 */
export class StocktakeDto {
  @IsString()
  docId: string;

  @IsString()
  warehouseId: string;

  @IsArray()
  @IsString({ each: true })
  scannedCodes: string[];

  @IsOptional()
  @IsString()
  styleNo?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;
}

/** POST /unique-code/parse 吊牌码解析 */
export class ParseTagDto {
  @IsString()
  raw: string;

  @IsOptional()
  @IsString()
  separator?: string;

  @IsOptional()
  @IsBoolean()
  validateChecksum?: boolean;
}
