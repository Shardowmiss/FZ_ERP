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
import {
  posTransfer,
  posTransferItem,
  posTransferRequest,
  posTransferRequestItem,
  posStocktake,
  posStocktakeItem,
  posStock,
  posEmployee,
} from '@server/database/schema';
import { eq, and, count, desc, sql, gte, lte } from 'drizzle-orm';
import type {
  Transfer,
  TransferQuery,
  ListResponse,
  TransferRequest,
  CreateTransferRequestDto,
  CreateTransferDto,
  Stocktake,
  StocktakeQuery,
  CreateStocktakeDto,
} from '@shared/api.interface';
import type { AuthPrincipal } from '../auth/auth.service';
import { resolveStoreId, enforceStoreScope } from '@server/common/tenant';
import { ErpIntegrationService } from '../erp-integration/erp-integration.service';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly erp: ErpIntegrationService,
  ) {
    this.db = scopeDatabase(this.db);
  }

  // ============ 调拨单 ============
  async getTransfers(query: TransferQuery): Promise<ListResponse<Transfer>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posTransfer.storeId, query.storeId));
    if (query.status) conditions.push(eq(posTransfer.status, query.status));
    if (query.type) conditions.push(eq(posTransfer.type, query.type));
    if (query.keyword) {
      conditions.push(
        sql`(${posTransfer.transferNo} || ' ' || COALESCE(${posTransfer.erpNo}, '')) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posTransfer)
        .where(whereClause),
      this.db
        .select()
        .from(posTransfer)
        .where(whereClause)
        .orderBy(desc(posTransfer.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapTransfer(row)),
      total,
      page,
      pageSize,
    };
  }

  async receiveTransfer(id: string, principal: AuthPrincipal | null | undefined): Promise<Transfer> {
    // P0-1：收货门店归属服务端权威推导，忽略客户端下发的 storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal);
    const transferRows = await this.db
      .select()
      .from(posTransfer)
      .where(eq(posTransfer.id, id));
    if (transferRows.length === 0) {
      throw new NotFoundException('调拨单不存在');
    }
    const transfer = transferRows[0];
    if (transfer.status !== 'pending') {
      throw new BadRequestException('该调拨单状态不支持收货');
    }

    const items = await this.db
      .select()
      .from(posTransferItem)
      .where(eq(posTransferItem.transferId, id));

    await this.db.transaction(async (tx) => {
      // 更新库存
      for (const item of items) {
        const stockRows = await tx
          .select()
          .from(posStock)
          .where(
            and(eq(posStock.storeId, storeId), eq(posStock.skuId, item.skuId)),
          );

        if (stockRows.length > 0) {
          await tx
            .update(posStock)
            .set({
              qty: sql<number>`${posStock.qty} + ${item.plannedQty}`,
              inTransitQty: sql<number>`${posStock.inTransitQty} - ${item.plannedQty}`,
            })
            .where(eq(posStock.id, stockRows[0].id));
        } else {
          await tx.insert(posStock).values({
            storeId,
            skuId: item.skuId,
            styleId: item.styleId,
            colorId: item.colorId,
            sizeId: item.sizeId,
            qty: item.plannedQty,
            inTransitQty: 0,
          });
        }

        // 更新收货数量
        await tx
          .update(posTransferItem)
          .set({ receivedQty: item.plannedQty })
          .where(eq(posTransferItem.id, item.id));
      }

      // 更新调拨单状态
      await tx
        .update(posTransfer)
        .set({
          status: 'received',
          receivedAt: new Date(),
        })
        .where(eq(posTransfer.id, id));
    });

    return this.getTransferDetail(id);
  }

  /**
   * 创建调拨出库单（type='out'）：当前门店向其他门店/仓库调出商品。
   * P0-1：门店归属服务端权威推导（忽略客户端 storeId），fromLocation 取当前门店名、toLocation 由客户端指定目标。
   * 与「收货入库」(receiveTransfer) 对称：本方法只建单，不改动库存；库存扣减在对方收货确认时发生。
   */
  async createTransfer(dto: CreateTransferDto, principal?: AuthPrincipal | null): Promise<Transfer> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('调拨明细不能为空');
    }

    const storeId = resolveStoreId(principal, dto.storeId);
    const transferNo = generateDocNo('TF');
    const totalQty = dto.items.reduce((sum, it) => sum + it.plannedQty, 0);

    let tfId = '';
    await this.db.transaction(async (tx) => {
      const [result] = await tx
        .insert(posTransfer)
        .values({
          transferNo,
          type: 'out',
          storeId,
          fromLocation: dto.fromLocation,
          toLocation: dto.toLocation,
          totalQty,
          status: 'pending',
          source: 'pos',
        })
        .returning({ id: posTransfer.id });
      tfId = result.id;

      for (const item of dto.items) {
        await tx.insert(posTransferItem).values({
          transferId: result.id,
          skuId: item.skuId,
          styleId: item.styleId,
          colorId: item.colorId,
          sizeId: item.sizeId,
          plannedQty: item.plannedQty,
          receivedQty: 0,
        });
      }
    });

    return this.getTransferDetail(tfId);
  }

  async getTransferDetail(id: string): Promise<Transfer> {
    const rows = await this.db
      .select().from(posTransfer)
      .where(eq(posTransfer.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('调拨单不存在');
    }

    const items = await this.db
      .select()
      .from(posTransferItem)
      .where(eq(posTransferItem.transferId, id));

    return {
      ...this.mapTransfer(rows[0]),
      items: items.map((it) => ({
        id: it.id,
        transferId: it.transferId,
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        plannedQty: it.plannedQty,
        receivedQty: it.receivedQty,
      })),
    };
  }

  // ============ 要货申请 ============
  async getTransferRequests(query: TransferQuery): Promise<ListResponse<TransferRequest>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posTransferRequest.storeId, query.storeId));
    if (query.status) conditions.push(eq(posTransferRequest.status, query.status));
    if (query.keyword) {
      conditions.push(
        sql`${posTransferRequest.reqNo} ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, reqRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posTransferRequest)
        .where(whereClause),
      this.db
        .select({
          id: posTransferRequest.id,
          reqNo: posTransferRequest.reqNo,
          storeId: posTransferRequest.storeId,
          employeeId: posTransferRequest.employeeId,
          totalQty: posTransferRequest.totalQty,
          status: posTransferRequest.status,
          remark: posTransferRequest.remark,
          syncedToErp: posTransferRequest.syncedToErp,
          syncStatus: posTransferRequest.syncStatus,
          syncAt: posTransferRequest.syncAt,
          createdAt: posTransferRequest.createdAt,
          updatedAt: posTransferRequest.updatedAt,
          employeeName: posEmployee.name,
        })
        .from(posTransferRequest)
        .leftJoin(posEmployee, eq(posTransferRequest.employeeId, posEmployee.id))
        .where(whereClause)
        .orderBy(desc(posTransferRequest.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: reqRows.map((row) => ({
        id: row.id,
        reqNo: row.reqNo,
        storeId: row.storeId,
        employeeId: row.employeeId ?? undefined,
        totalQty: row.totalQty,
        status: row.status,
        remark: row.remark ?? undefined,
        syncedToErp: row.syncedToErp,
        syncStatus: row.syncStatus,
        syncAt: row.syncAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        employeeName: row.employeeName ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 将要货申请异步推送到 ERP 接收端（server-to-server）。
   * 失败由 ErpIntegrationService.pushUpstream 记 posSyncLog(failed) 并可重试；fire-and-forget 不阻断本地业务。
   */
  private pushTransferUpstream(req: TransferRequest): Promise<void> {
    const payload = {
      storeId: req.storeId,
      reqNo: req.reqNo,
      remark: req.remark,
      items: (req.items ?? []).map((it) => ({
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        reqQty: it.reqQty,
      })),
    };
    return this.erp.pushUpstream('transfer_requests', req.reqNo, payload);
  }

  async createTransferRequest(dto: CreateTransferRequestDto, principal?: AuthPrincipal | null): Promise<TransferRequest> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('要货明细不能为空');
    }

    // P0-1：要货申请门店归属服务端权威推导，忽略客户端下发的 dto.storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal, dto.storeId);

    const reqNo = generateDocNo('TR');
    const totalQty = dto.items.reduce((sum, it) => sum + it.reqQty, 0);

    let reqId = '';

    await this.db.transaction(async (tx) => {
      const [result] = await tx
        .insert(posTransferRequest)
        .values({
          reqNo,
          storeId,
          employeeId: dto.employeeId,
          totalQty,
          status: 'submitted',
          remark: dto.remark,
        })
        .returning({ id: posTransferRequest.id });
      reqId = result.id;

      for (const item of dto.items) {
        await tx.insert(posTransferRequestItem).values({
          reqId: result.id,
          skuId: item.skuId,
          styleId: item.styleId,
          colorId: item.colorId,
          sizeId: item.sizeId,
          reqQty: item.reqQty,
        });
      }
    });

    return this.getTransferRequestDetail(reqId);
  }

  async getTransferRequestDetail(id: string): Promise<TransferRequest> {
    const rows = await this.db
      .select({
        id: posTransferRequest.id,
        reqNo: posTransferRequest.reqNo,
        storeId: posTransferRequest.storeId,
        employeeId: posTransferRequest.employeeId,
        totalQty: posTransferRequest.totalQty,
        status: posTransferRequest.status,
        remark: posTransferRequest.remark,
        syncedToErp: posTransferRequest.syncedToErp,
        syncStatus: posTransferRequest.syncStatus,
        syncAt: posTransferRequest.syncAt,
        createdAt: posTransferRequest.createdAt,
        updatedAt: posTransferRequest.updatedAt,
        employeeName: posEmployee.name,
      })
      .from(posTransferRequest)
      .leftJoin(posEmployee, eq(posTransferRequest.employeeId, posEmployee.id))
      .where(eq(posTransferRequest.id, id));

    if (rows.length === 0) {
      throw new NotFoundException('要货申请不存在');
    }

    const row = rows[0];
    const items = await this.db
      .select()
      .from(posTransferRequestItem)
      .where(eq(posTransferRequestItem.reqId, id));

    return {
      id: row.id,
      reqNo: row.reqNo,
      storeId: row.storeId,
      employeeId: row.employeeId ?? undefined,
      totalQty: row.totalQty,
      status: row.status,
      remark: row.remark ?? undefined,
      syncedToErp: row.syncedToErp,
      syncStatus: row.syncStatus,
      syncAt: row.syncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      employeeName: row.employeeName ?? undefined,
      items: items.map((it) => ({
        id: it.id,
        reqId: it.reqId,
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        reqQty: it.reqQty,
      })),
    };
  }

  // ============ 盘点单 ============
  async getStocktakes(query: StocktakeQuery): Promise<ListResponse<Stocktake>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posStocktake.storeId, query.storeId));
    if (query.status) conditions.push(eq(posStocktake.status, query.status));
    if (query.keyword) {
      conditions.push(
        sql`${posStocktake.stocktakeNo} ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, stRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posStocktake)
        .where(whereClause),
      this.db
        .select({
          id: posStocktake.id,
          stocktakeNo: posStocktake.stocktakeNo,
          storeId: posStocktake.storeId,
          type: posStocktake.type,
          status: posStocktake.status,
          totalQty: posStocktake.totalQty,
          diffQty: posStocktake.diffQty,
          employeeId: posStocktake.employeeId,
          auditedAt: posStocktake.auditedAt,
          syncedToErp: posStocktake.syncedToErp,
          syncStatus: posStocktake.syncStatus,
          syncAt: posStocktake.syncAt,
          createdAt: posStocktake.createdAt,
          updatedAt: posStocktake.updatedAt,
          employeeName: posEmployee.name,
        })
        .from(posStocktake)
        .leftJoin(posEmployee, eq(posStocktake.employeeId, posEmployee.id))
        .where(whereClause)
        .orderBy(desc(posStocktake.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: stRows.map((row) => ({
        id: row.id,
        stocktakeNo: row.stocktakeNo,
        storeId: row.storeId,
        type: row.type,
        status: row.status,
        totalQty: row.totalQty,
        diffQty: row.diffQty,
        employeeId: row.employeeId ?? undefined,
        auditedAt: row.auditedAt?.toISOString(),
        syncedToErp: row.syncedToErp,
        syncStatus: row.syncStatus,
        syncAt: row.syncAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        employeeName: row.employeeName ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 将盘点单异步推送到 ERP 接收端（server-to-server）。
   * 失败由 ErpIntegrationService.pushUpstream 记 posSyncLog(failed) 并可重试；fire-and-forget 不阻断本地业务。
   */
  private pushStocktakeUpstream(st: Stocktake): Promise<void> {
    const payload = {
      storeId: st.storeId,
      stocktakeNo: st.stocktakeNo,
      items: (st.items ?? []).map((it) => ({
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        bookQty: it.bookQty,
        actualQty: it.actualQty,
      })),
    };
    return this.erp.pushUpstream('stocktakes', st.stocktakeNo, payload);
  }

  async createStocktake(dto: CreateStocktakeDto, principal?: AuthPrincipal | null): Promise<Stocktake> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('盘点明细不能为空');
    }

    // P0-1：盘点单门店归属服务端权威推导，忽略客户端下发的 dto.storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal, dto.storeId);

    const stocktakeNo = generateDocNo('ST');
    const totalQty = dto.items.reduce((sum, it) => sum + it.actualQty, 0);
    const diffQty = dto.items.reduce((sum, it) => sum + it.diffQty, 0);

    let stId = '';

    await this.db.transaction(async (tx) => {
      const [result] = await tx
        .insert(posStocktake)
        .values({
          stocktakeNo,
          storeId,
          type: dto.type,
          totalQty,
          diffQty,
          employeeId: dto.employeeId,
          status: 'draft',
        })
        .returning({ id: posStocktake.id });
      stId = result.id;

      for (const item of dto.items) {
        await tx.insert(posStocktakeItem).values({
          stocktakeId: result.id,
          skuId: item.skuId,
          styleId: item.styleId,
          colorId: item.colorId,
          sizeId: item.sizeId,
          bookQty: item.bookQty,
          actualQty: item.actualQty,
          diffQty: item.diffQty,
        });
      }
    });

    const st = await this.getStocktakeDetail(stId);
    // 上行 ERP：盘点单创建后异步推送（不阻断本地业务；失败由 ErpIntegrationService 记 posSyncLog 并可重试）
    this.pushStocktakeUpstream(st).catch(() => {});
    return st;
  }

  async auditStocktake(id: string, principal: AuthPrincipal | null | undefined): Promise<Stocktake> {
    // P0-1：盘点审核门店归属服务端权威推导，忽略客户端下发的 storeId，杜绝跨店越权
    const storeId = resolveStoreId(principal);
    const stRows = await this.db
      .select()
      .from(posStocktake)
      .where(eq(posStocktake.id, id));
    if (stRows.length === 0) {
      throw new NotFoundException('盘点单不存在');
    }
    if (stRows[0].status !== 'draft') {
      throw new BadRequestException('该盘点单状态不支持审核');
    }

    const items = await this.db
      .select()
      .from(posStocktakeItem)
      .where(eq(posStocktakeItem.stocktakeId, id));

    await this.db.transaction(async (tx) => {
      // 更新库存差异
      for (const item of items) {
        if (item.diffQty !== 0) {
          const stockRows = await tx
            .select()
            .from(posStock)
            .where(
              and(eq(posStock.storeId, storeId), eq(posStock.skuId, item.skuId)),
            );

          if (stockRows.length > 0) {
            await tx
              .update(posStock)
              .set({
                qty: sql<number>`${posStock.qty} + ${item.diffQty}`,
              })
              .where(eq(posStock.id, stockRows[0].id));
          }
        }
      }

      // 更新盘点单状态
      await tx
        .update(posStocktake)
        .set({
          status: 'audited',
          auditedAt: new Date(),
        })
        .where(eq(posStocktake.id, id));
    });

    return this.getStocktakeDetail(id);
  }

  async getStocktakeDetail(id: string): Promise<Stocktake> {
    const rows = await this.db
      .select({
        id: posStocktake.id,
        stocktakeNo: posStocktake.stocktakeNo,
        storeId: posStocktake.storeId,
        type: posStocktake.type,
        status: posStocktake.status,
        totalQty: posStocktake.totalQty,
        diffQty: posStocktake.diffQty,
        employeeId: posStocktake.employeeId,
        auditedAt: posStocktake.auditedAt,
        syncedToErp: posStocktake.syncedToErp,
        syncStatus: posStocktake.syncStatus,
        syncAt: posStocktake.syncAt,
        createdAt: posStocktake.createdAt,
        updatedAt: posStocktake.updatedAt,
        employeeName: posEmployee.name,
      })
      .from(posStocktake)
      .leftJoin(posEmployee, eq(posStocktake.employeeId, posEmployee.id))
      .where(eq(posStocktake.id, id));

    if (rows.length === 0) {
      throw new NotFoundException('盘点单不存在');
    }

    const row = rows[0];
    const items = await this.db
      .select()
      .from(posStocktakeItem)
      .where(eq(posStocktakeItem.stocktakeId, id));

    return {
      id: row.id,
      stocktakeNo: row.stocktakeNo,
      storeId: row.storeId,
      type: row.type,
      status: row.status,
      totalQty: row.totalQty,
      diffQty: row.diffQty,
      employeeId: row.employeeId ?? undefined,
      auditedAt: row.auditedAt?.toISOString(),
      syncedToErp: row.syncedToErp,
      syncStatus: row.syncStatus,
      syncAt: row.syncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      employeeName: row.employeeName ?? undefined,
      items: items.map((it) => ({
        id: it.id,
        stocktakeId: it.stocktakeId,
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        bookQty: it.bookQty,
        actualQty: it.actualQty,
        diffQty: it.diffQty,
      })),
    };
  }

  private mapTransfer(row: typeof posTransfer.$inferSelect): Transfer {
    return {
      id: row.id,
      transferNo: row.transferNo,
      type: row.type,
      storeId: row.storeId,
      fromLocation: row.fromLocation ?? undefined,
      toLocation: row.toLocation ?? undefined,
      totalQty: row.totalQty,
      status: row.status,
      source: row.source,
      erpNo: row.erpNo ?? undefined,
      receivedAt: row.receivedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
