import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { bom, bomItem, style, material } from '@server/database/schema';
import type { ProductionCostResult, ProductionCostItem } from '@shared/api.interface';
import { round2, round4 } from '../../../common/utils/money';



interface CostCalculateDto {
  styleId: string;
  quantity: number;
  bomVersion?: string;
}

@Injectable()
export class CostService {
  private readonly logger = new Logger(CostService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * 多级 BOM 递归展开（迁移 0049）：把层级树摊平为「物料 → 折算到每件成衣的累计用量」。
   *
   * 服装行业典型结构：成衣 ← 裁片件 ← 面料/里布。成本需逐级摊分到
   * 最底层实际采购物料，才能得到真实的单件料本。
   *
   * 单层 BOM（存量数据 parent_item_id 全 NULL）走快速路径原样返回，
   * 因此对既有数据零行为变更。
   */
  private expandBomItems(
    rows: (typeof bomItem.$inferSelect)[],
  ): (typeof bomItem.$inferSelect)[] {
    if (!rows.some((r) => r.parentItemId != null)) return rows;

    const expanded: (typeof bomItem.$inferSelect)[] = [];
    const MAX_DEPTH = 10;

    const walk = (parentId: string | null, multiplier: number, depth: number, path: Set<string>) => {
      if (depth > MAX_DEPTH) return;
      for (const r of rows) {
        if (r.parentItemId !== parentId) continue;
        if (path.has(r.id)) continue; // 环路兜底
        // 累计用量 = 各级用量连乘（折算到「每件成衣」）
        const effUsage = Number(r.usagePerPiece) * multiplier;
        expanded.push({
          ...r,
          usagePerPiece: String(effUsage),
        } as typeof bomItem.$inferSelect);
        walk(r.id, multiplier * Number(r.usagePerPiece), depth + 1, new Set(path).add(r.id));
      }
    };
    walk(null, 1, 1, new Set());

    return expanded;
  }

  async calculate(dto: CostCalculateDto): Promise<ProductionCostResult> {
    const { styleId, quantity, bomVersion } = dto;

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
      throw new BadRequestException('BOM明细为空，无法计算成本');
    }

    // 多级 BOM 递归展开（迁移 0049）：把层级树摊平为「物料 → 折算到每件成衣的累计用量」，
    // 从而支持「成衣 ← 裁片件 ← 面料」的逐级成本摊分。
    // 单层 BOM（存量数据）原样返回，行为与改造前完全一致。
    const expandedItems = this.expandBomItems(bomItemRows);

    // 批量查物料标准价
    const materialIds = expandedItems.map((item) => item.materialId);
    const materialRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const materialMap = new Map<string, typeof material.$inferSelect>();
    for (const m of materialRows) {
      materialMap.set(m.id, m);
    }

    const items: ProductionCostItem[] = [];
    let mainMaterialCost: number = 0;
    let auxiliaryMaterialCost: number = 0;
    let packagingCost: number = 0;

    for (const item of expandedItems) {
      const mat = materialMap.get(item.materialId);
      if (!mat) {
        continue;
      }
      const usagePerPiece: number = Number(item.usagePerPiece);
      const lossRate: number = Number(item.lossRate);
      const unitCost: number = Number(mat.stdPrice);
      const perPieceCost: number = usagePerPiece * (1 + lossRate / 100) * unitCost;
      const totalCost: number = perPieceCost * qty;

      items.push({
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        bomType: item.bomType,
        usagePerPiece,
        lossRate,
        unitCost,
        perPieceCost: Number(perPieceCost.toFixed(4)),
        totalCost: Number(totalCost.toFixed(2)),
      });

      // 按 bomType 分类汇总
      if (item.bomType === 'main') {
        mainMaterialCost += totalCost;
      } else if (item.bomType === 'auxiliary') {
        auxiliaryMaterialCost += totalCost;
      } else if (item.bomType === 'packaging') {
        packagingCost += totalCost;
      }
    }

    const totalMaterialCost: number =
      mainMaterialCost + auxiliaryMaterialCost + packagingCost;
    const perPieceCost: number = totalMaterialCost / qty;

    const result: ProductionCostResult = {
      styleId: styleRow.id,
      styleNo: styleRow.styleNo,
      styleName: styleRow.name,
      bomVersion: bomRow.version ?? 'V1',
      quantity: qty,
      mainMaterialCost: Number(mainMaterialCost.toFixed(2)),
      auxiliaryMaterialCost: Number(auxiliaryMaterialCost.toFixed(2)),
      packagingCost: Number(packagingCost.toFixed(2)),
      totalMaterialCost: Number(totalMaterialCost.toFixed(2)),
      perPieceCost: Number(perPieceCost.toFixed(2)),
      items,
    };

    this.logger.log(
      `生产成本核算完成: styleId=${styleId}, quantity=${qty}, bomVersion=${result.bomVersion}, totalMaterialCost=${result.totalMaterialCost}`,
    );

    return result;
  }

  async getByStyle(styleId: string): Promise<ProductionCostResult> {
    return this.calculate({ styleId, quantity: 1 });
  }
}
