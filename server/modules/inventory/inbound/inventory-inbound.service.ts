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
import { eq, and, count, desc, sql } from 'drizzle-orm';
import {
  inventoryFlow,
  sku,
  material,
  warehouse,
} from '@server/database/schema';
import type { InventoryFlow, PaginationResult } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { StockService } from '../stock/stock.service';
import { NumberGeneratorService } from '../..//system/code-rule/number-generator.service';

interface InboundItemDto {
  skuId?: string;
  materialId?: string;
  quantity: number;
  batchNo?: string;
}

interface CreateInboundDto {
  warehouseId: string;
  inboundDate: string;
  itemType: 'sku' | 'material';
  remark?: string;
  items: InboundItemDto[];
}

@Injectable()
export class InventoryInboundService {
  private readonly logger = new Logger(InventoryInboundService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  async getInboundList(params: {
    page: number;
    pageSize: number;
    status?: string;
  }): Promise<PaginationResult<InventoryFlow>> {
    const { page, pageSize } = params;

    const conditions = [eq(inventoryFlow.flowType, 'production_inbound')];
    // 行级数据权限：仅可见当前用户所属经销商的仓库完工入库流水，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: inventoryFlow.warehouseId },
    );
    if (scopeCond) conditions.push(scopeCond);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventoryFlow)
        .where(whereClause),
      this.db
        .select()
        .from(inventoryFlow)
        .where(whereClause)
        .orderBy(desc(inventoryFlow.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: InventoryFlow[] = rows.map((row) => ({
      id: row.id,
      flowType: row.flowType,
      bizNo: row.bizNo,
      direction: row.direction,
      itemType: row.itemType,
      skuId: row.skuId ?? undefined,
      materialId: row.materialId ?? undefined,
      styleNo: row.styleNo ?? undefined,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      materialCode: row.materialCode ?? undefined,
      materialName: row.materialName ?? undefined,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      quantity: Number(row.quantity),
      batchNo: row.batchNo ?? undefined,
      unitPrice: row.unitPrice ? Number(row.unitPrice) : undefined,
      operator: row.operator ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async createProductionInbound(
    dto: CreateInboundDto,
    userId: string,
  ): Promise<{ success: boolean }> {
    const { warehouseId, inboundDate, itemType, remark, items } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('入库明细不能为空');
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
        throw new BadRequestException('成品入库必须指定skuId');
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
        throw new BadRequestException('面辅料入库必须指定materialId');
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
      const no = await this.generateInboundNo(tx, inboundDate);

      const stockChanges = items
        .map((item) => {
          if (itemType === 'sku' && item.skuId) {
            return {
              warehouseId,
              warehouseName: warehouseRow.name,
              skuId: item.skuId,
              itemType: 'sku' as const,
              qtyDelta: item.quantity,
              flowType: 'production_inbound',
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
              qtyDelta: item.quantity,
              flowType: 'production_inbound',
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
      `生产完工入库成功: bizNo=${bizNo}, warehouseId=${warehouseId}, itemType=${itemType}, itemCount=${items.length}, operator=${userId}`,
    );

    return { success: true };
  }

  private async generateInboundNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '').slice(0, 8);
    const prefix = `PI${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      inventoryFlow,
      inventoryFlow.bizNo,
      prefix,
      4,
    );
  }
}
