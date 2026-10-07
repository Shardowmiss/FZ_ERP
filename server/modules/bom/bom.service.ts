import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  eq,
  and,
  count,
  desc,
  ilike,
  inArray,
  sql,
} from 'drizzle-orm';
import { bom, bomItem, material, style } from '@server/database/schema';
import { escapeLike } from '@server/common/utils/escape-like';
import type {
  Bom,
  BomItem,
  CostSimulationResult,
  GrossRequirementResult,
  PaginationResult,
} from '@shared/api.interface';

interface CreateBomDto {
  styleId: string;
  version: string;
  remark?: string;
  items: {
    materialId: string;
    usagePerPiece: number;
    lossRate: number;
    bomType: string;
    remark?: string;
    /**
     * 多级 BOM（迁移 0049）：父级明细的临时引用号（父项自身的 tempRef）。
     * 明细行 id 在 INSERT 后才生成，故同批内建立父子关系需用 tempRef 互指，
     * 服务端会按 tempRef 二次回填 parent_item_id。
     * 不传 = 一级部件（直接挂成衣），与改造前行为一致。
     */
    parentRef?: string;
    /** 本行的临时引用号，供子项通过 parentRef 指向自己 */
    tempRef?: string;
  }[];
}

interface UpdateBomDto {
  version?: string;
  remark?: string;
  items?: {
    materialId: string;
    usagePerPiece: number;
    lossRate: number;
    bomType: string;
    remark?: string;
    parentRef?: string;
    tempRef?: string;
  }[];
}

