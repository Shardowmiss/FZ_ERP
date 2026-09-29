import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
  inventoryStock,
  materialStock,
  inventoryFlow,
  sku,
  material,
  warehouse,
} from '@server/database/schema';
import { StockService } from '../stock/stock.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';

interface OutboundItemDto {
  skuId?: string;
  materialId?: string;
  quantity: number;
  batchNo?: string;
}

interface CreateOutboundDto {
  warehouseId: string;
  outboundDate: string;
  itemType: 'sku' | 'material';
  remark?: string;
  items: OutboundItemDto[];
}

@Injectable()
export class InventoryOutboundService {
  private readonly logger = new Logger(InventoryOutboundService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  async createProductionOutbound(
    dto: CreateOutboundDto,
    userId: string,
  ): Promise<{ success: boolean }> {
    const { warehouseId, outboundDate, itemType, remark, items } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('出库明细不能为空');
    }

    // 校验仓库
    const [warehouseRow] = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, warehouseId));
    if (!warehouseRow) {
      throw new NotFoundException('仓库不存在');
    }

    // 校验物料/SKU
    if (itemType === 'sku') {
      const skuIds = items
        .filter((item) => item.skuId)
        .map((item) => item.skuId as string);
      if (skuIds.length === 0) {
        throw new BadRequestException('成品出库必须指定skuId');
      }
      const skuRows = await this.db
        .select()
        .from(sku)
        .where(
          sql`${sku.id} = ANY(ARRAY[${sql.join(
            skuIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`,
        );
      if (skuRows.length !== skuIds.length) {
        throw new BadRequestException('部分SKU不存在');
      }
    } else {
      const materialIds = items
        .filter((item) => item.materialId)
        .map((item) => item.materialId as string);
      if (materialIds.length === 0) {
        throw new BadRequestException('面辅料出库必须指定materialId');
      }
      const matRows = await this.db
        .select()
        .from(material)
        .where(
          sql`${material.id} = ANY(ARRAY[${sql.join(
            materialIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`,
        );
      if (matRows.length !== materialIds.length) {
        throw new BadRequestException('部分面辅料不存在');
      }
    }

    const bizNo = await this.db.transaction(async (tx) => {
      const no = await this.generateOutboundNo(tx, outboundDate);

      const stockChanges = items
        .map((item) => {
          if (itemType === 'sku' && item.skuId) {
            return {
              warehouseId,
              warehouseName: warehouseRow.name,
              skuId: item.skuId,
              itemType: 'sku' as const,
              qtyDelta: -item.quantity,
              flowType: 'production_outbound',
              bizNo,
              batchNo: item.batchNo,
              remark,
            };
          } else if (itemType === 'material' && item.materialId) {
            return {
              warehouseId,
              warehouseName: warehouseRow.name,
              materialId: item.materialId,
              itemType: 'material' as const,
              qtyDelta: -item.quantity,
              flowType: 'production_outbound',
              bizNo,
              batchNo: item.batchNo,
              remark,
            };
          }
          return null;
        })
        .filter(
          (c): c is NonNullable<typeof c> => c !== null,
        );
      await this.stockService.batchChangeStock(tx, stockChanges);
      return no;
    });

    this.logger.log(
      `生产领料出库成功: bizNo=${bizNo}, warehouseId=${warehouseId}, itemType=${itemType}, itemCount=${items.length}, operator=${userId}`,
    );

    return { success: true };
  }

  private async generateOutboundNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '').slice(0, 8);
    const prefix = `PO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      inventoryFlow,
      inventoryFlow.bizNo,
      prefix,
      4,
    );
  }
}
