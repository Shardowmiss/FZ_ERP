import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, gte, sql, or, isNull } from 'drizzle-orm';
import { posSession, posIdempotency, retailOrder, store } from '@server/database/schema';
import { RbacService } from '../rbac/rbac.service';
import { RetailService } from '../retail/retail.service';
import { PricingService } from '../pricing/pricing.service';
import { MoneyService } from '@server/common/services/money.service';
import { PayMethod, SessionStatus } from '@server/common/enums';
import type {
  OpenSessionDto,
  CloseSessionDto,
  PosCheckoutDto,
  PosQuoteDto,
} from './dto/pos.dto';
import type { PaginationResult, RetailPayMethod } from '@shared/api.interface';

/* ---------------- helpers ---------------- */

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- service ---------------- */

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly rbacService: RbacService,
    private readonly retailService: RetailService,
    private readonly pricingService: PricingService,
    private readonly money: MoneyService,
  ) {}

  /* ========== Session management ========== */

  async openSession(
    dto: OpenSessionDto,
    userId: string,
  ): Promise<{ id: string; existed: boolean }> {
    if (!dto.storeId) throw new BadRequestException('门店ID不能为空');
    if (dto.openAmount != null && num(dto.openAmount) < 0) {
      throw new BadRequestException('开班备用金不能为负数');
    }
    const storeRows = await this.db
      .select({ id: store.id, name: store.name })
      .from(store)
      .where(eq(store.id, dto.storeId))
      .limit(1);
    if (storeRows.length === 0) throw new NotFoundException('门店不存在');

    // 同一门店已存在未关班次时直接返回，避免重复开班
    const openRows = await this.db
      .select()
      .from(posSession)
      .where(and(eq(posSession.storeId, dto.storeId), eq(posSession.status, SessionStatus.OPEN)))
      .orderBy(desc(posSession.openTime))
      .limit(1);
    if (openRows.length > 0) {
      return { id: openRows[0].id, existed: true };
    }

    const inserted = await this.db
      .insert(posSession)
      .values({
        storeId: dto.storeId,
        storeName: storeRows[0].name,
        cashierId: userId,
        cashierName: dto.cashierName ?? null,
        openAmount: this.money.round2(dto.openAmount ?? 0),
        status: SessionStatus.OPEN,
      })
      .returning({ id: posSession.id });
    return { id: inserted[0].id, existed: false };
  }

  async getOpenSession(
    storeId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const scope = await this.rbacService.getUserDataScope(userId);
    if (scope.type === 'store' && !scope.storeIds.includes(storeId)) {
      throw new BadRequestException('无该门店数据权限');
    }
    const rows = await this.db
      .select()
      .from(posSession)
      .where(and(eq(posSession.storeId, storeId), eq(posSession.status, SessionStatus.OPEN)))
      .orderBy(desc(posSession.openTime))
      .limit(1);
    return rows.length > 0 ? (rows[0] as unknown as Record<string, unknown>) : null;
  }

  async closeSession(
    sessionId: string,
    dto: CloseSessionDto,
    userId: string,
  ): Promise<Record<string, unknown>> {
    if (dto.closeAmount != null && num(dto.closeAmount) < 0) {
      throw new BadRequestException('闭班实点现金不能为负数');
    }
    const rows = await this.db
      .select()
      .from(posSession)
      .where(eq(posSession.id, sessionId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('班次不存在');
    const session = rows[0];
    if (session.status === SessionStatus.CLOSED) throw new BadRequestException('班次已关闭');

    const scope = await this.rbacService.getUserDataScope(userId);
    if (scope.type === 'store' && !scope.storeIds.includes(session.storeId)) {
      throw new BadRequestException('无该门店数据权限');
    }

    // 现金对账：仅统计本班次零售单（pos_session_id 关联；历史无关联记录回退到门店+时间窗口）。
    // 应收现金 = 开班备用金 + 本班次现金收款 - 本班次找零。非现金支付不计入现金。
    const orderRows = await this.db
      .select({
        payMethods: retailOrder.payMethods,
        changeAmount: retailOrder.changeAmount,
      })
      .from(retailOrder)
      .where(
        or(
          eq(retailOrder.posSessionId, sessionId),
          and(
            isNull(retailOrder.posSessionId),
            eq(retailOrder.storeId, session.storeId),
            gte(retailOrder.createdAt, session.openTime),
          ),
        ),
      );

    let cashReceived = 0;
    let cashChange = 0;
    for (const o of orderRows) {
      const methods = (o.payMethods as unknown as Array<{ method: string; amount: string }>) ?? [];
      for (const m of methods) {
        if (m.method === PayMethod.CASH) cashReceived += num(m.amount);
      }
      cashChange += num(o.changeAmount);
    }

    const openAmount = num(session.openAmount);
    const closeAmount = num(dto.closeAmount);
    const expectedAmount = openAmount + cashReceived - cashChange;
    const difference = closeAmount - expectedAmount;

    const updated = await this.db
      .update(posSession)
      .set({
        closeTime: new Date(),
        closeAmount: this.money.round2(closeAmount),
        expectedAmount: this.money.round2(expectedAmount),
        difference: this.money.round2(difference),
        status: SessionStatus.CLOSED,
      })
      .where(eq(posSession.id, sessionId))
      .returning();
    return updated[0] as unknown as Record<string, unknown>;
  }

  async listSessions(params: {
    userId: string;
    page: number;
    pageSize: number;
    storeId?: string;
    status?: string;
  }): Promise<PaginationResult<Record<string, unknown>>> {
    const { userId, page, pageSize, storeId, status } = params;
    const scope = await this.rbacService.getUserDataScope(userId);

    const conditions = [];
    if (scope.type === 'store' && scope.storeIds.length > 0) {
      conditions.push(sql`${posSession.storeId} IN ${scope.storeIds}`);
    }
    if (storeId) conditions.push(eq(posSession.storeId, storeId));
    if (status) conditions.push(eq(posSession.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(posSession).where(where as any),
      this.db
        .select()
        .from(posSession)
        .where(where as any)
        .orderBy(desc(posSession.openTime))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows as unknown as Record<string, unknown>[],
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  /* ========== Checkout (收银结算) ========== */

  /** 探测门店当前未关班次 ID（用于自动关联零售单与班次）。 */
  private async findOpenSession(storeId: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: posSession.id })
      .from(posSession)
      .where(and(eq(posSession.storeId, storeId), eq(posSession.status, SessionStatus.OPEN)))
      .orderBy(desc(posSession.openTime))
      .limit(1);
    return rows.length > 0 ? rows[0].id : null;
  }

  /**
   * 一站式收银：批量计价（价格表 + 单品/整单促销）-> 生成零售草稿（关联班次）-> 结算。
   * 计价复用 PricingService.quote（一次查询多商品，消除逐行 N+1），结算复用 RetailService。
   */
  async checkout(dto: PosCheckoutDto, userId: string): Promise<Record<string, unknown>> {
    // 参数校验（在幂等占位之前，避免无效请求占用 key）
    if (!dto.storeId) throw new BadRequestException('门店ID不能为空');
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('购物车不能为空');
    }
    for (const it of dto.items) {
      if (!it.skuId && !it.skuCode) {
        throw new BadRequestException('商品必须提供 skuId 或 skuCode');
      }
      if (!it.quantity || it.quantity <= 0) {
        throw new BadRequestException('商品数量必须大于0');
      }
    }

    // 幂等：相同 idempotencyKey 的并发/重试只执行一次，直接返回首次结算结果，
    // 避免网络重试造成重复零售单 + 重复扣库存。
    return this.withIdempotency(dto.idempotencyKey, 'pos_checkout', async () => {
      const scope = await this.rbacService.getUserDataScope(userId);
      if (scope.type === 'store' && !scope.storeIds.includes(dto.storeId)) {
        throw new BadRequestException('无该门店数据权限');
      }

      const storeRows = await this.db
        .select({ id: store.id, name: store.name })
        .from(store)
        .where(eq(store.id, dto.storeId))
        .limit(1);
      if (storeRows.length === 0) throw new NotFoundException('门店不存在');

      // 批量计价：一次查询得到每行售价 + 整单满减 + 应付，保证前端展示与后端结算完全一致
      const quote = await this.pricingService.quote({
        storeId: dto.storeId,
        items: dto.items.map((i) => ({
          skuId: i.skuId,
          skuCode: i.skuCode,
          quantity: i.quantity,
        })),
      });

      const retailItems = quote.items.map((q) => ({
        skuId: q.skuId,
        quantity: q.quantity,
        dealPrice: q.finalPrice,
        discountRate: q.tagPrice > 0 ? Number((q.finalPrice / q.tagPrice).toFixed(4)) : 1,
      }));

      // 创建零售草稿
      const draft = await this.retailService.createDraftRetail(
        {
          storeId: dto.storeId,
          saleDate: new Date().toISOString().slice(0, 10),
          cashierName: dto.cashierName,
          memberId: dto.memberId,
          source: 'store_pos',
          items: retailItems,
          remark: dto.remark,
        },
        userId,
      );

      // 整单级促销（满减）：基于权威报价的 discountAmount 推导整单折扣率，整单只应用一次
      let wholeDiscount: number | undefined = dto.wholeDiscount;
      if (wholeDiscount === undefined && quote.discountAmount > 0 && quote.subtotal > 0) {
        if (quote.discountAmount < quote.subtotal) {
          wholeDiscount = Number(this.money.round2((quote.subtotal - quote.discountAmount) / quote.subtotal));
        }
      }

      // 关联收银班次：优先用前端传入的 sessionId，否则自动探测当前未关班次。
      // 班次关联并入结算事务（settleRetailOrder 内部），避免游离的单笔 update 在结算失败后仍残留关联。
      const sessionId = dto.sessionId ?? (await this.findOpenSession(dto.storeId));

      // 结算（班次关联在结算事务内一并写入）
      const settled = await this.retailService.settleRetailOrder(
        draft.id,
        {
          payMethods: dto.payMethods.map((p) => ({ method: p.method, amount: String(p.amount) })),
          receivedAmount: dto.receivedAmount,
          wholeDiscount,
        },
        userId,
        sessionId ?? undefined,
      );

      return settled as unknown as Record<string, unknown>;
    });
  }

  /**
   * 幂等执行包装器（防重复执行）。
   * - key 为空：直接执行（向后兼容，无幂等保护）。
   * - key 非空：已完成的直接返回结果（覆盖网络重试主场景）；
   *   否则占位（唯一约束 (key,bizType) 拦截并发重复），执行成功后回填结果；
   *   执行失败则清除占位，允许客户端用同一 key 重试。
   */
  /** jsonb 在部分驱动下会以字符串读回，这里统一解析为对象，保证“返回首次结果”语义一致。 */
  private parseResult<T>(v: unknown): T {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as T;
      }
    }
    return v as T;
  }

  private async withIdempotency<T>(
    key: string | undefined,
    bizType: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key) return fn();

    // 已完成？直接返回，避免重复执行
    const [done] = await this.db
      .select()
      .from(posIdempotency)
      .where(
        and(
          eq(posIdempotency.key, key),
          eq(posIdempotency.bizType, bizType),
          eq(posIdempotency.status, 'done'),
        ),
      )
      .limit(1);
    if (done) return this.parseResult<T>(done.result);

    // 占位（并发重复键由唯一约束拦截）
    try {
      await this.db.insert(posIdempotency).values({ key, bizType, status: 'processing' });
    } catch (e: any) {
      // 兼容 drizzle 包裹后错误码在顶层或 cause 的情形
      const code = e?.code ?? e?.cause?.code;
      const msg = String(e?.message ?? '');
      if (code === '23505' || /duplicate key|unique constraint/i.test(msg)) {
        // 另一请求已占位，轮询等待其完成结果
        return this.pollIdempotency<T>(key, bizType);
      }
      throw e;
    }

    try {
      const result = await fn();
      await this.db
        .update(posIdempotency)
        .set({ status: 'done', result: result as any })
        .where(
          and(eq(posIdempotency.key, key), eq(posIdempotency.bizType, bizType)),
        );
      return result;
    } catch (e) {
      // 业务失败：清除占位，允许客户端用同一 key 重试
      await this.db
        .delete(posIdempotency)
        .where(
          and(
            eq(posIdempotency.key, key),
            eq(posIdempotency.bizType, bizType),
            eq(posIdempotency.status, 'processing'),
          ),
        );
      throw e;
    }
  }

  /** 轮询等待并发占位请求完成（最多 ~5s），超时视为仍在处理中。 */
  private async pollIdempotency<T>(key: string, bizType: string): Promise<T> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await this.db
        .select()
        .from(posIdempotency)
        .where(
          and(eq(posIdempotency.key, key), eq(posIdempotency.bizType, bizType)),
        )
        .limit(1);
      if (row?.status === 'done') return this.parseResult<T>(row.result);
      if (!row || row.status === 'error') break; // 占位已释放，退出轮询
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new ConflictException('结算正在处理中，请稍候或稍后重试');
  }

  /* ========== Quote (报价/优惠预览) ========== */

  /** 供前端展示：返回购物车每行售价、整单满减、应付金额。 */
  async quote(dto: PosQuoteDto, userId: string) {
    const scope = await this.rbacService.getUserDataScope(userId);
    if (scope.type === 'store' && !scope.storeIds.includes(dto.storeId)) {
      throw new BadRequestException('无该门店数据权限');
    }
    return this.pricingService.quote({ storeId: dto.storeId, items: dto.items });
  }
}
