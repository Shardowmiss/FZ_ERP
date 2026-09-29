import { fromCents } from '@server/database/money';
import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import {
  notDeleted,
  restoreSoftDeleted,
  scopeDatabase,
  softDelete,
} from '@server/database/soft-delete';
import {
  posColor,
  posSize,
  posStyle,
  posSku,
  posStock,
  posStore,
  posCoupon,
  posMember,
  posEmployee,
  posOperationLog,
} from '@server/database/schema';
import { eq, and, like, count, desc, asc, ilike, inArray, sql } from 'drizzle-orm';
import { AnyPgTable } from 'drizzle-orm/pg-core';
import type {
  Color,
  Size,
  Style,
  StyleDetail,
  Sku,
  ListResponse,
  StyleQuery,
  SkuQuery,
  StockMatrix,
} from '@shared/api.interface';

@Injectable()
export class MasterDataService {
  private readonly logger = new Logger(MasterDataService.name);

  /** 保留原始（未包裹软删除拦截器的）db，供需穿透 notDeleted 过滤的管理操作（恢复已删除行）使用 */
  private readonly rawDb: PostgresJsDatabase;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {
    this.rawDb = db;
    this.db = scopeDatabase(this.db);
  }

  async getColors(): Promise<Color[]> {
    const rows = await this.db.select().from(posColor).where(notDeleted(posColor)).orderBy(asc(posColor.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      hex: row.hex,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getSizes(): Promise<Size[]> {
    const rows = await this.db.select().from(posSize).where(notDeleted(posSize)).orderBy(asc(posSize.sortOrder), asc(posSize.id));
    return rows.map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getStyles(query: StyleQuery): Promise<ListResponse<Style>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const STATUS_MAP: Record<string, string> = {
      active: 'on_sale',
      inactive: 'discontinued',
      development: 'development',
      discontinued: 'discontinued',
      on_sale: 'on_sale',
    };
    const conditions = [];
    if (query.status) {
      const dbStatus = STATUS_MAP[query.status] ?? query.status;
      conditions.push(eq(posStyle.status, dbStatus));
    }
    if (query.category) conditions.push(eq(posStyle.category, query.category));
    if (query.keyword) {
      conditions.push(
        sql`(${posStyle.id} || ' ' || ${posStyle.name}) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    conditions.push(notDeleted(posStyle));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posStyle)
        .where(whereClause),
      this.db
        .select()
        .from(posStyle)
        .where(whereClause)
        .orderBy(desc(posStyle.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        colorIds: row.colorIds ?? [],
        sizeIds: row.sizeIds ?? [],
        tagPrice: fromCents(row.tagPrice),
        costPrice: fromCents(row.costPrice),
        status: row.status,
        erpSyncAt: row.erpSyncAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getStyleDetail(id: string): Promise<StyleDetail> {
    const rows = await this.db.select().from(posStyle).where(and(eq(posStyle.id, id), notDeleted(posStyle)));
    if (rows.length === 0) {
      throw new NotFoundException('款式不存在');
    }
    const row = rows[0];

    const colorIds = row.colorIds ?? [];
    const sizeIds = row.sizeIds ?? [];

    const [colors, sizes] = await Promise.all([
      colorIds.length > 0
        ? this.db.select().from(posColor).where(inArray(posColor.id, colorIds))
        : Promise.resolve([]),
      sizeIds.length > 0
        ? this.db.select().from(posSize).where(inArray(posSize.id, sizeIds)).orderBy(asc(posSize.sortOrder))
        : Promise.resolve([]),
    ]);

    return {
      id: row.id,
      name: row.name,
      category: row.category,
      colorIds,
      sizeIds,
      tagPrice: fromCents(row.tagPrice),
      costPrice: fromCents(row.costPrice),
      status: row.status,
      erpSyncAt: row.erpSyncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      colors: colors.map((c) => ({
        id: c.id,
        name: c.name,
        hex: c.hex,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      sizes: sizes.map((s) => ({
        id: s.id,
        sortOrder: s.sortOrder,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }

  async getStyleMatrix(id: string, storeId?: string): Promise<StockMatrix> {
    const style = await this.getStyleDetail(id);
    const colorIds = style.colorIds ?? [];
    const sizeIds = style.sizeIds ?? [];

    const stockConditions = [eq(posStock.styleId, id)];
    if (storeId) stockConditions.push(eq(posStock.storeId, storeId));

    const stockRows = await this.db
      .select()
      .from(posStock)
      .where(and(...stockConditions));

    const matrix: Record<string, Record<string, number>> = {};
    const rowTotals: Record<string, number> = {};
    const colTotals: Record<string, number> = {};
    let grandTotal = 0;

    for (const colorId of colorIds) {
      matrix[colorId] = {};
      rowTotals[colorId] = 0;
      for (const sizeId of sizeIds) {
        matrix[colorId][sizeId] = 0;
        colTotals[sizeId] = 0;
      }
    }

    for (const row of stockRows) {
      if (matrix[row.colorId] && matrix[row.colorId][row.sizeId] !== undefined) {
        matrix[row.colorId][row.sizeId] = row.qty;
      } else if (matrix[row.colorId]) {
        matrix[row.colorId][row.sizeId] = row.qty;
      }
      rowTotals[row.colorId] = (rowTotals[row.colorId] ?? 0) + row.qty;
      colTotals[row.sizeId] = (colTotals[row.sizeId] ?? 0) + row.qty;
      grandTotal += row.qty;
    }

    return {
      styleId: id,
      styleName: style.name,
      colors: style.colors ?? [],
      sizes: style.sizes ?? [],
      matrix,
      rowTotals,
      colTotals,
      grandTotal,
    };
  }

  async getSkus(query: SkuQuery): Promise<ListResponse<Sku & { styleName?: string; colorName?: string }>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.styleId) conditions.push(eq(posSku.styleId, query.styleId));
    if (query.barcode) conditions.push(eq(posSku.barcode, query.barcode));
    if (query.keyword) {
      conditions.push(
        sql`(${posSku.id} || ' ' || COALESCE(${posSku.barcode}, '')) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    conditions.push(notDeleted(posSku));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, skuRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posSku)
        .where(whereClause),
      this.db
        .select({
          id: posSku.id,
          styleId: posSku.styleId,
          colorId: posSku.colorId,
          sizeId: posSku.sizeId,
          barcode: posSku.barcode,
          createdAt: posSku.createdAt,
          updatedAt: posSku.updatedAt,
          styleName: posStyle.name,
        })
        .from(posSku)
        .leftJoin(posStyle, eq(posSku.styleId, posStyle.id))
        .where(whereClause)
        .orderBy(desc(posSku.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: skuRows.map((row) => ({
        id: row.id,
        styleId: row.styleId,
        colorId: row.colorId,
        sizeId: row.sizeId,
        barcode: row.barcode ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        styleName: row.styleName ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // P2-10 进阶：主数据软删除「删除端点」（运营后台停用 / 恢复主数据）
  // ---------------------------------------------------------------------------

  /** 支持软删除管理的主数据类型 → 表映射（运营后台可停用/恢复的主数据）。 */
  private readonly MASTER_TABLES: Record<string, AnyPgTable> = {
    store: posStore,
    coupon: posCoupon,
    member: posMember,
    employee: posEmployee,
    sku: posSku,
    style: posStyle,
    size: posSize,
    color: posColor,
    // 注：posStock 为运营库存量，非主数据，不纳入通用停用/恢复入口。
  };

  /** 解析主数据类型，非法类型抛 400。 */
  private resolveMasterTable(type: string): AnyPgTable {
    const table = this.MASTER_TABLES[type];
    if (!table) {
      throw new BadRequestException(`不支持的主数据类型：${type}`);
    }
    return table;
  }

  /** 运营后台「停用」主数据：置位 deletedAt（软删除），不可逆但可恢复。 */
  async softDeleteMaster(
    type: string,
    id: string,
    operatorId?: string,
  ): Promise<{ success: boolean; type: string; id: string; deletedAt: string }> {
    const table = this.resolveMasterTable(type);
    const exists = await this.rawDb.execute(
      sql`SELECT 1 AS ok FROM ${table} WHERE id = ${id} LIMIT 1`,
    );
    if ((exists as unknown as unknown[]).length === 0) {
      throw new NotFoundException(`主数据（${type}）不存在`);
    }
    await softDelete(this.rawDb, table as unknown as { id: unknown; deletedAt: unknown }, id);
    await this.auditMaster(type, id, 'delete', operatorId);
    return { success: true, type, id, deletedAt: new Date().toISOString() };
  }

  /** 运营后台「恢复」主数据：清空 deletedAt，重新生效。需穿透拦截器（已删除行不在 notDeleted 内）。 */
  async restoreMaster(
    type: string,
    id: string,
    operatorId?: string,
  ): Promise<{ success: boolean; type: string; id: string }> {
    const table = this.resolveMasterTable(type);
    const exists = await this.rawDb.execute(
      sql`SELECT 1 AS ok FROM ${table} WHERE id = ${id} LIMIT 1`,
    );
    if ((exists as unknown as unknown[]).length === 0) {
      throw new NotFoundException(`主数据（${type}）不存在`);
    }
    await restoreSoftDeleted(
      this.rawDb,
      table as unknown as { id: unknown; deletedAt: unknown },
      id,
    );
    await this.auditMaster(type, id, 'restore', operatorId);
    return { success: true, type, id };
  }

  /** 主数据变更审计（写入失败仅告警，不影响主流程）。 */
  private async auditMaster(
    type: string,
    id: string,
    action: 'delete' | 'restore',
    operatorId?: string,
  ): Promise<void> {
    try {
      await this.rawDb.insert(posOperationLog).values({
        module: 'master-data',
        action,
        targetNo: `${type}:${id}`,
        content: JSON.stringify({ type, id, action, operatorId }),
        employeeId: operatorId ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `主数据审计日志写入失败（${action} ${type}:${id}）：${String(e)}`,
      );
    }
  }
}
