import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, or, ilike, gt, sql } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import {
  store,
  warehouse,
  dealer,
  retailOrder,
  retailReturn,
  preOrder,
  allocationItem,
  inventoryStock,
  materialStock,
} from '@server/database/schema';
import { encryptField, hmacField, decryptField } from '@server/common/crypto/field-encryption';
import type { Store } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

type StoreInsert = typeof store.$inferInsert;

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    storeType?: string,
    dealerId?: string,
    status?: string,
  ): Promise<{ items: Store[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(store.code, `%${escaped}%`), ilike(store.name, `%${escaped}%`)));
    }
    if (storeType) conditions.push(eq(store.storeType, storeType));
    if (dealerId) conditions.push(eq(store.dealerId, dealerId));
    if (status) conditions.push(eq(store.status, status));
    // 行级数据权限：门店按所属经销商隔离，非本经销商门店不可见（防跨租户读取）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: store.dealerId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(store).where(where as any),
      this.db
        .select({
          id: store.id,
          code: store.code,
          name: store.name,
          storeType: store.storeType,
          dealerId: store.dealerId,
          dealerName: dealer.name,
          warehouseId: store.warehouseId,
          contactPerson: store.contactPerson,
          phone: store.phone,
          address: store.address,
          status: store.status,
          remark: store.remark,
          createdAt: store.createdAt,
          // 店仓逻辑统一视图：LEFT JOIN 绑定仓库
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          warehouseType: warehouse.type,
          warehouseStoreCode: warehouse.storeCode,
        })
        .from(store)
        .leftJoin(warehouse, eq(store.warehouseId, warehouse.id))
        .leftJoin(dealer, eq(store.dealerId, dealer.id))
        .where(where as any)
        .orderBy(desc(store.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: Store[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      storeType: row.storeType,
      dealerId: row.dealerId ?? undefined,
      dealerName: row.dealerName ?? undefined,
      warehouseId: row.warehouseId ?? undefined,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
      // 店仓视图：绑定仓库信息（LEFT JOIN，可能为空）
      warehouseCode: row.warehouseCode ?? undefined,
      warehouseName: row.warehouseName ?? undefined,
      warehouseType: row.warehouseType ?? undefined,
      warehouseStoreCode: row.warehouseStoreCode ?? undefined,
    }));

    return { items, total, page, pageSize };
  }

  async detail(id: string): Promise<Store> {
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: store.dealerId },
    );
    const rows = await this.db
      .select({
        id: store.id,
        code: store.code,
        name: store.name,
        storeType: store.storeType,
        dealerId: store.dealerId,
        dealerName: dealer.name,
        warehouseId: store.warehouseId,
        contactPerson: store.contactPerson,
        phone: store.phone,
        address: store.address,
        status: store.status,
        remark: store.remark,
        createdAt: store.createdAt,
      })
      .from(store)
      .leftJoin(dealer, eq(store.dealerId, dealer.id))
      .where(scopeCond ? and(eq(store.id, id), scopeCond) : eq(store.id, id));
    if (rows.length === 0) throw new NotFoundException('店仓不存在');
    const row = rows[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      storeType: row.storeType,
      dealerId: row.dealerId ?? undefined,
      dealerName: row.dealerName ?? undefined,
      warehouseId: row.warehouseId ?? undefined,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: {
    code: string;
    name: string;
    storeType: string;
    dealerId?: string;
    warehouseId?: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    remark?: string;
    status?: string;
  }): Promise<Store> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!dto.storeType?.trim()) throw new BadRequestException('店仓类型不能为空');
    if (!dto.dealerId?.trim()) throw new BadRequestException('店仓必须关联所属经销商');

    const existing = await this.db.select().from(store).where(eq(store.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: StoreInsert = {
      code: dto.code,
      name: dto.name,
      storeType: dto.storeType,
      dealerId: dto.dealerId ?? null,
      warehouseId: dto.warehouseId ?? null,
      contactPerson: dto.contactPerson ?? null,
      phone: encryptField(dto.phone) ?? null,
      phoneHmac: hmacField(dto.phone),
      address: dto.address ?? null,
      remark: dto.remark ?? null,
      status: dto.status ?? 'active',
    };

    const inserted = await this.db.insert(store).values(values).returning();
    const row = inserted[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      storeType: row.storeType,
      dealerId: row.dealerId ?? undefined,
      dealerName: undefined,
      warehouseId: row.warehouseId ?? undefined,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async update(
    id: string,
    dto: {
      code?: string;
      name?: string;
      storeType?: string;
      dealerId?: string | null;
      warehouseId?: string | null;
      contactPerson?: string | null;
      phone?: string | null;
      address?: string | null;
      remark?: string | null;
      status?: string;
    },
  ): Promise<Store> {
    const patch: Partial<StoreInsert> = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.storeType !== undefined) {
      if (!dto.storeType.trim()) throw new BadRequestException('店仓类型不能为空');
      patch.storeType = dto.storeType;
    }
    if (dto.dealerId !== undefined) {
      patch.dealerId = dto.dealerId ?? null;
    }
    if (dto.warehouseId !== undefined) patch.warehouseId = dto.warehouseId ?? null;
    if (dto.contactPerson !== undefined) patch.contactPerson = dto.contactPerson ?? null;
    if (dto.phone !== undefined) {
      patch.phone = encryptField(dto.phone) ?? null;
      patch.phoneHmac = hmacField(dto.phone);
    }
    if (dto.address !== undefined) patch.address = dto.address ?? null;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db.update(store).set(patch).where(eq(store.id, id)).returning();
    if (updated.length === 0) throw new NotFoundException('店仓不存在');
    const row = updated[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      storeType: row.storeType,
      dealerId: row.dealerId ?? undefined,
      dealerName: undefined,
      warehouseId: row.warehouseId ?? undefined,
      contactPerson: row.contactPerson ?? undefined,
      phone: decryptField(row.phone) ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async remove(id: string): Promise<void> {
    // 先查店仓获取 warehouseId
    const storeRows = await this.db
      .select({ id: store.id, warehouseId: store.warehouseId })
      .from(store)
      .where(eq(store.id, id));
    if (storeRows.length === 0) throw new NotFoundException('店仓不存在');
    const warehouseId = storeRows[0].warehouseId;

    // 引用检查：零售单、零售退货、预售单、配货单
    const [retailCount, returnCount, preOrderCount, allocCount] = await Promise.all([
      this.db.select({ count: count() }).from(retailOrder).where(eq(retailOrder.storeId, id)),
      this.db.select({ count: count() }).from(retailReturn).where(eq(retailReturn.storeId, id)),
      this.db.select({ count: count() }).from(preOrder).where(eq(preOrder.storeId, id)),
      this.db.select({ count: count() }).from(allocationItem).where(eq(allocationItem.storeId, id)),
    ]);

    const hasDocReference = [
      retailCount[0]?.count,
      returnCount[0]?.count,
      preOrderCount[0]?.count,
      allocCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasDocReference) {
      throw new ConflictException('店仓存在关联单据，无法删除');
    }

    // 库存检查：店仓关联仓库有库存则拒绝
    if (warehouseId) {
      const [skuStockCount, matStockCount] = await Promise.all([
        this.db
          .select({ count: count() })
          .from(inventoryStock)
          .where(and(eq(inventoryStock.warehouseId, warehouseId), gt(inventoryStock.quantity, sql`'0'::numeric`))),
        this.db
          .select({ count: count() })
          .from(materialStock)
          .where(and(eq(materialStock.warehouseId, warehouseId), gt(materialStock.quantity, sql`'0'::numeric`))),
      ]);

      const hasStock = [skuStockCount[0]?.count, matStockCount[0]?.count]
        .some((c) => Number(c ?? 0) > 0);

      if (hasStock) {
        throw new ConflictException('店仓存在关联单据，无法删除');
      }
    }

    const deleted = await this.db.delete(store).where(eq(store.id, id)).returning({ id: store.id });
    if (deleted.length === 0) throw new NotFoundException('店仓不存在');
  }

  async options(): Promise<{
    id: string;
    code: string;
    name: string;
    storeType: string;
    dealerId: string | null;
    warehouseId: string | null;
  }[]> {
    const rows = await this.db
      .select({
        id: store.id,
        code: store.code,
        name: store.name,
        storeType: store.storeType,
        dealerId: store.dealerId,
        warehouseId: store.warehouseId,
      })
      .from(store)
      .where(eq(store.status, 'active'))
      .orderBy(store.code);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      storeType: row.storeType,
      dealerId: row.dealerId,
      warehouseId: row.warehouseId,
    }));
  }
}
