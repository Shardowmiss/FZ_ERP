import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, ilike, inArray } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import {
  preOrder,
  preOrderItem,
  tradeShow,
  style,
  sku,
  dealer,
  store,
} from '@server/database/schema';
import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import { round3 } from '../../common/utils/money';
import type {
  PreOrder,
  PreOrderItem as PreOrderItemType,
  PaginationResult,
} from '@shared/api.interface';

interface PreOrderItemDto {
  skuId: string;
  skuCode: string;
  color?: string;
  size?: string;
  qty: number;
}

interface CreatePreOrderDto {
  tradeShowId: string;
  submitterType: 'dealer' | 'direct';
  dealerId?: string;
  storeId?: string;
  styleId: string;
  items: PreOrderItemDto[];
  remark?: string;
}

interface UpdatePreOrderDto {
  styleId?: string;
  items?: PreOrderItemDto[];
  remark?: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
  tradeShowId?: string;
  submitterType?: string;
  dealerId?: string;
  storeId?: string;
  styleId?: string;
  status?: string;
  keyword?: string;
}


@Injectable()
export class PreOrderService {
  private readonly logger = new Logger(PreOrderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generatePreOrderNo(
    tx: PostgresJsDatabase,
    tradeShowRow: typeof tradeShow.$inferSelect,
  ): Promise<string> {
    const yearPart = (tradeShowRow.year ?? '').slice(-2);
    const seasonPart = (tradeShowRow.season ?? '').slice(0, 3).toUpperCase();
    const prefix = `PO${yearPart}${seasonPart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      preOrder,
      preOrder.preOrderNo,
      prefix,
      4,
    );
  }

  private mapRow(row: typeof preOrder.$inferSelect): PreOrder {
    return {
      id: row.id,
      preOrderNo: row.preOrderNo,
      tradeShowId: row.tradeShowId,
      tradeShowName: row.tradeShowName,
      submitterType: row.submitterType,
      dealerId: row.dealerId ?? undefined,
      dealerName: row.dealerName ?? undefined,
      storeId: row.storeId ?? undefined,
      storeName: row.storeName ?? undefined,
      styleId: row.styleId ?? undefined,
      styleNo: row.styleNo ?? undefined,
      styleName: row.styleName ?? undefined,
      totalQty: Number(row.totalQty),
      status: row.status,
      remark: row.remark ?? undefined,
      submitDate: row.submitDate ?? undefined,
      confirmDate: row.confirmDate ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapItem(row: typeof preOrderItem.$inferSelect): PreOrderItemType {
    return {
      id: row.id,
      preOrderId: row.preOrderId,
      skuId: row.skuId,
      skuCode: row.skuCode,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      qty: Number(row.qty),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<PreOrder>> {
    const {
      page,
      pageSize,
      tradeShowId,
      submitterType,
      dealerId,
      storeId,
      styleId,
      status,
      keyword,
    } = query;

    const conditions = [];
    if (tradeShowId) conditions.push(eq(preOrder.tradeShowId, tradeShowId));
    if (submitterType)
      conditions.push(eq(preOrder.submitterType, submitterType));
    if (dealerId) conditions.push(eq(preOrder.dealerId, dealerId));
    if (storeId) conditions.push(eq(preOrder.storeId, storeId));
    if (styleId) conditions.push(eq(preOrder.styleId, styleId));
    if (status) conditions.push(eq(preOrder.status, status));
    if (keyword)
      conditions.push(ilike(preOrder.preOrderNo, `%${escapeLike(keyword)}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(preOrder).where(where),
      this.db
        .select()
        .from(preOrder)
        .where(where)
        .orderBy(desc(preOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<PreOrder> {
    const rows = await this.db
      .select()
      .from(preOrder)
      .where(eq(preOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('预订单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(preOrderItem)
      .where(eq(preOrderItem.preOrderId, id))
      .orderBy(preOrderItem.id);

    const result = this.mapRow(rows[0]);
    result.items = itemRows.map((row) => this.mapItem(row));
    return result;
  }

  async create(dto: CreatePreOrderDto, userId: string): Promise<PreOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('预订单明细不能为空');
    }
    if (dto.submitterType !== 'dealer' && dto.submitterType !== 'direct') {
      throw new BadRequestException('提交方类型不合法');
    }
    if (dto.submitterType === 'dealer' && !dto.dealerId) {
      throw new BadRequestException('经销商类型需指定经销商');
    }
    if (dto.submitterType === 'direct' && !dto.storeId) {
      throw new BadRequestException('直营类型需指定门店');
    }

    // 校验订货会
    const [showRow] = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, dto.tradeShowId));
    if (!showRow) {
      throw new NotFoundException('订货会不存在');
    }

    // 校验款号
    const [styleRow] = await this.db
      .select()
      .from(style)
      .where(eq(style.id, dto.styleId));
    if (!styleRow) {
      throw new NotFoundException('款号不存在');
    }

    // 校验 SKU 合法性
    const skuIds = dto.items.map((item) => item.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }
    for (const item of dto.items) {
      if (!skuMap.has(item.skuId)) {
        throw new BadRequestException(`SKU 不存在: ${item.skuCode}`);
      }
      if (item.qty < 0) {
        throw new BadRequestException(`SKU ${item.skuCode} 数量不能为负`);
      }
    }

    // 查询提交方名称
    let dealerName: string | null = null;
    let storeName: string | null = null;
    if (dto.submitterType === 'dealer' && dto.dealerId) {
      const [d] = await this.db
        .select()
        .from(dealer)
        .where(eq(dealer.id, dto.dealerId));
      if (!d) throw new NotFoundException('经销商不存在');
      dealerName = d.name;
    }
    if (dto.submitterType === 'direct' && dto.storeId) {
      const [s] = await this.db
        .select()
        .from(store)
        .where(eq(store.id, dto.storeId));
      if (!s) throw new NotFoundException('门店不存在');
      storeName = s.name;
    }

    const totalQty = dto.items.reduce((sum: number, item) => sum + item.qty, 0);

    const result = await this.db.transaction(async (tx) => {
      const preOrderNo = await this.generatePreOrderNo(tx, showRow);

      const [inserted] = await tx
        .insert(preOrder)
        .values({
          preOrderNo,
          tradeShowId: dto.tradeShowId,
          tradeShowName: showRow.name,
          submitterType: dto.submitterType,
          dealerId: dto.dealerId ?? null,
          dealerName,
          storeId: dto.storeId ?? null,
          storeName,
          styleId: dto.styleId,
          styleNo: styleRow.styleNo,
          styleName: styleRow.name,
          totalQty: String(round3(totalQty)),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      await tx.insert(preOrderItem).values(
        dto.items.map((item) => ({
          preOrderId: inserted.id,
          skuId: item.skuId,
          skuCode: item.skuCode,
          color: item.color ?? null,
          size: item.size ?? null,
          qty: String(round3(item.qty)),
        })),
      );

      return inserted;
    });

    this.logger.log(
      `创建预订单成功: id=${result.id}, preOrderNo=${result.preOrderNo}, operator=${userId}`,
    );

    return this.getDetail(result.id);
  }

  async update(
    id: string,
    dto: UpdatePreOrderDto,
    userId: string,
  ): Promise<PreOrder> {
    const existing = await this.db
      .select()
      .from(preOrder)
      .where(eq(preOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('预订单不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的预订单可以修改');
    }

    const patch: Partial<typeof preOrder.$inferInsert> = {};
    let itemsChanged = false;

    if (dto.styleId !== undefined && dto.styleId !== existing[0].styleId) {
      const [styleRow] = await this.db
        .select()
        .from(style)
        .where(eq(style.id, dto.styleId));
      if (!styleRow) throw new NotFoundException('款号不存在');
      patch.styleId = dto.styleId;
      patch.styleNo = styleRow.styleNo;
      patch.styleName = styleRow.name;
      itemsChanged = true;
    }

    if (dto.remark !== undefined) {
      patch.remark = dto.remark;
    }

    if (dto.items !== undefined) {
      if (dto.items.length === 0) {
        throw new BadRequestException('预订单明细不能为空');
      }
      for (const item of dto.items) {
        if (item.qty < 0) {
          throw new BadRequestException(
            `SKU ${item.skuCode} 数量不能为负`,
          );
        }
      }
      itemsChanged = true;
    }

    if (Object.keys(patch).length === 0 && !itemsChanged) {
      throw new BadRequestException('未提供可更新字段');
    }

    patch.updatedAt = new Date();

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(preOrder).set(patch).where(eq(preOrder.id, id));
      }

      if (itemsChanged && dto.items !== undefined) {
        await tx.delete(preOrderItem).where(eq(preOrderItem.preOrderId, id));
        await tx.insert(preOrderItem).values(
          dto.items.map((item) => ({
            preOrderId: id,
            skuId: item.skuId,
            skuCode: item.skuCode,
            color: item.color ?? null,
            size: item.size ?? null,
            qty: String(round3(item.qty)),
          })),
        );

        const totalQty = dto.items.reduce(
          (sum: number, item) => sum + item.qty,
          0,
        );
        await tx
          .update(preOrder)
          .set({ totalQty: String(round3(totalQty)), updatedAt: new Date() })
          .where(eq(preOrder.id, id));
      }
    });

    this.logger.log(
      `更新预订单成功: id=${id}, operator=${userId}`,
    );

    return this.getDetail(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, preOrder, id);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(preOrder)
      .where(eq(preOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('预订单不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的预订单可以删除');
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(preOrderItem).where(eq(preOrderItem.preOrderId, id));
      await tx.delete(preOrder).where(eq(preOrder.id, id));
    });

    this.logger.log(
      `删除预订单成功: id=${id}, operator=${userId}`,
    );
  }

  async submit(id: string, userId: string): Promise<PreOrder> {
    const existing = await this.db
      .select()
      .from(preOrder)
      .where(eq(preOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('预订单不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的预订单可以提交');
    }

    // 校验订货会状态必须 ongoing
    const [showRow] = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, existing[0].tradeShowId));
    if (!showRow || showRow.status !== 'ongoing') {
      throw new BadRequestException('订货会未在进行中，无法提交');
    }

    // 校验明细
    const itemRows = await this.db
      .select()
      .from(preOrderItem)
      .where(eq(preOrderItem.preOrderId, id));
    if (itemRows.length === 0) {
      throw new BadRequestException('预订单无明细，无法提交');
    }
    for (const item of itemRows) {
      if (Number(item.qty) <= 0) {
        throw new BadRequestException('明细数量必须大于0');
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    await this.db
      .update(preOrder)
      .set({ status: 'submitted', submitDate: today, updatedAt: new Date() })
      .where(eq(preOrder.id, id));

    this.logger.log(
      `提交预订单成功: id=${id}, operator=${userId}`,
    );

    return this.getDetail(id);
  }

  async confirm(id: string, userId: string): Promise<PreOrder> {
    const existing = await this.db
      .select()
      .from(preOrder)
      .where(eq(preOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('预订单不存在');
    }
    if (existing[0].status !== 'submitted') {
      throw new BadRequestException('仅已提交状态的预订单可以确认');
    }

    const today = new Date().toISOString().slice(0, 10);
    await this.db
      .update(preOrder)
      .set({ status: 'confirmed', confirmDate: today, updatedAt: new Date() })
      .where(eq(preOrder.id, id));

    this.logger.log(
      `确认预订单成功: id=${id}, operator=${userId}`,
    );

    return this.getDetail(id);
  }

  async reject(
    id: string,
    userId: string,
    backToDraft?: boolean,
  ): Promise<PreOrder> {
    const existing = await this.db
      .select()
      .from(preOrder)
      .where(eq(preOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('预订单不存在');
    }
    if (existing[0].status !== 'submitted') {
      throw new BadRequestException('仅已提交状态的预订单可以驳回');
    }

    const targetStatus = backToDraft ? 'draft' : 'rejected';
    const patch: Partial<typeof preOrder.$inferInsert> = {
      status: targetStatus,
      updatedAt: new Date(),
    };
    if (backToDraft) {
      patch.submitDate = null;
    }

    await this.db.update(preOrder).set(patch).where(eq(preOrder.id, id));

    this.logger.log(
      `驳回预订单成功: id=${id}, 状态→${targetStatus}, operator=${userId}`,
    );

    return this.getDetail(id);
  }
}
