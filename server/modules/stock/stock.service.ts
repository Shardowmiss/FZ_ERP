import { fromCents } from '@server/database/money';
import { auditAction } from '@server/common/audit';
import type { AuthPrincipal } from '../auth/auth.service';
import { resolveStoreId, enforceStoreScope } from '@server/common/tenant';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import { generateDocNo } from '@server/database/id';
import { chunk, BATCH_SIZE } from '@server/common/batch';
import {
  posStock,
  posStyle,
  posColor,
  posSize,
  posStockAdjust,
  posStockAdjustItem,
  posSku,
} from '@server/database/schema';
import { eq, and, count, desc, asc, inArray, sql, gt, gte, lt } from 'drizzle-orm';
import type {
  StockDetail,
  StockMatrix,
  ListResponse,
  StockQuery,
  StockAdjustDto,
  LowStockAlert,
} from '@shared/api.interface';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    ) {
    this.db = scopeDatabase(this.db);
  }

  async getStockList(query: StockQuery): Promise<ListResponse<StockDetail>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posStock.storeId, query.storeId));
    if (query.styleId) conditions.push(eq(posStock.styleId, query.styleId));
    if (query.keyword) {
      conditions.push(
        sql`(${posStock.skuId} || ' ' || ${posStock.styleId}) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }
    if (query.lowStockOnly) {
      conditions.push(lt(posStock.qty, 10));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, stockRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posStock)
        .where(whereClause),
      this.db
        .select({
          id: posStock.id,
          storeId: posStock.storeId,
          skuId: posStock.skuId,
          styleId: posStock.styleId,
          colorId: posStock.colorId,
          sizeId: posStock.sizeId,
          qty: posStock.qty,
          inTransitQty: posStock.inTransitQty,
          createdAt: posStock.createdAt,
          updatedAt: posStock.updatedAt,
          styleName: posStyle.name,
          colorName: posColor.name,
          tagPrice: sql<number>`${posStyle.tagPrice} / 100.0`,
        })
        .from(posStock)
        .leftJoin(posStyle, eq(posStock.styleId, posStyle.id))
        .leftJoin(posColor, eq(posStock.colorId, posColor.id))
        .where(whereClause)
        .orderBy(desc(posStock.updatedAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: stockRows.map((row) => ({
        id: row.id,
        storeId: row.storeId,
        skuId: row.skuId,
        styleId: row.styleId,
        colorId: row.colorId,
        sizeId: row.sizeId,
        qty: row.qty,
        inTransitQty: row.inTransitQty,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        styleName: row.styleName ?? undefined,
        colorName: row.colorName ?? undefined,
        tagPrice: row.tagPrice ? fromCents(row.tagPrice) : undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getStockMatrix(styleId: string, storeId: string): Promise<StockMatrix> {
    const styleRows = await this.db
      .select()
      .from(posStyle)
      .where(eq(posStyle.id, styleId));
    if (styleRows.length === 0) {
      throw new NotFoundException('款式不存在');
    }
    const style = styleRows[0];

    const colorIds = style.colorIds ?? [];
    const sizeIds = style.sizeIds ?? [];

    const stockConditions = [eq(posStock.styleId, styleId)];
    if (storeId) stockConditions.push(eq(posStock.storeId, storeId));

    const [colors, sizes, stockRows] = await Promise.all([
      colorIds.length > 0
        ? this.db.select().from(posColor).where(inArray(posColor.id, colorIds))
        : Promise.resolve([]),
      sizeIds.length > 0
        ? this.db.select().from(posSize).where(inArray(posSize.id, sizeIds)).orderBy(asc(posSize.sortOrder))
        : Promise.resolve([]),
      this.db
        .select()
        .from(posStock)
        .where(and(...stockConditions)),
    ]);

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
      if (!matrix[row.colorId]) {
        matrix[row.colorId] = {};
        rowTotals[row.colorId] = 0;
      }
      matrix[row.colorId][row.sizeId] = row.qty;
      rowTotals[row.colorId] = (rowTotals[row.colorId] ?? 0) + row.qty;
      colTotals[row.sizeId] = (colTotals[row.sizeId] ?? 0) + row.qty;
      grandTotal += row.qty;
    }

    return {
      styleId,
      styleName: style.name,
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
      matrix,
      rowTotals,
      colTotals,
      grandTotal,
    };
  }

  async adjustStock(dto: StockAdjustDto, principal?: AuthPrincipal | null): Promise<{ success: boolean; adjustNo: string }> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('调整明细不能为空');
    }

    // P0-1：库存调整门店归属服务端权威推导，忽略客户端下发的 storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal, dto.storeId);
    const employeeId = principal?.employeeId ?? null;

    // 幂等：如果传入 clientId，使用 clientId 派生的 adjustNo 检查是否已存在
    if (dto.clientId) {
      const existing = await this.db
        .select()
        .from(posStockAdjust)
        .where(eq(posStockAdjust.adjustNo, `ADJ-${dto.clientId}`));
      if (existing.length > 0) {
        return { success: true, adjustNo: existing[0].adjustNo };
      }
    }

    const adjustNo = dto.clientId ? `ADJ-${dto.clientId}` : generateDocNo('ADJ');

    await this.db.transaction(async (tx) => {
      const [header] = await tx
        .insert(posStockAdjust)
        .values({
          adjustNo,
          storeId: storeId,
          type: dto.type,
          reason: dto.reason,
          status: 'completed',
          employeeId,
        })
        .returning({ id: posStockAdjust.id });

      for (const item of dto.items) {
        const existing = await tx
          .select()
          .from(posStock)
          .where(
            and(eq(posStock.storeId, storeId), eq(posStock.skuId, item.skuId)),
          );

        let qtyChange = item.qty;
        if (dto.type === 'decrease') qtyChange = -qtyChange;
        else if (dto.type === 'check') qtyChange = item.qty; // check = set to this qty

        if (existing.length > 0 && dto.type !== 'check') {
          await tx
            .update(posStock)
            .set({ qty: sql<number>`${posStock.qty} + ${qtyChange}` })
            .where(eq(posStock.id, existing[0].id));
        } else if (existing.length > 0 && dto.type === 'check') {
          await tx
            .update(posStock)
            .set({ qty: qtyChange })
            .where(eq(posStock.id, existing[0].id));
        } else {
          await tx.insert(posStock).values({
            storeId: storeId,
            skuId: item.skuId,
            styleId: item.styleId,
            colorId: item.colorId,
            sizeId: item.sizeId,
            qty: dto.type === 'check' ? item.qty : qtyChange,
            inTransitQty: 0,
          });
        }
      }

      // P1-4 引用完整性：库存调整明细落库（与盘点/要货对齐，避免调整内容随库存更新而丢失）
      if (dto.items.length > 0) {
        const itemValues = dto.items.map((item) => ({
          adjustId: header.id,
          skuId: item.skuId,
          styleId: item.styleId,
          colorId: item.colorId,
          sizeId: item.sizeId,
          qty: item.qty,
        }));
        for (const batch of chunk(itemValues, BATCH_SIZE)) {
          await tx.insert(posStockAdjustItem).values(batch);
        }
      }

      // P0-2：库存调整审计（与调整同事务，失败仅告警不回滚主流程）
      await auditAction(tx, {
        storeId: storeId,
        employeeId: employeeId ?? null,
        module: 'stock',
        action: 'adjust',
        targetNo: adjustNo,
        content: { adjustNo, storeId: storeId, type: dto.type, itemCount: dto.items.length },
      });
    });

    return { success: true, adjustNo };
  }

  async getStockAdjustDetail(
    adjustNo: string,
    scopedStoreId?: string | null,
  ): Promise<typeof posStockAdjust.$inferSelect & { items: (typeof posStockAdjustItem.$inferSelect)[] }> {
    const [header] = await this.db
      .select()
      .from(posStockAdjust)
      .where(eq(posStockAdjust.adjustNo, adjustNo));
    if (!header) {
      throw new NotFoundException('库存调整单不存在');
    }
    // P0-1：跨店越权防护——非本店且主体非超管时，隐藏单号存在性
    if (scopedStoreId && header.storeId !== scopedStoreId) {
      throw new NotFoundException('库存调整单不存在');
    }

    const items = await this.db
      .select()
      .from(posStockAdjustItem)
      .where(eq(posStockAdjustItem.adjustId, header.id));

    return { ...header, items };
  }

  async getLowStock(storeId: string, threshold: number = 10): Promise<LowStockAlert[]> {
    const lowStockRows = await this.db
      .select({
        styleId: posStock.styleId,
        colorId: posStock.colorId,
        sizeId: posStock.sizeId,
        qty: posStock.qty,
        styleName: posStyle.name,
        colorName: posColor.name,
      })
      .from(posStock)
      .leftJoin(posStyle, eq(posStock.styleId, posStyle.id))
      .leftJoin(posColor, eq(posStock.colorId, posColor.id))
      .where(
        and(
          eq(posStock.storeId, storeId),
          lt(posStock.qty, threshold),
          gt(posStock.qty, 0),
        ),
      )
      .orderBy(asc(posStock.qty))
      .limit(50);

    return lowStockRows.map((row) => ({
      styleId: row.styleId,
      styleName: row.styleName ?? '',
      colorId: row.colorId,
      colorName: row.colorName ?? '',
      sizeId: row.sizeId,
      qty: row.qty,
      threshold,
    }));
  }
}
