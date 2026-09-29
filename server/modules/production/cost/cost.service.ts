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

    // 批量查物料标准价
    const materialIds = bomItemRows.map((item) => item.materialId);
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

    for (const item of bomItemRows) {
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
