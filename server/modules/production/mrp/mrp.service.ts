import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import {
  bom,
  bomItem,
  style,
  material,
  materialStock,
  purchaseOrder,
  purchaseOrderItem,
  productionMaterialIssue,
  productionMaterialIssueItem,
} from '@server/database/schema';
import type { MrpResult, MrpResultItem, MrpWarehouseBreakdown } from '@shared/api.interface';
import { PurchaseOrderStatus } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';


interface MrpCalculateDto {
  styleId: string;
  quantity: number;
  bomVersion?: string;
  /** 安全库存比例（占毛需求的百分比，0~1）。未传时回退到物料主数据的默认值 */
  safetyStockPct?: number;
  /** 最小订货量 MOQ。未传时回退到物料主数据的默认值 */
  moq?: number;
  /** 指定仓库：按该仓库的"在库 + 已发料占用"做逐仓净需求测算 */
  warehouseId?: string;
}

@Injectable()
export class MrpService {
  private readonly logger = new Logger(MrpService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async calculate(dto: MrpCalculateDto): Promise<MrpResult> {
    const { styleId, quantity, bomVersion } = dto;

    // 经销商作用域：受限账号只能基于“自己经销商范围内的仓库/供应商”做净需求测算，
    // 防止跨租户聚合（把别的经销商的库存/在途/占用算进自己的净需求）。
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    // 指定仓库：先校验该仓库归属当前调用方（超管放行；受限越权抛 403）
    let scopedWarehouseId: string | undefined;
    if (dto.warehouseId) {
      await assertWriteWithinScope(this.db, { warehouseId: dto.warehouseId });
      scopedWarehouseId = dto.warehouseId;
    }

    if (!styleId) {
      throw new BadRequestException('款号ID不能为空');
    }
    const qty: number = Number(quantity);
    if (!qty || qty <= 0) {
      throw new BadRequestException('生产数量必须为正数');
    }

    // 查款号信息
    const [styleRow] = await this.db
      .select()
      .from(style)
      .where(eq(style.id, styleId));
    if (!styleRow) {
      throw new NotFoundException('款号不存在');
    }

    // 查找BOM
    let bomRow: typeof bom.$inferSelect | undefined;
    if (bomVersion) {
      const [row] = await this.db
        .select()
        .from(bom)
        .where(and(eq(bom.styleId, styleId), eq(bom.version, bomVersion)))
        .limit(1);
      bomRow = row;
    } else {
      // 优先 active 版本，按创建时间倒序取最新
      const rows = await this.db
        .select()
        .from(bom)
        .where(eq(bom.styleId, styleId))
        .orderBy(desc(bom.createdAt))
        .limit(1);
      bomRow = rows[0];
    }

    if (!bomRow) {
      throw new NotFoundException('未找到对应BOM');
    }

    // 查BOM明细
    const bomItemRows = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, bomRow.id))
      .orderBy(bomItem.id);

    if (bomItemRows.length === 0) {
      throw new BadRequestException('BOM明细为空，无法计算物料需求');
    }

    // 收集物料ID，批量查库存、在途采购、生产占用
    const materialIds = bomItemRows.map((item) => item.materialId);

    // 物料主数据默认值（安全库存比例 / MOQ）：DTO 未传时回退
    const matRows = await this.db
      .select({
        id: material.id,
        safetyStockPct: material.safetyStockPct,
        moq: material.moq,
      })
      .from(material)
      .where(inArray(material.id, materialIds));
    const matMap = new Map<string, { safetyStockPct: number; moq: number }>();
    for (const r of matRows) {
      matMap.set(r.id, {
        safetyStockPct: r.safetyStockPct == null ? 0 : Number(r.safetyStockPct),
        moq: r.moq == null ? 0 : Number(r.moq),
      });
    }

