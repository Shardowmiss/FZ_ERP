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
import { eq, and, count, desc, sql, inArray } from 'drizzle-orm';
import {
  inventoryTransfer,
  inventoryTransferItem,
  inventoryStock,
  inventoryFlow,
  sku,
  material,
  warehouse,
  store,
} from '@server/database/schema';
import { StockService } from '@server/modules/inventory/stock/stock.service';
import { bulkUpsert } from '@server/common/batch';
import type {
  InventoryTransfer,
  InventoryTransferItem,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../../finance/month-close/month-close.service';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';

interface TransferItemDto {
  skuId?: string;
  materialId?: string;
  itemCode: string;
  itemName: string;
  color?: string;
  size?: string;
  quantity: number;
}

interface CreateTransferDto {
  fromWarehouseId?: string;
  toWarehouseId?: string;
  fromStoreId?: string;
  toStoreId?: string;
  transferDate: string;
  itemType: 'sku' | 'material';
  remark?: string;
  items: TransferItemDto[];
}

@Injectable()
export class InventoryTransferService {
  private readonly logger = new Logger(InventoryTransferService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  /**
   * 写操作越权防护：构造“按 id 查询调拨单”时应附加的经销商作用域条件。
   * 越权单据（非本经销商）将查不到 → 上层抛出 NotFound，等同不可见（IDOR 写面防护，零侵入）。
   */
  private transferScopeCond() {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    return buildDealerScopeCondition(scope, {
      kind: 'viaWarehouseEither',
      from: inventoryTransfer.fromWarehouseId,
      to: inventoryTransfer.toWarehouseId,
    });
  }

  async getTransferList(params: {
    page: number;
    pageSize: number;
    status?: string;
    fromWarehouseId?: string;
    toWarehouseId?: string;
  }): Promise<PaginationResult<InventoryTransfer>> {
    const { page, pageSize, status, fromWarehouseId, toWarehouseId } = params;

    const conditions = [];
    if (status) conditions.push(eq(inventoryTransfer.status, status));
    if (fromWarehouseId)
      conditions.push(eq(inventoryTransfer.fromWarehouseId, fromWarehouseId));
    if (toWarehouseId)
      conditions.push(eq(inventoryTransfer.toWarehouseId, toWarehouseId));
    // 行级数据权限：调拨单的任一端仓库归属当前用户可见经销商即可见，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      {
        kind: 'viaWarehouseEither',
        from: inventoryTransfer.fromWarehouseId,
        to: inventoryTransfer.toWarehouseId,
      },
    );
    if (scopeCond) conditions.push(scopeCond);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventoryTransfer)
        .where(whereClause),
      this.db
        .select()
        .from(inventoryTransfer)
        .where(whereClause)
        .orderBy(desc(inventoryTransfer.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: InventoryTransfer[] = rows.map((row) => ({
      id: row.id,
      transferNo: row.transferNo,
      fromWarehouseId: row.fromWarehouseId,
      fromWarehouseName: row.fromWarehouseName,
      toWarehouseId: row.toWarehouseId,
      toWarehouseName: row.toWarehouseName,
      fromStoreId: (row as Record<string, unknown>).fromStoreId as
        | string
        | undefined,
      fromStoreName: (row as Record<string, unknown>).fromStoreName as
        | string
        | undefined,
      toStoreId: (row as Record<string, unknown>).toStoreId as
        | string
        | undefined,
      toStoreName: (row as Record<string, unknown>).toStoreName as
        | string
        | undefined,
      transferDate: row.transferDate,
      itemType: row.itemType,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async getTransferDetail(id: string): Promise<InventoryTransfer> {
    // 行级数据权限：直查详情也须落在当前用户可见经销商范围内，否则视为不存在
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      {
        kind: 'viaWarehouseEither',
        from: inventoryTransfer.fromWarehouseId,
        to: inventoryTransfer.toWarehouseId,
      },
    );
    const where = scopeCond
      ? and(eq(inventoryTransfer.id, id), scopeCond)
      : eq(inventoryTransfer.id, id);
    const [transferRow] = await this.db
      .select()
      .from(inventoryTransfer)
      .where(where);
    if (!transferRow) {
      throw new NotFoundException('调拨单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(inventoryTransferItem)
      .where(eq(inventoryTransferItem.transferId, id))
      .orderBy(inventoryTransferItem.id);

    const items: InventoryTransferItem[] = itemRows.map((row) => ({
      id: row.id,
      transferId: row.transferId,
      skuId: row.skuId ?? undefined,
      materialId: row.materialId ?? undefined,
      itemCode: row.itemCode,
      itemName: row.itemName,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      quantity: Number(row.quantity),
    }));

    return {
      id: transferRow.id,
      transferNo: transferRow.transferNo,
      fromWarehouseId: transferRow.fromWarehouseId,
      fromWarehouseName: transferRow.fromWarehouseName,
      toWarehouseId: transferRow.toWarehouseId,
      toWarehouseName: transferRow.toWarehouseName,
      fromStoreId: (transferRow as Record<string, unknown>).fromStoreId as
        | string
        | undefined,
      fromStoreName: (transferRow as Record<string, unknown>).fromStoreName as
        | string
        | undefined,
      toStoreId: (transferRow as Record<string, unknown>).toStoreId as
        | string
        | undefined,
      toStoreName: (transferRow as Record<string, unknown>).toStoreName as
        | string
        | undefined,
      transferDate: transferRow.transferDate,
      itemType: transferRow.itemType,
      status: transferRow.status,
      remark: transferRow.remark ?? undefined,
      createdAt: transferRow.createdAt.toISOString(),
      items,
    };
  }

  async createTransfer(
    dto: CreateTransferDto,
    userId: string,
  ): Promise<InventoryTransfer> {
    const {
      fromWarehouseId: dtoFromWarehouseId,
      toWarehouseId: dtoToWarehouseId,
      fromStoreId,
      toStoreId,
      transferDate,
      itemType,
      remark,
      items,
    } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('调拨明细不能为空');
    }

    // 解析调出方：门店优先，否则仓库
    let fromWarehouseId: string;
    let fromWarehouseName: string;
    let fromStoreName: string | undefined;
    let fromStoreType: string | undefined;
    let fromDealerId: string | null | undefined;
    let fromWarehouseType: string | undefined;

    if (fromStoreId) {
      const [fromStoreRow] = await this.db
        .select()
        .from(store)
        .where(eq(store.id, fromStoreId));
      if (!fromStoreRow) {
        throw new NotFoundException('调出门店不存在');
      }
      if (!fromStoreRow.warehouseId) {
        throw new BadRequestException('调出门店未关联仓库');
      }
      const [fromWh] = await this.db
        .select()
        .from(warehouse)
        .where(eq(warehouse.id, fromStoreRow.warehouseId));
      if (!fromWh) {
        throw new NotFoundException('调出门店关联仓库不存在');
      }
      fromWarehouseId = fromWh.id;
      fromWarehouseName = fromWh.name;
      fromWarehouseType = fromWh.type;
      fromStoreName = fromStoreRow.name;
      fromStoreType = fromStoreRow.storeType;
      fromDealerId = fromStoreRow.dealerId;
    } else if (dtoFromWarehouseId) {
      const [fromWh] = await this.db
        .select()
        .from(warehouse)
        .where(eq(warehouse.id, dtoFromWarehouseId));
      if (!fromWh) throw new NotFoundException('调出仓库不存在');
      fromWarehouseId = fromWh.id;
      fromWarehouseName = fromWh.name;
      fromWarehouseType = fromWh.type;
    } else {
      throw new BadRequestException('请指定调出仓库或门店');
    }

    // 解析调入方
    let toWarehouseId: string;
    let toWarehouseName: string;
    let toStoreName: string | undefined;
    let toStoreType: string | undefined;
    let toDealerId: string | null | undefined;
    let toWarehouseType: string | undefined;

    if (toStoreId) {
      const [toStoreRow] = await this.db
        .select()
        .from(store)
        .where(eq(store.id, toStoreId));
      if (!toStoreRow) {
        throw new NotFoundException('调入门店不存在');
      }
      if (!toStoreRow.warehouseId) {
        throw new BadRequestException('调入门店未关联仓库');
      }
      const [toWh] = await this.db
        .select()
        .from(warehouse)
        .where(eq(warehouse.id, toStoreRow.warehouseId));
      if (!toWh) {
        throw new NotFoundException('调入门店关联仓库不存在');
      }
      toWarehouseId = toWh.id;
      toWarehouseName = toWh.name;
      toWarehouseType = toWh.type;
      toStoreName = toStoreRow.name;
      toStoreType = toStoreRow.storeType;
      toDealerId = toStoreRow.dealerId;
    } else if (dtoToWarehouseId) {
      const [toWh] = await this.db
        .select()
        .from(warehouse)
        .where(eq(warehouse.id, dtoToWarehouseId));
      if (!toWh) throw new NotFoundException('调入仓库不存在');
      toWarehouseId = toWh.id;
      toWarehouseName = toWh.name;
      toWarehouseType = toWh.type;
    } else {
      throw new BadRequestException('请指定调入仓库或门店');
    }

    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('调出方和调入方不能相同');
    }

    // 归属校验
    this.validateTransferOwnership({
      isStore: !!fromStoreId,
      storeType: fromStoreType,
      dealerId: fromDealerId,
      warehouseType: fromWarehouseType,
    }, {
      isStore: !!toStoreId,
      storeType: toStoreType,
      dealerId: toDealerId,
      warehouseType: toWarehouseType,
    });

    // 生成单号（在事务内，FOR UPDATE 锁行保证并发安全）
    const result = await this.db.transaction(async (tx) => {
      const transferNo = await this.generateTransferNo(tx, transferDate);

      const [transferRow] = await tx
        .insert(inventoryTransfer)
        .values({
          transferNo,
          fromWarehouseId,
          fromWarehouseName,
          toWarehouseId,
          toWarehouseName,
          transferDate,
          itemType,
          status: 'draft',
          remark,
        })
        .returning();

      // 写入 store 字段（schema 中可能无此字段，用 raw SQL）
      if (fromStoreId || toStoreId) {
        await tx.execute(sql`
          UPDATE inventory_transfer
          SET
            from_store_id = ${fromStoreId ?? null}::uuid,
            from_store_name = ${fromStoreName ?? null},
            to_store_id = ${toStoreId ?? null}::uuid,
            to_store_name = ${toStoreName ?? null}
          WHERE id = ${transferRow.id}::uuid
        `);
      }

      const itemValues = items.map((item) => ({
        transferId: transferRow.id,
        skuId: item.skuId,
        materialId: item.materialId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        color: item.color,
        size: item.size,
        quantity: String(item.quantity),
      }));

      await tx.insert(inventoryTransferItem).values(itemValues);

      return transferRow;
    });

    this.logger.log(
      `创建调拨单成功: id=${result.id}, transferNo=${result.transferNo}, operator=${userId}`,
    );

    return this.getTransferDetail(result.id);
  }

  async approveTransfer(id: string, userId: string): Promise<InventoryTransfer> {
    const scopeCond = this.transferScopeCond();
    const [transferRow] = await this.db
      .select()
      .from(inventoryTransfer)
      .where(scopeCond ? and(eq(inventoryTransfer.id, id), scopeCond) : eq(inventoryTransfer.id, id));
    if (!transferRow) {
      throw new NotFoundException('调拨单不存在');
    }
    if (transferRow.status !== 'draft') {
      throw new BadRequestException('仅draft状态的调拨单才能审核');
    }

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(transferRow.transferDate);

    const itemRows = await this.db
      .select()
      .from(inventoryTransferItem)
      .where(eq(inventoryTransferItem.transferId, id));

    if (itemRows.length === 0) {
      throw new BadRequestException('调拨单无明细');
    }

    await this.db.transaction(async (tx) => {
      if (transferRow.itemType === 'sku') {
        const skuItems = itemRows.filter((item) => item.skuId) as (typeof itemRows[number] & { skuId: string })[];
        const skuIds = skuItems.map((item) => item.skuId);

        // 批量查 SKU 信息
        const skuRows = await tx
          .select({ id: sku.id, skuCode: sku.skuCode, styleNo: sku.styleNo, color: sku.color, size: sku.size })
          .from(sku)
          .where(inArray(sku.id, skuIds));
        const skuMap = new Map<string, typeof skuRows[number]>();
        for (const s of skuRows) {
          skuMap.set(s.id, s);
        }

        // 构造调出仓库扣减 + 调入仓库在途增加的库存变动
        const stockChanges: import('@server/modules/inventory/stock/stock.service').StockChangeItem[] = [];
        const inTransitInserts: typeof inventoryStock.$inferInsert[] = [];
        const inTransitFlows: typeof inventoryFlow.$inferInsert[] = [];

        for (const item of skuItems) {
          const qty = Number(item.quantity);
          const skuInfo = skuMap.get(item.skuId);
          if (!skuInfo) {
            throw new BadRequestException(`SKU不存在: ${item.skuId}`);
          }

          // 调出仓库扣减（交给 StockService 统一处理流水）
          stockChanges.push({
            warehouseId: transferRow.fromWarehouseId,
            warehouseName: transferRow.fromWarehouseName,
            skuId: item.skuId,
            itemType: 'sku',
            qtyDelta: -qty,
            flowType: 'transfer_out',
            bizNo: transferRow.transferNo,
            remark: transferRow.remark ?? undefined,
            skuCode: skuInfo.skuCode,
            styleNo: skuInfo.styleNo,
            color: skuInfo.color,
            size: skuInfo.size,
          });

          // 调入仓库在途增加：用 upsert 插入/累加 inTransitQty
          inTransitInserts.push({
            skuId: item.skuId,
            skuCode: skuInfo.skuCode,
            styleNo: skuInfo.styleNo,
            color: skuInfo.color,
            size: skuInfo.size,
            warehouseId: transferRow.toWarehouseId,
            warehouseName: transferRow.toWarehouseName,
            quantity: '0',
            inTransitQty: String(qty),
          });

          // 在途调入流水
          inTransitFlows.push({
            flowType: 'transfer_in_transit',
            bizNo: transferRow.transferNo,
            direction: 'in',
            itemType: 'sku',
            skuId: item.skuId,
            materialId: null,
            styleNo: skuInfo.styleNo,
            color: skuInfo.color,
            size: skuInfo.size,
            materialCode: null,
            materialName: null,
            warehouseId: transferRow.toWarehouseId,
            warehouseName: transferRow.toWarehouseName,
            quantity: String(qty),
            remark: transferRow.remark ?? null,
          });
        }

        // 1. 调出仓库扣减 + 调出流水
        await this.stockService.batchChangeStock(tx, stockChanges);

        // 2. 调入仓库在途增加（批量多值 upsert；同 sku+仓库多次在途按键合并累加，避免 ON CONFLICT 同键冲突）
        if (inTransitInserts.length > 0) {
          const inTransitMap = new Map<string, (typeof inventoryStock.$inferInsert)>();
          for (const ins of inTransitInserts) {
            const key = `${ins.skuId}|${ins.warehouseId}`;
            const prev = inTransitMap.get(key);
            if (prev) {
              prev.inTransitQty = String(Number(prev.inTransitQty) + Number(ins.inTransitQty));
            } else {
              inTransitMap.set(key, { ...ins });
            }
          }
          await bulkUpsert(
            tx,
            inventoryStock,
            [...inTransitMap.values()],
            [inventoryStock.skuId, inventoryStock.warehouseId],
            {
              inTransitQty: sql`${inventoryStock.inTransitQty} + EXCLUDED.in_transit_qty`,
            },
          );
        }

        // 3. 在途调入流水（批量插入）
        if (inTransitFlows.length > 0) {
          await tx.insert(inventoryFlow).values(inTransitFlows);
        }
      } else if (transferRow.itemType === 'material') {
        const matItems = itemRows.filter((item) => item.materialId) as (typeof itemRows[number] & { materialId: string })[];
        const matIds = matItems.map((item) => item.materialId);

        // 批量查物料信息
        const matRows = await tx
          .select({ id: material.id, materialCode: material.code, materialName: material.name })
          .from(material)
          .where(inArray(material.id, matIds));
        const matMap = new Map<string, typeof matRows[number]>();
        for (const m of matRows) {
          matMap.set(m.id, m);
        }

        const stockChanges: import('@server/modules/inventory/stock/stock.service').StockChangeItem[] = [];

        for (const item of matItems) {
          const qty = Number(item.quantity);
          const matInfo = matMap.get(item.materialId);
          if (!matInfo) {
            throw new BadRequestException(`物料不存在: ${item.materialId}`);
          }

          // 调出仓库扣减
          stockChanges.push({
            warehouseId: transferRow.fromWarehouseId,
            warehouseName: transferRow.fromWarehouseName,
            materialId: item.materialId,
            itemType: 'material',
            qtyDelta: -qty,
            flowType: 'transfer_out',
            bizNo: transferRow.transferNo,
            remark: transferRow.remark ?? undefined,
            materialCode: matInfo.materialCode,
            materialName: matInfo.materialName,
          });

          // 调入仓库增加
          stockChanges.push({
            warehouseId: transferRow.toWarehouseId,
            warehouseName: transferRow.toWarehouseName,
            materialId: item.materialId,
            itemType: 'material',
            qtyDelta: qty,
            flowType: 'transfer_in',
            bizNo: transferRow.transferNo,
            remark: transferRow.remark ?? undefined,
            materialCode: matInfo.materialCode,
            materialName: matInfo.materialName,
          });
        }

        // 物料调拨：调出扣减 + 调入增加（统一走 batchChangeStock）
        await this.stockService.batchChangeStock(tx, stockChanges);
      }

      // 更新状态为在途
      await tx
        .update(inventoryTransfer)
        .set({ status: 'in_transit' })
        .where(eq(inventoryTransfer.id, id));
    });

    this.logger.log(
      `审核调拨单成功: id=${id}, transferNo=${transferRow.transferNo}, operator=${userId}`,
    );

    return this.getTransferDetail(id);
  }

  async receiveTransfer(
    id: string,
    userId: string,
  ): Promise<InventoryTransfer> {
    const scopeCond = this.transferScopeCond();
    const [transferRow] = await this.db
      .select()
      .from(inventoryTransfer)
      .where(scopeCond ? and(eq(inventoryTransfer.id, id), scopeCond) : eq(inventoryTransfer.id, id));
    if (!transferRow) {
      throw new NotFoundException('调拨单不存在');
    }
    if (
      transferRow.status !== 'in_transit' &&
      transferRow.status !== 'approved'
    ) {
      throw new BadRequestException('仅在途状态的调拨单才能签收');
    }

    const itemRows = await this.db
      .select()
      .from(inventoryTransferItem)
      .where(eq(inventoryTransferItem.transferId, id));

    if (itemRows.length === 0) {
      throw new BadRequestException('调拨单无明细');
    }

    await this.db.transaction(async (tx) => {
      if (transferRow.itemType === 'sku') {
        const skuItems = itemRows.filter((item) => item.skuId) as (typeof itemRows[number] & { skuId: string })[];
        const skuIds = skuItems.map((item) => item.skuId);

        // 批量查 SKU 信息
        const skuRows = await tx
          .select({ id: sku.id, skuCode: sku.skuCode, styleNo: sku.styleNo, color: sku.color, size: sku.size })
          .from(sku)
          .where(inArray(sku.id, skuIds));
        const skuMap = new Map<string, typeof skuRows[number]>();
        for (const s of skuRows) {
          skuMap.set(s.id, s);
        }

        // 批量查调入仓库在途库存
        const stockRows = await tx
          .select()
          .from(inventoryStock)
          .where(
            and(
              eq(inventoryStock.warehouseId, transferRow.toWarehouseId),
              inArray(inventoryStock.skuId, skuIds),
            ),
          );
        const stockMap = new Map<string, typeof inventoryStock.$inferSelect>();
        for (const st of stockRows) {
          stockMap.set(st.skuId, st);
        }

        const flowRecords: typeof inventoryFlow.$inferInsert[] = [];

        for (const item of skuItems) {
          const qty = Number(item.quantity);
          const skuInfo = skuMap.get(item.skuId);
          if (!skuInfo) {
            throw new BadRequestException(`SKU不存在: ${item.skuId}`);
          }

          const stock = stockMap.get(item.skuId);
          if (!stock) {
            throw new ConflictException(
              `SKU ${skuInfo.skuCode} 在调入仓库无在途库存记录`,
            );
          }

          const inTransitQty = Number(stock.inTransitQty);
          if (inTransitQty < qty) {
            throw new ConflictException(
              `SKU ${skuInfo.skuCode} 在途库存不足，当前在途: ${inTransitQty}, 需签收: ${qty}`,
            );
          }

          // 原子 UPDATE：在途减少，正式库存增加 + 在途数量校验
          const updated = await tx
            .update(inventoryStock)
            .set({
              quantity: sql`${inventoryStock.quantity} + ${String(qty)}::numeric`,
              inTransitQty: sql`${inventoryStock.inTransitQty} - ${String(qty)}::numeric`,
            })
            .where(
              and(
                eq(inventoryStock.id, stock.id),
                sql`${inventoryStock.inTransitQty} >= ${String(qty)}::numeric`,
              ),
            )
            .returning({ id: inventoryStock.id });

          if (updated.length === 0) {
            throw new ConflictException(
              `SKU ${skuInfo.skuCode} 在途库存不足`,
            );
          }

          flowRecords.push({
            flowType: 'transfer_in_complete',
            bizNo: transferRow.transferNo,
            direction: 'in',
            itemType: 'sku',
            skuId: item.skuId,
            materialId: null,
            styleNo: skuInfo.styleNo,
            color: skuInfo.color,
            size: skuInfo.size,
            materialCode: null,
            materialName: null,
            warehouseId: transferRow.toWarehouseId,
            warehouseName: transferRow.toWarehouseName,
            quantity: String(qty),
            remark: transferRow.remark ?? null,
          });
        }

        // 批量插入流水
        if (flowRecords.length > 0) {
          await tx.insert(inventoryFlow).values(flowRecords);
        }
      } else if (transferRow.itemType === 'material') {
        const matItems = itemRows.filter((item) => item.materialId) as (typeof itemRows[number] & { materialId: string })[];
        const matIds = matItems.map((item) => item.materialId);

        // 批量查物料信息
        const matRows = await tx
          .select({ id: material.id, materialCode: material.code, materialName: material.name })
          .from(material)
          .where(inArray(material.id, matIds));
        const matMap = new Map<string, typeof matRows[number]>();
        for (const m of matRows) {
          matMap.set(m.id, m);
        }

        const flowRecords: typeof inventoryFlow.$inferInsert[] = [];

        for (const item of matItems) {
          const qty = Number(item.quantity);
          const matInfo = matMap.get(item.materialId);
          if (!matInfo) {
            throw new BadRequestException(`物料不存在: ${item.materialId}`);
          }

          // 物料调拨：审核时已直接入库，签收仅记录流水，不操作库存
          flowRecords.push({
            flowType: 'transfer_in_complete',
            bizNo: transferRow.transferNo,
            direction: 'in',
            itemType: 'material',
            skuId: null,
            materialId: item.materialId,
            styleNo: null,
            color: null,
            size: null,
            materialCode: matInfo.materialCode,
            materialName: matInfo.materialName,
            warehouseId: transferRow.toWarehouseId,
            warehouseName: transferRow.toWarehouseName,
            quantity: String(qty),
            remark: transferRow.remark ?? null,
          });
        }

        if (flowRecords.length > 0) {
          await tx.insert(inventoryFlow).values(flowRecords);
        }
      }

      // 更新状态为已完成
      await tx
        .update(inventoryTransfer)
        .set({ status: 'completed' })
        .where(eq(inventoryTransfer.id, id));
    });

    this.logger.log(
      `签收调拨单成功: id=${id}, transferNo=${transferRow.transferNo}, operator=${userId}`,
    );

    return this.getTransferDetail(id);
  }

  async acceptTransfer(
    id: string,
    userId: string,
  ): Promise<InventoryTransfer> {
    const scopeCond = this.transferScopeCond();
    const [transferRow] = await this.db
      .select()
      .from(inventoryTransfer)
      .where(scopeCond ? and(eq(inventoryTransfer.id, id), scopeCond) : eq(inventoryTransfer.id, id));
    if (!transferRow) {
      throw new NotFoundException('调拨单不存在');
    }
    if (transferRow.status !== 'completed') {
      throw new BadRequestException('仅已完成(已签收)状态的调拨单才能验收');
    }

    await this.db
      .update(inventoryTransfer)
      .set({ status: 'accepted' })
      .where(eq(inventoryTransfer.id, id));

    this.logger.log(
      `验收调拨单成功: id=${id}, transferNo=${transferRow.transferNo}, operator=${userId}`,
    );

    return this.getTransferDetail(id);
  }

  async voidTransfer(
    id: string,
    userId: string,
  ): Promise<InventoryTransfer> {
    const scopeCond = this.transferScopeCond();
    const [transferRow] = await this.db
      .select()
      .from(inventoryTransfer)
      .where(scopeCond ? and(eq(inventoryTransfer.id, id), scopeCond) : eq(inventoryTransfer.id, id));
    if (!transferRow) {
      throw new NotFoundException('调拨单不存在');
    }
    if (transferRow.status !== 'draft') {
      throw new BadRequestException('仅草稿状态的调拨单才能作废');
    }

    await this.db
      .update(inventoryTransfer)
      .set({ status: 'cancelled' })
      .where(eq(inventoryTransfer.id, id));

    this.logger.log(
      `作废调拨单成功: id=${id}, transferNo=${transferRow.transferNo}, operator=${userId}`,
    );

    return this.getTransferDetail(id);
  }

  async deleteTransfer(id: string, userId: string): Promise<{ success: boolean }> {
    const scopeCond = this.transferScopeCond();
    const [transferRow] = await this.db
      .select()
      .from(inventoryTransfer)
      .where(scopeCond ? and(eq(inventoryTransfer.id, id), scopeCond) : eq(inventoryTransfer.id, id));
    if (!transferRow) {
      throw new NotFoundException('调拨单不存在');
    }
    if (transferRow.status !== 'draft') {
      throw new BadRequestException('仅draft状态的调拨单才能删除');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(inventoryTransferItem)
        .where(eq(inventoryTransferItem.transferId, id));
      await tx
        .delete(inventoryTransfer)
        .where(eq(inventoryTransfer.id, id));
    });

    this.logger.log(
      `删除调拨单成功: id=${id}, transferNo=${transferRow.transferNo}, operator=${userId}`,
    );

    return { success: true };
  }

  private validateTransferOwnership(
    from: {
      isStore: boolean;
      storeType?: string;
      dealerId?: string | null;
      warehouseType?: string;
    },
    to: {
      isStore: boolean;
      storeType?: string;
      dealerId?: string | null;
      warehouseType?: string;
    },
  ): void {
    // 总部成品仓作为调出方：可调入任何
    if (!from.isStore && from.warehouseType === 'finished') {
      return;
    }
    // 总部成品仓作为调入方：可从任何调入
    if (!to.isStore && to.warehouseType === 'finished') {
      return;
    }

    // 双方都是门店
    if (from.isStore && to.isStore) {
      if (from.storeType === 'dealer' && to.storeType === 'dealer') {
        if (from.dealerId !== to.dealerId) {
          throw new BadRequestException('跨经销商不允许调拨');
        }
        return;
      }
      if (from.storeType === 'direct' && to.storeType === 'direct') {
        return;
      }
      // 一直营一经销
      throw new BadRequestException(
        '直营店与经销商门店不能直接调拨，需通过总部仓库中转',
      );
    }

    // 一方门店一方非成品仓：不允许（非成品仓不能直接对接门店）
    // 纯仓库调拨：不做归属校验
  }

  private async generateTransferNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `TR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      inventoryTransfer,
      inventoryTransfer.transferNo,
      prefix,
      4,
    );
  }
}