@Injectable()
export class BomService {
  private readonly logger = new Logger(BomService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getBomList(params: {
    page: number;
    pageSize: number;
    styleId?: string;
    keyword?: string;
  }): Promise<PaginationResult<Bom>> {
    const { page, pageSize, styleId: styleIdParam, keyword } = params;
    const conditions = [];
    if (styleIdParam) conditions.push(eq(bom.styleId, styleIdParam));
    if (keyword) conditions.push(ilike(bom.styleNo, `%${escapeLike(keyword)}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(bom)
        .where(whereClause),
      this.db
        .select()
        .from(bom)
        .where(whereClause)
        .orderBy(desc(bom.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    const items: Bom[] = rows.map((row) => ({
      id: row.id,
      styleId: row.styleId,
      styleNo: row.styleNo,
      version: row.version ?? 'V1',
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async getBomDetail(id: string): Promise<Bom> {
    const [bomRow] = await this.db.select().from(bom).where(eq(bom.id, id));
    if (!bomRow) {
      throw new NotFoundException('BOM不存在');
    }

    const itemRows = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, id))
      .orderBy(bomItem.id);

    const items: BomItem[] = itemRows.map((row) => ({
      id: row.id,
      bomId: row.bomId,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      usagePerPiece: Number(row.usagePerPiece),
      lossRate: Number(row.lossRate),
      bomType: row.bomType,
      // 多级 BOM 层级（迁移 0049）：前端据此渲染层级树
      parentItemId: row.parentItemId ?? null,
      level: row.level,
      remark: row.remark ?? undefined,
    }));

    return {
      id: bomRow.id,
      styleId: bomRow.styleId,
      styleNo: bomRow.styleNo,
      version: bomRow.version ?? 'V1',
      remark: bomRow.remark ?? undefined,
      status: bomRow.status,
      createdAt: bomRow.createdAt.toISOString(),
      items,
    };
  }

  async getBomByStyle(styleId: string): Promise<Bom[]> {
    const rows = await this.db
      .select()
      .from(bom)
      .where(eq(bom.styleId, styleId))
      .orderBy(desc(bom.createdAt));

    return rows.map((row) => ({
      id: row.id,
      styleId: row.styleId,
      styleNo: row.styleNo,
      version: row.version ?? 'V1',
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async createBom(dto: CreateBomDto, userId: string): Promise<Bom> {
    const { styleId, version, remark, items } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('BOM明细不能为空');
    }

    // 校验同款号+版本是否重复
    const existing = await this.db
      .select()
      .from(bom)
      .where(and(eq(bom.styleId, styleId), eq(bom.version, version)))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException('该款号下已存在相同版本的BOM');
    }

    // 查款号信息
    const [styleRow] = await this.db
      .select({ styleNo: style.styleNo })
      .from(style)
      .where(eq(style.id, styleId));
    if (!styleRow) {
      throw new NotFoundException('款号不存在');
    }

    // 查物料信息
    const materialIds = items.map((item) => item.materialId);
    const materialRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const materialMap = new Map(
      materialRows.map((m) => [m.id, m]),
    );

    // 校验物料都存在
    for (const item of items) {
      if (!materialMap.has(item.materialId)) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
    }

    const result = await this.db.transaction(async (tx) => {
      const [bomRow] = await tx
        .insert(bom)
        .values({
          styleId,
          styleNo: styleRow.styleNo,
          version,
          remark,
          status: 'active',
        })
        .returning();

      const itemValues = items.map((item) => {
        const mat = materialMap.get(item.materialId)!;
        return {
          bomId: bomRow.id,
          materialId: item.materialId,
          materialCode: mat.code,
          materialName: mat.name,
          unit: mat.unit,
          usagePerPiece: String(item.usagePerPiece),
          lossRate: String(item.lossRate),
          bomType: item.bomType,
          remark: item.remark,
        };
      });

      // 多级 BOM（迁移 0049）：先插入全部明细（parent_item_id 暂空），
      // 再按 tempRef 回填父子关系。因明细 id 在 INSERT 后才生成，
      // 同批内父子互引无法在一次 values 里完成。
      const insertedRows = await tx
        .insert(bomItem)
        .values(itemValues)
        .returning({ id: bomItem.id, materialId: bomItem.materialId });

      // 建立 tempRef -> id 映射（同批内引用）
      const refToId = new Map<string, string>();
      dto.items.forEach((item, idx) => {
        if (item.tempRef && insertedRows[idx]) {
          refToId.set(item.tempRef, insertedRows[idx].id);
        }
      });

      // 回填 parent_item_id（仅当子项的 parentRef 能在同批找到对应行）
      for (let idx = 0; idx < dto.items.length; idx++) {
        const item = dto.items[idx];
        if (!item.parentRef) continue;
        const parentId = refToId.get(item.parentRef);
        const selfId = insertedRows[idx]?.id;
        if (parentId && selfId) {
          await tx
            .update(bomItem)
            .set({ parentItemId: parentId })
            .where(eq(bomItem.id, selfId));
        }
      }

      return bomRow;
    });

    this.logger.log(
      `创建BOM成功: id=${result.id}, styleId=${styleId}, version=${version}, operator=${userId}`,
    );

    return this.getBomDetail(result.id);
  }

  async updateBom(
    id: string,
    dto: UpdateBomDto,
    userId: string,
  ): Promise<Bom> {
    const { version, remark, items } = dto;

    const [existingBom] = await this.db
      .select()
      .from(bom)
      .where(eq(bom.id, id));
    if (!existingBom) {
      throw new NotFoundException('BOM不存在');
    }
    if (existingBom.status !== 'active') {
      throw new BadRequestException('仅active状态的BOM才能修改');
    }

    // 如果改版本，检查版本冲突
    if (version && version !== existingBom.version) {
      const conflict = await this.db
        .select()
        .from(bom)
        .where(
          and(
            eq(bom.styleId, existingBom.styleId),
            eq(bom.version, version),
          ),
        )
        .limit(1);
      if (conflict.length > 0) {
        throw new ConflictException('该款号下已存在相同版本的BOM');
      }
    }

    // 查物料信息（如果有明细更新）
    let materialMap: Map<string, typeof material.$inferSelect> = new Map();
    if (items && items.length > 0) {
      const materialIds = items.map((item) => item.materialId);
      const materialRows = await this.db
        .select()
        .from(material)
        .where(inArray(material.id, materialIds));
      materialMap = new Map(
        materialRows.map((m) => [m.id, m]),
      );
      for (const item of items) {
        if (!materialMap.has(item.materialId)) {
          throw new BadRequestException(`物料不存在: ${item.materialId}`);
        }
      }
    }

    await this.db.transaction(async (tx) => {
      const updateData: Partial<typeof bom.$inferInsert> = {};
      if (version !== undefined) updateData.version = version;
      if (remark !== undefined) updateData.remark = remark;

      if (Object.keys(updateData).length > 0) {
        await tx.update(bom).set(updateData).where(eq(bom.id, id));
      }

      if (items !== undefined) {
        // 删旧明细
        await tx.delete(bomItem).where(eq(bomItem.bomId, id));

        if (items.length > 0) {
          const itemValues = items.map((item) => {
            const mat = materialMap.get(item.materialId)!;
            return {
              bomId: id,
              materialId: item.materialId,
              materialCode: mat.code,
              materialName: mat.name,
              unit: mat.unit,
              usagePerPiece: String(item.usagePerPiece),
              lossRate: String(item.lossRate),
              bomType: item.bomType,
              remark: item.remark,
            };
          });
          // 多级 BOM（迁移 0049）：同 create 逻辑，插入后按 tempRef 回填父子关系
          const insertedRows = await tx
            .insert(bomItem)
            .values(itemValues)
            .returning({ id: bomItem.id });

          const refToId = new Map<string, string>();
          items.forEach((item, idx) => {
            if (item.tempRef && insertedRows[idx]) {
              refToId.set(item.tempRef, insertedRows[idx].id);
            }
          });
          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            if (!item.parentRef) continue;
            const parentId = refToId.get(item.parentRef);
            const selfId = insertedRows[idx]?.id;
            if (parentId && selfId) {
              await tx
                .update(bomItem)
                .set({ parentItemId: parentId })
                .where(eq(bomItem.id, selfId));
            }
          }
        }
      }
    });

    this.logger.log(
      `更新BOM成功: id=${id}, operator=${userId}`,
    );

    return this.getBomDetail(id);
  }

  async deleteBom(id: string, userId: string): Promise<void> {
    const [existingBom] = await this.db
      .select({ id: bom.id })
      .from(bom)
      .where(eq(bom.id, id));
    if (!existingBom) {
      throw new NotFoundException('BOM不存在');
    }

    await this.db.delete(bom).where(eq(bom.id, id));

    this.logger.log(
      `删除BOM成功: id=${id}, operator=${userId}`,
    );
  }

  async getCostSimulation(
    styleId: string,
  ): Promise<CostSimulationResult> {
    // 查款号信息
    const [styleRow] = await this.db
      .select()
      .from(style)
      .where(eq(style.id, styleId));
    if (!styleRow) {
      throw new NotFoundException('款号不存在');
    }

    // 找最新active版本的BOM（优先active，没有则取最新版本）
    const bomRows = await this.db
      .select()
      .from(bom)
      .where(eq(bom.styleId, styleId))
      .orderBy(
        desc(sql`CASE WHEN ${bom.status} = 'active' THEN 1 ELSE 0 END`),
        desc(bom.createdAt),
      )
      .limit(1);

    if (bomRows.length === 0) {
      return {
        styleNo: styleRow.styleNo,
        styleName: styleRow.name,
        totalMaterialCost: 0,
        items: [],
      };
    }

    const targetBom = bomRows[0];

    const itemRows = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, targetBom.id));

    // 查物料标准价
    const materialIds = itemRows.map((row) => row.materialId);
    const materialRows = materialIds.length > 0
      ? await this.db
          .select({ id: material.id, stdPrice: material.stdPrice })
          .from(material)
          .where(inArray(material.id, materialIds))
      : [];
    const priceMap = new Map(
      materialRows.map((m) => [m.id, Number(m.stdPrice ?? 0)]),
    );

    const items = itemRows.map((row) => {
      const usagePerPiece = Number(row.usagePerPiece);
      const lossRate = Number(row.lossRate);
      const unitPrice = priceMap.get(row.materialId) ?? 0;
      const grossUsage = usagePerPiece * (1 + lossRate / 100);
      const cost = grossUsage * unitPrice;
      return {
        materialCode: row.materialCode,
        materialName: row.materialName,
        unit: row.unit,
        usagePerPiece,
        lossRate,
        grossUsage,
        unitPrice,
        cost,
        bomType: row.bomType,
      };
    });

    const totalMaterialCost = items.reduce(
      (sum: number, item) => sum + item.cost,
      0,
    );

    return {
      styleNo: styleRow.styleNo,
      styleName: styleRow.name,
      totalMaterialCost,
      items,
    };
  }

  async getGrossRequirement(
    styleId: string,
    quantity: number,
  ): Promise<GrossRequirementResult> {
    const simulation = await this.getCostSimulation(styleId);

    const items = simulation.items.map((item) => {
      const grossUsage = item.usagePerPiece * quantity * (1 + item.lossRate / 100);
      const cost = grossUsage * item.unitPrice;
      return {
        ...item,
        grossUsage,
        cost,
      };
    });

    const totalMaterialCost = items.reduce(
      (sum: number, item) => sum + item.cost,
      0,
    );

    return {
      ...simulation,
      quantity,
      totalMaterialCost,
      items,
    };
  }
}