    // ① 现有库存：指定仓库时仅取该仓（已校验归属）；未指定仓库时受经销商作用域约束
    //    （仅统计 scope 内仓库），防止受限账号跨租户汇总。同时产出分仓在库分布。
    const stockWhere = [inArray(materialStock.materialId, materialIds)];
    if (scopedWarehouseId) {
      stockWhere.push(eq(materialStock.warehouseId, scopedWarehouseId));
    } else {
      const stockScope = buildDealerScopeCondition(scope, {
        kind: 'viaWarehouse',
        column: materialStock.warehouseId,
      });
      if (stockScope) stockWhere.push(stockScope);
    }
    const stockRows = await this.db
      .select({
        materialId: materialStock.materialId,
        warehouseId: materialStock.warehouseId,
        warehouseName: materialStock.warehouseName,
        totalQty: sql<string>`sum(${materialStock.quantity})`,
      })
      .from(materialStock)
      .where(and(...stockWhere))
      .groupBy(materialStock.materialId, materialStock.warehouseId, materialStock.warehouseName);

    const stockMap = new Map<string, number>();
    const breakdown = new Map<string, { warehouseName: string; items: Map<string, number> }>();
    for (const row of stockRows) {
      const qty = Number(row.totalQty);
      stockMap.set(row.materialId, (stockMap.get(row.materialId) ?? 0) + qty);
      if (!dto.warehouseId) {
        if (!breakdown.has(row.warehouseId)) {
          breakdown.set(row.warehouseId, { warehouseName: row.warehouseName, items: new Map() });
        }
        const b = breakdown.get(row.warehouseId)!;
        b.items.set(row.materialId, (b.items.get(row.materialId) ?? 0) + qty);
      }
    }

    // ② 在途采购：已审核/记账/验收但未收齐的采购订单（draft/cancelled 不计入）。
    //    采购单无仓库维度，始终按经销商作用域的供应商过滤，确保受限账号只见自己经销商的供给。
    const poWhere = [
      inArray(purchaseOrderItem.materialId, materialIds),
      inArray(purchaseOrder.status, [
        PurchaseOrderStatus.AUDITED,
        PurchaseOrderStatus.BOOKED,
        PurchaseOrderStatus.ACCEPTED,
      ]),
    ];
    const poScope = buildDealerScopeCondition(scope, {
      kind: 'viaSupplier',
      column: purchaseOrder.supplierId,
    });
    if (poScope) poWhere.push(poScope);
    const poRows = await this.db
      .select({
        materialId: purchaseOrderItem.materialId,
        inTransit: sql<string>`sum(greatest(0, ${purchaseOrderItem.quantity} - ${purchaseOrderItem.receivedQty}))`,
      })
      .from(purchaseOrderItem)
      .innerJoin(purchaseOrder, eq(purchaseOrderItem.orderId, purchaseOrder.id))
      .where(and(...poWhere))
      .groupBy(purchaseOrderItem.materialId);

    // ③ 生产占用：已发料（approved）到生产工单的物料，视为已承诺、不可用于本次 MRP。
    //    指定仓库时仅计该仓库发料（已校验归属）；未指定仓库时受经销商作用域约束（仅 scope 内仓库）。
    const moWhere = [
      inArray(productionMaterialIssueItem.materialId, materialIds),
      eq(productionMaterialIssue.status, 'approved'),
    ];
    if (scopedWarehouseId) {
      moWhere.push(eq(productionMaterialIssue.warehouseId, scopedWarehouseId));
    } else {
      const moScope = buildDealerScopeCondition(scope, {
        kind: 'viaWarehouse',
        column: productionMaterialIssue.warehouseId,
      });
      if (moScope) moWhere.push(moScope);
    }
    const moRows = await this.db
      .select({
        materialId: productionMaterialIssueItem.materialId,
        committed: sql<string>`sum(coalesce(nullif(${productionMaterialIssueItem.actualQty}, 0), ${productionMaterialIssueItem.planQty}))`,
      })
      .from(productionMaterialIssueItem)
      .innerJoin(
        productionMaterialIssue,
        eq(productionMaterialIssueItem.issueId, productionMaterialIssue.id),
      )
      .where(and(...moWhere))
      .groupBy(productionMaterialIssueItem.materialId);

