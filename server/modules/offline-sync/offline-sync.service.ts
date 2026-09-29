import { fromCents } from '@server/database/money';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import {
  posOfflineQueue,
  posColor,
  posSize,
  posStyle,
  posSku,
  posPromotion,
  posMember,
  posStock,
  posStore,
} from '@server/database/schema';
import { eq, and, count, desc, sql, asc, gt } from 'drizzle-orm';
import { mapWithConcurrency } from '@server/common/batch';
import { SalesService } from '../sales/sales.service';
import { ReturnsService } from '../returns/returns.service';
import { MembersService } from '../members/members.service';
import { StockService } from '../stock/stock.service';
import type {
  OfflineSyncResult,
  OfflineQueueItem,
  OfflineQueueQuery,
  ListResponse,
  OfflineEntityType,
  MasterDataSnapshot,
  MasterDataDeletions,
  CreateSaleOrderDto,
  CreateReturnOrderDto,
  CreateMemberDto,
  SuspendOrderDto,
  StockAdjustDto,
} from '@shared/api.interface';

/** S-8：syncing 状态超过该时长仍未落终态，判定为僵死并允许重新认领（5 分钟） */
const SYNCING_STALE_MS = 5 * 60 * 1000;

/** P1-6：离线批量同步的并发上限（并发令牌桶）。
 *  顺序 await 把 ERP/库存写入串行化；全量 Promise.all 又在百店高峰打爆 DB。
 *  8 路在「吞吐」与「背压」间取平衡；每个 item 独立 return 即「流式 ack」。 */
const SYNC_CONCURRENCY = 8;

@Injectable()
export class OfflineSyncService {
  private readonly logger = new Logger(OfflineSyncService.name);

  /** 未套软删除作用域的裸连接：增量水位扫描必须用它，见 getMasterData。 */
  private readonly rawDb: PostgresJsDatabase;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly salesService: SalesService,
    private readonly returnsService: ReturnsService,
    private readonly membersService: MembersService,
    private readonly stockService: StockService,
    ) {
    // 软删除作用域只应作用于「业务读」，不能用来做增量水位扫描——
    // 详见 getMasterData 的删除通知实现（rawDb 是唯一能同时看到「有效行」与「失效行」的入口）。
    this.rawDb = db;
    this.db = scopeDatabase(this.db);
  }

  /**
   * S-8：判定一条 syncing 记录是否已「僵死」。
   * 同步是短事务（秒级），超过阈值仍未落终态，说明进程崩溃/网络中断，允许被重新认领。
   */
  private isStale(updatedAt: Date | string | null | undefined): boolean {
    if (!updatedAt) return true;
    const ts = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
    if (Number.isNaN(ts)) return true;
    return Date.now() - ts > SYNCING_STALE_MS;
  }

  async syncBatch(
    items: { clientId: string; entityType: OfflineEntityType; entityData: Record<string, any> }[],
    storeId: string,
  ): Promise<OfflineSyncResult[]> {
    // S-9：storeId 由客户端报文直接指定且此前无任何校验，任何人都能把离线单
    // 同步到任意门店（跨店污染库存与业绩）。服务端鉴权落地前，先做存在性校验。
    const resolvedStoreId = await this.resolveStoreId(storeId);

    // P1-6：有界并发处理（令牌桶）。结果按 items 索引顺序回填，保证与入参一一对应；
    // 单个 item 失败（processItem 内部已 try/catch 落 failed）不影响其余 item。
    // 每个 item 独立 return 其 {clientId, success,...} 即「流式 ack」——
    // 客户端分片后逐片取回，断网/崩溃仅丢未发片，已发片已落库且不重放（clientId 幂等）。
    return mapWithConcurrency(items, SYNC_CONCURRENCY, (item) =>
      this.processItem(item, resolvedStoreId),
    );
  }

  /**
   * S-9：把客户端传来的 storeId 收敛为「服务端已知存在的门店」。
   * 当前无会话态，退化为存在性校验 + 空值兜底；接入鉴权后应改为从登录态强制取值。
   */
  private async resolveStoreId(storeId?: string): Promise<string> {
    if (storeId) {
      const rows = await this.db
        .select({ id: posStore.id })
        .from(posStore)
        .where(eq(posStore.id, storeId))
        .limit(1);
      if (rows.length > 0) return rows[0].id;
      throw new NotFoundException(`门店不存在：${storeId}`);
    }
    // 未显式指定时回退到默认门店，避免出现 storeId 为空的孤儿单据
    const rows = await this.db
      .select({ id: posStore.id })
      .from(posStore)
      .orderBy(asc(posStore.id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('尚未配置任何门店，无法同步');
    }
    return rows[0].id;
  }

  private async processItem(
    item: { clientId: string; entityType: OfflineEntityType; entityData: Record<string, any> },
    storeId: string,
  ): Promise<OfflineSyncResult> {
    const { clientId, entityType, entityData } = item;

    // 检查是否已存在同 clientId 的队列记录
    const existingQueue = await this.db
      .select()
      .from(posOfflineQueue)
      .where(eq(posOfflineQueue.clientId, clientId));

    if (existingQueue.length > 0) {
      const existing = existingQueue[0];
      // 已同步成功，直接返回
      if (existing.syncStatus === 'synced') {
        return {
          clientId,
          success: true,
          serverEntityId: existing.serverEntityId ?? undefined,
        };
      }
      // 同步中：仅当「近期才进入 syncing」才视为并发，否则按超时回收。
      // S-8：进程在 syncing 途中崩溃会让该 clientId 永久卡死，离线单再也同步不上来。
      if (existing.syncStatus === 'syncing' && !this.isStale(existing.updatedAt)) {
        return {
          clientId,
          success: false,
          errorMessage: '正在同步中',
        };
      }
    }

    // 更新或创建队列记录为 syncing 状态
    let queueId: string;
    if (existingQueue.length > 0) {
      const [updated] = await this.db
        .update(posOfflineQueue)
        .set({
          syncStatus: 'syncing',
          retryCount: sql<number>`${posOfflineQueue.retryCount} + 1`,
          entityData,
        })
        .where(eq(posOfflineQueue.clientId, clientId))
        .returning({ id: posOfflineQueue.id });
      queueId = updated.id;
    } else {
      const [inserted] = await this.db
        .insert(posOfflineQueue)
        .values({
          storeId,
          clientId,
          entityType,
          entityData,
          syncStatus: 'syncing',
          retryCount: 0,
        })
        .returning({ id: posOfflineQueue.id });
      queueId = inserted.id;
    }

    try {
      let serverEntityId: string | undefined;

      switch (entityType) {
        case 'sale_order':
          serverEntityId = await this.processSaleOrder(entityData, storeId, clientId);
          break;
        case 'return_order':
          serverEntityId = await this.processReturnOrder(entityData, storeId, clientId);
          break;
        case 'member':
          serverEntityId = await this.processMember(entityData, storeId, clientId);
          break;
        case 'stock_adjust':
          serverEntityId = await this.processStockAdjust(entityData, storeId, clientId);
          break;
        case 'suspended_order':
          serverEntityId = await this.processSuspendedOrder(entityData, storeId, clientId);
          break;
        default:
          throw new Error(`不支持的实体类型: ${entityType}`);
      }

      // 更新队列为已同步
      await this.db
        .update(posOfflineQueue)
        .set({
          syncStatus: 'synced',
          serverEntityId,
          syncedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(posOfflineQueue.id, queueId));

      return {
        clientId,
        success: true,
        serverEntityId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // P1-3：主键/唯一冲突（Postgres SQLSTATE 23505，如 pos_suspended_order.client_id
      // 重复并发插入）视为「已被其他进程同步成功」，按幂等处理返回成功，避免离线重试被误判失败。
      const code = (error as { code?: string }).code;
      if (code === '23505' || /duplicate|unique constraint/i.test(errorMessage)) {
        this.logger.warn(`离线同步幂等命中 [${clientId}]，按已同步处理`);
        await this.db
          .update(posOfflineQueue)
          .set({ syncStatus: 'synced', errorMessage: null })
          .where(eq(posOfflineQueue.id, queueId));
        return { clientId, success: true, serverEntityId: undefined };
      }

      this.logger.error(`离线同步失败 [${clientId}]: ${errorMessage}`);

      // 更新队列为失败
      await this.db
        .update(posOfflineQueue)
        .set({
          syncStatus: 'failed',
          errorMessage,
        })
        .where(eq(posOfflineQueue.id, queueId));

      return {
        clientId,
        success: false,
        errorMessage,
      };
    }
  }

  private async processSaleOrder(
    data: Record<string, any>,
    storeId: string,
    clientId: string,
  ): Promise<string> {
    const dto: CreateSaleOrderDto = {
      ...data,
      storeId: data.storeId || storeId,
      clientId,
    } as CreateSaleOrderDto;
    const order = await this.salesService.createOrder(dto);
    return order.id;
  }

  private async processReturnOrder(
    data: Record<string, any>,
    storeId: string,
    clientId: string,
  ): Promise<string> {
    const dto: CreateReturnOrderDto = {
      ...data,
      storeId: data.storeId || storeId,
      clientId,
    } as CreateReturnOrderDto;
    const returnOrder = await this.returnsService.createReturn(dto);
    return returnOrder.id;
  }

  private async processMember(
    data: Record<string, any>,
    _storeId: string,
    clientId: string,
  ): Promise<string> {
    const dto: CreateMemberDto = {
      ...data,
      clientId,
    } as CreateMemberDto;
    const member = await this.membersService.createMember(dto);
    return member.id;
  }

  private async processStockAdjust(
    data: Record<string, any>,
    storeId: string,
    clientId: string,
  ): Promise<string> {
    const dto: StockAdjustDto = {
      ...data,
      storeId: data.storeId || storeId,
      clientId,
    } as StockAdjustDto;
    const result = await this.stockService.adjustStock(dto);
    return result.adjustNo;
  }

  private async processSuspendedOrder(
    data: Record<string, any>,
    storeId: string,
    clientId: string,
  ): Promise<string> {
    const dto: SuspendOrderDto = {
      ...data,
      storeId: data.storeId || storeId,
      clientId,
    } as SuspendOrderDto;
    const suspended = await this.salesService.suspendOrder(dto);
    return suspended.id;
  }

  async getQueue(query: OfflineQueueQuery): Promise<ListResponse<OfflineQueueItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posOfflineQueue.storeId, query.storeId));
    if (query.syncStatus) conditions.push(eq(posOfflineQueue.syncStatus, query.syncStatus));
    if (query.entityType) conditions.push(eq(posOfflineQueue.entityType, query.entityType));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posOfflineQueue)
        .where(whereClause),
      this.db
        .select()
        .from(posOfflineQueue)
        .where(whereClause)
        .orderBy(desc(posOfflineQueue.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapQueueItem(row)),
      total,
      page,
      pageSize,
    };
  }

  private mapQueueItem(row: typeof posOfflineQueue.$inferSelect): OfflineQueueItem {
    return {
      id: row.id,
      storeId: row.storeId,
      clientId: row.clientId,
      entityType: row.entityType as OfflineEntityType,
      entityData: row.entityData as Record<string, any>,
      syncStatus: row.syncStatus as OfflineQueueItem['syncStatus'],
      retryCount: row.retryCount,
      errorMessage: row.errorMessage ?? undefined,
      serverEntityId: row.serverEntityId ?? undefined,
      syncedAt: row.syncedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async retryItem(id: string): Promise<OfflineSyncResult> {
    const queueRows = await this.db
      .select()
      .from(posOfflineQueue)
      .where(eq(posOfflineQueue.id, id));

    if (queueRows.length === 0) {
      throw new NotFoundException('队列记录不存在');
    }

    const queue = queueRows[0];
    return this.processItem(
      {
        clientId: queue.clientId,
        entityType: queue.entityType as OfflineEntityType,
        entityData: queue.entityData as Record<string, any>,
      },
      queue.storeId,
    );
  }

  async getQueueStats(storeId: string): Promise<{
    pending: number;
    failed: number;
    synced: number;
    total: number;
  }> {
    const rows = await this.db
      .select({
        syncStatus: posOfflineQueue.syncStatus,
        count: count(),
      })
      .from(posOfflineQueue)
      .where(eq(posOfflineQueue.storeId, storeId))
      .groupBy(posOfflineQueue.syncStatus);

    const stats = { pending: 0, failed: 0, synced: 0, total: 0 };
    for (const row of rows) {
      const cnt = Number(row.count);
      stats.total += cnt;
      if (row.syncStatus === 'pending') stats.pending = cnt;
      else if (row.syncStatus === 'failed') stats.failed = cnt;
      else if (row.syncStatus === 'synced') stats.synced = cnt;
    }

    return stats;
  }

  async getMasterData(storeId: string, since?: string): Promise<MasterDataSnapshot> {
    const now = new Date();
    const version = now.getTime().toString();
    // P2-8：增量同步游标。客户端回传上一次 snapshotAt 作为 since，
    // 仅下发 updatedAt 晚于 since 的主数据，避免每次离线拉取全量（性能 + 带宽）。
    // store 作为本店锚点不过滤，确保始终能取到本店基础信息。
    // P-1：since 来自客户端查询串，时钟漂移/手工造脏值都可能传进非法日期。
    // Invalid Date 一旦进入 gt(col, ...) 会让整条 SQL 抛错并导致主数据拉取失败，
    // 这里降级为「按全量处理」——宁可多下发，不可让同步整条链路 500。
    const parsedSince = since ? new Date(since) : undefined;
    const sinceDate =
      parsedSince && !Number.isNaN(parsedSince.getTime()) ? parsedSince : undefined;
    if (since && !sinceDate) {
      this.logger.warn(`[OfflineSync] 非法 since 参数已忽略: ${since}`);
    }
    const sinceCond = (col: any) => (sinceDate ? gt(col, sinceDate) : undefined);

    // P-1 补（删除通知 / 墓碑）：
    // 增量同步只靠 `updatedAt > since` 拿到了「还在生效」的行，拿不到**失效**的行——
    // 软删除只置 `deleted_at`、状态流转（下架/停用）只改 `status`，两者都会让行退出
    // 原有业务过滤条件，而 `updatedAt` 已推进却无人消费 → 客户端本地长期残留已下架主数据。
    //
    // 解法（不引入墓碑表）：把查询放宽到「只按水位线取变更行、不做业务过滤」，
    // 再在内存里按业务口径分区 —— 命中业务口径 → 正常下发；未命中 → 计入 `deleted` 通知。
    // 宽口径 ⊇ 业务口径，因此「删除」与「状态流转」两类失效都能被同一条查询捕获。
    // 注意：这里必须用 rawDb 而不是 this.db。`scopeDatabase` 会往所有命中带 deletedAt
    // 表的查询里注入 `deletedAt IS NULL`——正是它把刚被软删除的行又过滤掉了，
    // 使删除通知永远为空。软删除作用域服务于业务读，不能用于水位扫描。
    const [
      storeRows,
      colors,
      sizes,
      styles,
      skus,
      promotions,
      members,
      stock,
    ] = await Promise.all([
      this.rawDb.select().from(posStore).where(eq(posStore.id, storeId)).limit(1),
      this.rawDb.select().from(posColor).where(sinceCond(posColor.updatedAt)).orderBy(asc(posColor.id)),
      this.rawDb.select().from(posSize).where(sinceCond(posSize.updatedAt)).orderBy(asc(posSize.sortOrder)),
      this.rawDb.select().from(posStyle).where(sinceCond(posStyle.updatedAt)),
      this.rawDb.select().from(posSku).where(sinceCond(posSku.updatedAt)),
      this.rawDb.select().from(posPromotion).where(sinceCond(posPromotion.updatedAt)),
      this.rawDb.select().from(posMember).where(sinceCond(posMember.updatedAt)),
      this.rawDb
        .select()
        .from(posStock)
        .where(and(eq(posStock.storeId, storeId), sinceCond(posStock.updatedAt))),
    ]);

    const store = storeRows[0];

    // 内存分区：命中业务口径 = 有效；未命中 = 失效（deletedAt 置位或状态流转）。
    // 全量快照（无 since）不产出删除通知——全量本身就是权威全量，客户端整体替换。
    const partition = <T extends { id: string; deletedAt: unknown }>(
      rows: readonly T[],
      isLive: (row: T) => boolean,
    ): { live: T[]; gone: string[] } => {
      if (!sinceDate) return { live: rows.filter(isLive), gone: [] };
      const live: T[] = [];
      const gone: string[] = [];
      for (const row of rows) {
        if (isLive(row)) live.push(row);
        else gone.push(row.id);
      }
      return { live, gone };
    };

    const notDeletedRow = <T extends { deletedAt: unknown }>(row: T): boolean =>
      row.deletedAt === null || row.deletedAt === undefined;

    const colorP = partition(colors, notDeletedRow);
    const sizeP = partition(sizes, notDeletedRow);
    const styleP = partition(styles, (s) => notDeletedRow(s) && s.status === 'on_sale');
    const skuP = partition(skus, notDeletedRow);
    const promoP = partition(promotions, (p) => notDeletedRow(p) && p.status === 'active');
    const memberP = partition(members, notDeletedRow);
    const stockP = partition(stock, notDeletedRow);

    // 只下发非空删除列表：空数组对客户端意味着「本轮无删除」，不得据此清空本地数据。
    const deletions: MasterDataDeletions = {} as MasterDataDeletions;
    const addDeleted = (key: keyof MasterDataDeletions, ids: string[]): void => {
      if (ids.length > 0) deletions[key] = ids;
    };
    addDeleted('colors', colorP.gone);
    addDeleted('sizes', sizeP.gone);
    addDeleted('styles', styleP.gone);
    addDeleted('skus', skuP.gone);
    addDeleted('promotions', promoP.gone);
    addDeleted('members', memberP.gone);
    addDeleted('stock', stockP.gone);
    const hasDeletions = Object.keys(deletions).length > 0;

    return {
      version,
      snapshotAt: now.toISOString(),
      colors: colorP.live.map((c) => ({
        id: c.id,
        name: c.name,
        hex: c.hex,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      sizes: sizeP.live.map((s) => ({
        id: s.id,
        sortOrder: s.sortOrder,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      styles: styleP.live.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        colorIds: s.colorIds ?? [],
        sizeIds: s.sizeIds ?? [],
        tagPrice: fromCents(Number(s.tagPrice)),
        costPrice: fromCents(Number(s.costPrice)),
        status: s.status,
        erpSyncAt: s.erpSyncAt?.toISOString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      skus: skuP.live.map((s) => ({
        id: s.id,
        styleId: s.styleId,
        colorId: s.colorId,
        sizeId: s.sizeId,
        barcode: s.barcode ?? undefined,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      promotions: promoP.live.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        threshold: p.threshold ? fromCents(Number(p.threshold)) : undefined,
        discountValue: p.discountValue ? fromCents(Number(p.discountValue)) : undefined,
        discountType: p.discountType ?? undefined,
        applyScope: p.applyScope,
        scopeIds: p.scopeIds ?? [],
        startDate: p.validFrom?.toISOString(),
        endDate: p.validTo?.toISOString(),
        priority: p.priority,
        isMemberOnly: p.isMemberOnly,
        source: p.source,
        erpSyncAt: undefined,
        memberLevel: undefined,
        conditions: undefined,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      members: memberP.live.map((m) => ({
        id: m.id,
        memberNo: m.memberNo,
        name: m.name ?? undefined,
        phone: m.phone,
        gender: m.gender ?? undefined,
        birthday: m.birthday ? new Date(m.birthday).toISOString().split('T')[0] : undefined,
        level: m.level,
        points: m.points,
        storedValue: fromCents(Number(m.storedValue)),
        preferSize: m.preferSize ?? undefined,
        preferStyle: m.preferStyle ?? undefined,
        totalSpent: fromCents(Number(m.totalSpent)),
        totalCount: m.totalCount,
        lastPurchaseAt: m.lastPurchaseAt?.toISOString(),
        erpSyncAt: m.erpSyncAt?.toISOString(),
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
      stock: stockP.live.map((s) => ({
        id: s.id,
        storeId: s.storeId,
        skuId: s.skuId,
        styleId: s.styleId,
        colorId: s.colorId,
        sizeId: s.sizeId,
        qty: s.qty,
        inTransitQty: s.inTransitQty,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      store: store
        ? { id: store.id, name: store.name, code: store.code }
        : { id: storeId, name: '', code: '' },
      // 无删除时该字段为 undefined，客户端按「本轮无删除」处理。
      ...(hasDeletions ? { deleted: deletions } : {}),
    };
  }
}