    const poMap = new Map<string, number>();
    for (const row of poRows) {
      poMap.set(row.materialId, Number(row.inTransit));
    }
    const moMap = new Map<string, number>();
    for (const row of moRows) {
      moMap.set(row.materialId, Number(row.committed));
    }

    const items: MrpResultItem[] = bomItemRows.map((item) => {
      const usagePerPiece: number = Number(item.usagePerPiece);
      const lossRate: number = Number(item.lossRate);
      const grossDemand: number = usagePerPiece * qty * (1 + lossRate / 100);

      // 生效的安全库存比例：DTO 传入优先，否则回退到物料主数据默认值
      const effSafetyPct: number =
        dto.safetyStockPct != null && dto.safetyStockPct > 0
          ? dto.safetyStockPct
          : (matMap.get(item.materialId)?.safetyStockPct ?? 0);
      // 生效的 MOQ：DTO 传入优先，否则回退到物料主数据默认值
      const effMoq: number =
        dto.moq != null && dto.moq > 0
          ? dto.moq
          : (matMap.get(item.materialId)?.moq ?? 0);

      // 安全库存缓冲（占毛需求的百分比）
      const safetyStockQty: number = grossDemand * effSafetyPct;

      const onHand: number = stockMap.get(item.materialId) ?? 0;
      const inTransitPo: number = poMap.get(item.materialId) ?? 0;
      const inTransitMo: number = moMap.get(item.materialId) ?? 0;
      const available: number = onHand + inTransitPo + inTransitMo;

      // 标准 MRP 净需求：扣除在库 + 在途采购 + 生产占用后，仍需补足至安全库存线
      const netRaw: number = grossDemand + safetyStockQty - available;
      const netDemand: number = Math.max(0, netRaw);

      // 最小订货量（MOQ）向上取整：0 表示不取整
      let suggestedPurchaseQty: number = netDemand;
      if (effMoq > 0 && suggestedPurchaseQty > 0) {
        suggestedPurchaseQty = Math.ceil(suggestedPurchaseQty / effMoq) * effMoq;
      }

      return {
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        bomType: item.bomType,
        usagePerPiece,
        lossRate,
        grossDemand: Number(grossDemand.toFixed(3)),
        stockQty: onHand,
        inTransitPoQty: Number(inTransitPo.toFixed(3)),
        inTransitMoQty: Number(inTransitMo.toFixed(3)),
        safetyStockQty: Number(safetyStockQty.toFixed(3)),
        safetyStockPctUsed: Number(effSafetyPct.toFixed(6)),
        moq: Number(effMoq.toFixed(6)),
        netDemand: Number(netDemand.toFixed(3)),
        suggestedPurchaseQty: Number(suggestedPurchaseQty.toFixed(3)),
      };
    });

    // 分仓在库分布：仅在汇总测算（未指定仓库）时产出
    const warehouseBreakdown: MrpWarehouseBreakdown[] | undefined = dto.warehouseId
      ? undefined
      : Array.from(breakdown.entries()).map(([wid, { warehouseName, items: bItems }]) => ({
          warehouseId: wid,
          warehouseName,
          items: Array.from(bItems.entries()).map(([mid, onHand]) => ({
            materialId: mid,
            onHand: Number(onHand.toFixed(3)),
          })),
        }));

    const result: MrpResult = {
      styleId: styleRow.id,
      styleNo: styleRow.styleNo,
      styleName: styleRow.name,
      productionQty: qty,
      bomVersion: bomRow.version ?? 'V1',
      warehouseId: dto.warehouseId ?? null,
      items,
      warehouseBreakdown,
    };

    this.logger.log(
      `MRP计算完成: styleId=${styleId}, quantity=${qty}, bomVersion=${result.bomVersion}, items=${items.length}`,
    );

    return result;
  }
}
