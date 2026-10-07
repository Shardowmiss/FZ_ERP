import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, sql, inArray, desc, like } from 'drizzle-orm';
import {
  store,
  warehouse,
  posStoreMap,
  posReceiveLog,
  posReturn,
  posReturnItem,
  posRequisition,
  posRequisitionItem,
  posDailySettle,
  retailOrder,
  retailOrderItem,
  retailReturn,
  retailReturnItem,
  inventoryStocktake,
  inventoryStocktakeItem,
  sku,
} from '@server/database/schema';
import { bulkInsert } from '@server/common/batch';
import { randomUUID } from 'node:crypto';
import { MemberWalletService } from '@server/modules/member/member-wallet.service';
import { StockService } from '@server/modules/inventory/stock/stock.service';
import type {
  PosSalesPayload,
  PosStocktakePayload,
  PosReturnPayload,
  PosReturnItemPayload,
  PosRequisitionPayload,
  PosEodPayload,
  PosReceiveResult,
} from './dto/pos-receiver.dto';

type Tx = PostgresJsDatabase;

interface ResolvedStore {
  storeId: string;
  storeName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v: unknown): string {
  if (!v) throw new BadRequestException('日期字段缺失');
  // 接受 'YYYY-MM-DD' / 时间戳字符串 / Date
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`非法日期: ${String(v)}`);
  }
  return d.toISOString().slice(0, 10);
}

function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; cause?: { code?: string }; message?: string };
  const code = err.code ?? err.cause?.code;
  if (code === '23505') return true;
  return !!err.message && /duplicate key/i.test(err.message);
}

/**
 * 拼接上行零售单的 remark：业务备注 + POS 原始单号留痕。
 *
 * POS 退货上行时需按原销售单定位 ERP 零售单，pos_receive_log 虽可反查，
 * 但零售单自身留痕 POS 单号可让双向对账、退货对账与报表口径都无需跨表联查。
 * 格式固定为 `[POS:{posDocNo}]`，解析见 extractPosOrderNoFromRemark。
 */
function buildSalesRemark(remark: unknown, posDocNo: string): string {
  const base = remark ? String(remark) : '';
  const tag = `[POS:${posDocNo}]`;
  return base ? `${tag} ${base}` : tag;
}

/** 从零售单 remark 中提取 POS 原始单号；非上行单据返回 null */
export function extractPosOrderNoFromRemark(remark: string | null | undefined): string | null {
  if (!remark) return null;
  const m = remark.match(/^\[POS:([^\]]+)\]/);
  return m ? m[1] : null;
}

@Injectable()
export class PosReceiverService {
  private readonly logger = new Logger(PosReceiverService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly walletService: MemberWalletService,
    private readonly stockService: StockService,
  ) {}

  /* ---------------- S3 会员钱包：POS 上行积分/储值事件入账 ---------------- */

  /**
   * 【S3】接收 POS 上行的会员钱包变动事件（积分 / 储值），由 ERP 统一入账。
   *
   * 为什么需要它：POS 销售单走 receiveSales 建的是 status='completed' 的 retail_order，
   * **不经过 settleRetailOrder**，所以 ERP 侧根本不会为门店消费加积分；
   * 而 POS 本地又各自累加一份 → 两端各记一套。此端点把门店每笔变动收编为幂等事件。
   *
   * 幂等：以 eventKey 唯一索引为准，同一事件重放/重试只入账一次（返回 duplicated=true）。
   */
  async receiveWalletEvent(body: {
    eventKey: string;
    memberId: string;
    kind: string;
    changeValue: number;
    sourceType: string;
    sourceNo?: string;
    storeCode?: string;
  }) {
    if (!body?.eventKey) throw new BadRequestException('eventKey 必填（幂等键）');
    if (!body?.memberId) throw new BadRequestException('memberId 必填（ERP 会员主键）');
    if (body?.kind !== 'points' && body?.kind !== 'stored_value') {
      throw new BadRequestException("kind 必须为 'points' 或 'stored_value'");
    }
    if (typeof body?.changeValue !== 'number' || Number.isNaN(body.changeValue)) {
      throw new BadRequestException('changeValue 必须为数字（可为负）');
    }

    const r = await this.walletService.applyWalletEvent({
      eventKey: body.eventKey,
      memberId: body.memberId,
      kind: body.kind,
      changeValue: body.changeValue,
      sourceType: body.sourceType ?? 'adjust',
      sourceNo: body.sourceNo,
      storeCode: body.storeCode,
    });

    // rejected 不是异常：业务上不可重试（会员未同步/储值透支），需由运营对账补单
    if (r.status === 'rejected') {
      this.logger.warn(`[S3] 钱包事件被拒 eventKey=${r.eventKey} reason=${r.message}`);
    }
    return r;
  }

  /* ---------------- 门店解析：POS storeCode → ERP store / warehouse ---------------- */

  /* ---------------- SKU 解析：skuCode → ERP sku.id（批量，N+1 安全） ---------------- */

  private async resolveSkuMap(
    tx: Tx,
    codes: string[],
  ): Promise<Map<string, string>> {
    const uniq = [...new Set(codes.filter(Boolean))];
    if (uniq.length === 0) return new Map();
    const rows = await tx
      .select({ id: sku.id, code: sku.skuCode })
      .from(sku)
      .where(inArray(sku.skuCode, uniq));
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  private async resolveStore(
    tx: Tx,
    storeCode: string,
    fallbackName?: string,
  ): Promise<ResolvedStore> {
    if (!storeCode) throw new BadRequestException('storeCode 缺失');

    // 1) 优先走主数据映射 pos_store_map
    const mapRows = await tx
      .select({ storeId: posStoreMap.storeId, storeName: posStoreMap.storeName })
      .from(posStoreMap)
      .where(eq(posStoreMap.storeCode, storeCode))
      .limit(1);

    // 2) 回退：store.code 直接匹配
    const codeRows =
      mapRows.length === 0
        ? await tx
            .select({ storeId: store.id, storeName: store.name })
            .from(store)
            .where(eq(store.code, storeCode))
            .limit(1)
        : [];

    const storeId = mapRows[0]?.storeId ?? codeRows[0]?.storeId;
    if (!storeId) {
      throw new BadRequestException(`无法解析门店编码: ${storeCode}`);
    }

    const storeRows = await tx
      .select({
        id: store.id,
        name: store.name,
        warehouseId: store.warehouseId,
      })
      .from(store)
      .where(eq(store.id, storeId))
      .limit(1);

    let warehouseId: string | null = storeRows[0]?.warehouseId ?? null;
    let warehouseName: string | null = null;
    if (warehouseId) {
      const wh = await tx
        .select({ name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, warehouseId))
        .limit(1);
      warehouseName = wh[0]?.name ?? null;
    }

    return {
      storeId,
      storeName: storeRows[0]?.name ?? mapRows[0]?.storeName ?? fallbackName ?? null,
      warehouseId,
      warehouseName,
    };
  }

  /* ---------------- ERP 单号生成（幂等序列） ---------------- */

  private async nextErpNo(tx: Tx, prefix: string): Promise<string> {
    const rows = (await tx.execute(
      sql`SELECT to_char(now(), 'YYYYMMDD') AS d, nextval('pos_receiver_seq')::int AS s`,
    )) as unknown as Array<{ d: string; s: number }>;
    const row = rows[0];
    return `${prefix}${row.d}${String(row.s).padStart(5, '0')}`;
  }

  /* ---------------- 通用幂等骨架（失败可补偿） ---------------- */

  /**
   * 幂等接收骨架，保证"处理失败有痕、可重放"：
   * 1) 预检仅对 status='success' 短路（pending/failed 允许重处理）；
   * 2) erpNo 在主事务外生成，pending 日志行在主事务【外】独立落库；
   * 3) 主事务内执行 build() + 标 success；若 build 抛错，独立 UPDATE
   *    将日志标 failed 并写入 error_message（保留 payload 供重放）；
   * 4) 并发首推唯一约束冲突时，按 success 重查返回，避免重复落库。
   */
  private async receive<T extends PosReceiveResult>(
    bizType: string,
    posDocNo: string,
    payload: unknown,
    build: (tx: Tx, erpNo: string) => Promise<void>,
  ): Promise<T> {
    // 1) 预检（事务外）：仅 success 视为重复，直接返回缓存 erpNo
    const existing = await this.db
      .select({ erpNo: posReceiveLog.erpNo, status: posReceiveLog.status })
      .from(posReceiveLog)
      .where(
        and(
          eq(posReceiveLog.bizType, bizType),
          eq(posReceiveLog.posDocNo, posDocNo),
        ),
      )
      .limit(1);
    if (existing.length && existing[0].status === 'success') {
      this.logger.warn(`[POS接收] 重复推送 ${bizType}/${posDocNo}，幂等返回`);
      return {
        success: true,
        erpNo: existing[0].erpNo ?? undefined,
        duplicated: true,
      } as T;
    }

    // 2) erpNo 在主事务外生成（序列）
    let erpNo: string;
    try {
      erpNo = await this.nextErpNo(this.db, this.prefixOf(bizType));
    } catch (e) {
      this.logger.error(`[POS接收] ${bizType}/${posDocNo} 生成单号失败: ${this.msg(e)}`);
      throw e;
    }

    // 3) 在主事务【外】独立落 pending 日志（含 payload，供重放）；并发首推走 upsert
    try {
      await this.db
        .insert(posReceiveLog)
        .values({ bizType, posDocNo, erpNo, status: 'pending', payload })
        .onConflictDoUpdate({
          target: [posReceiveLog.bizType, posReceiveLog.posDocNo],
          set: { erpNo, status: 'pending', payload, errorMessage: null },
        });
    } catch (e) {
      if (isUniqueViolation(e)) {
        // 并发首推：对方已落库，按 success 重查返回
        const ex = await this.db
          .select({ erpNo: posReceiveLog.erpNo, status: posReceiveLog.status })
          .from(posReceiveLog)
          .where(
            and(
              eq(posReceiveLog.bizType, bizType),
              eq(posReceiveLog.posDocNo, posDocNo),
            ),
          )
          .limit(1);
        if (ex.length && ex[0].status === 'success') {
          return { success: true, erpNo: ex[0].erpNo ?? undefined, duplicated: true } as T;
        }
        // 否则交由下方主事务再次 upsert 处理
      } else {
        throw e;
      }
    }

    // 4) 主事务：build + 标 success；失败则独立 UPDATE 标 failed 并留存错误
    try {
      await this.db.transaction(async (tx) => {
        await build(tx, erpNo);
        await tx
          .update(posReceiveLog)
          .set({ erpNo, status: 'success' })
          .where(
            and(
              eq(posReceiveLog.bizType, bizType),
              eq(posReceiveLog.posDocNo, posDocNo),
            ),
          );
      });
      this.logger.log(`[POS接收] ${bizType} 落地 ERP单号=${erpNo}`);
      return { success: true, erpNo, duplicated: false } as T;
    } catch (e) {
      const errMsg = this.msg(e);
      // 失败持久化（独立事务，必须落库以供补偿）
      await this.db
        .update(posReceiveLog)
        .set({ status: 'failed', errorMessage: errMsg })
        .where(
          and(
            eq(posReceiveLog.bizType, bizType),
            eq(posReceiveLog.posDocNo, posDocNo),
          ),
        )
        .catch(() => {
          /* 补偿层尽力而为，失败不影响对外响应 */
        });
      this.logger.error(`[POS接收] ${bizType}/${posDocNo} 处理失败: ${errMsg}`);
      throw e;
    }
  }

  private msg(e: unknown): string {
    if (!e) return '未知错误';
    if (e instanceof Error) return e.message;
    if (typeof e === 'object') return JSON.stringify(e).slice(0, 500);
    return String(e);
  }

  private prefixOf(bizType: string): string {
    switch (bizType) {
      case 'sales':
        return 'RT';
      case 'stocktakes':
        return 'STK';
      case 'returns':
        return 'PR';
      case 'transfer_requests':
        return 'PRQ';
      case 'eod':
        return 'PDS';
      default:
        return 'P';
    }
  }

  /* ============================ 5 类单据接收 ============================ */

  receiveSales(payload: PosSalesPayload): Promise<PosReceiveResult> {
    const storeCode = String(payload.storeCode ?? payload.store_code ?? '');
    const posDocNo = String(payload.orderNo ?? payload.order_no ?? '');
    if (!posDocNo) throw new BadRequestException('orderNo 缺失');
    return this.receive('sales', posDocNo, payload, async (tx, erpNo) => {
      const resolved = await this.resolveStore(
        tx,
        storeCode,
        payload.storeName ?? payload.store_name,
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      // 批量解析 skuCode → ERP sku.id（销售明细 sku_id 非空，未知 SKU 拒绝落库）
      const codes = items.map((it) => String(it.skuCode ?? it.sku_code ?? '')).filter(Boolean);
      const skuMap = await this.resolveSkuMap(tx, codes);
      const missing = codes.filter((c) => !skuMap.has(c));
      if (missing.length) {
        throw new BadRequestException(`未知SKU（需先在ERP维护）: ${missing.join(',')}`);
      }
      const id = randomUUID();
      await tx.insert(retailOrder).values({
        id,
        retailNo: erpNo,
        storeId: resolved.storeId,
        storeName: resolved.storeName ?? String(payload.storeName ?? ''),
        saleDate: toDate(payload.saleDate ?? payload.sale_date),
        cashierName: payload.cashierName ? String(payload.cashierName) : null,
        memberId: payload.memberId ? String(payload.memberId) : null,
        source: 'store_pos', // 受 ck_retail_order_source 约束，取值白名单内
        totalAmount: String(num(payload.totalAmount ?? payload.total_amount)),
        discountAmount: String(num(payload.discountAmount ?? payload.discount_amount)),
        receivableAmount: String(num(payload.receivableAmount ?? payload.receivable_amount)),
        receivedAmount: String(num(payload.receivedAmount ?? payload.received_amount)),
        changeAmount: String(num(payload.changeAmount ?? payload.change_amount)),
        payMethods:
          (payload.payMethods ?? payload.pay_methods ?? []) as unknown as object,
        itemCount: items.length,
        // 受 ck_retail_order_status 约束（迁移 0054 收紧为
        // draft/settled/returned/refunded）。POS 上行的是**已结算**零售单，
        // 故用 settled 而非历史的 completed——后者已被约束拒绝，会导致上行全盘失败。
        status: 'settled',
        // 留痕 POS 原始单号：便于双向对账与后续 POS 退货按原单定位
        // （pos_receive_log 亦可反查，但零售单自身留痕更利于排查与报表）。
        remark: buildSalesRemark(payload.remark, posDocNo),
      });
      if (items.length) {
        await bulkInsert(
          tx,
          retailOrderItem,
          items.map((it) => ({
            id: randomUUID(),
            retailId: id,
            skuId: skuMap.get(String(it.skuCode ?? it.sku_code ?? '')) ?? null,
            skuCode: String(it.skuCode ?? it.sku_code ?? ''),
            styleNo: String(it.styleNo ?? it.style_no ?? ''),
            color: it.color ?? null,
            size: it.size ?? null,
            quantity: String(num(it.quantity)),
            tagPrice: String(num(it.tagPrice ?? it.tag_price)),
            dealPrice: String(num(it.dealPrice ?? it.deal_price)),
            discountRate:
              it.discountRate != null ? String(it.discountRate) : null,
            lineAmount: String(num(it.lineAmount ?? it.line_amount)),
          })),
        );
      }
    });
  }

  receiveStocktake(payload: PosStocktakePayload): Promise<PosReceiveResult> {
    const storeCode = String(payload.storeCode ?? payload.store_code ?? '');
    const posDocNo = String(payload.stocktakeNo ?? payload.stocktake_no ?? '');
    if (!posDocNo) throw new BadRequestException('stocktakeNo 缺失');
    return this.receive('stocktakes', posDocNo, payload, async (tx, erpNo) => {
      const resolved = await this.resolveStore(tx, storeCode);
      if (!resolved.warehouseId) {
        throw new BadRequestException(`门店 ${storeCode} 未关联仓库，无法落盘点单`);
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      const stkCodes = items.map((it) => String(it.skuCode ?? it.itemCode ?? it.item_code ?? '')).filter(Boolean);
      const stkSkuMap = await this.resolveSkuMap(tx, stkCodes);
      const id = randomUUID();
      await tx.insert(inventoryStocktake).values({
        id,
        stocktakeNo: erpNo,
        warehouseId: resolved.warehouseId,
        warehouseName: resolved.warehouseName ?? '',
        stocktakeDate: toDate(payload.stocktakeDate ?? payload.stocktake_date),
        itemType: 'sku', // 受 ck_inventory_stocktake_item_type 约束
        // 受 ck_inventory_stocktake_status 约束（迁移 0056 收紧为
        // draft/approved/posted）。POS 上行的是门店**已完成**盘点并已调账的结果，
        // 故直接落终态 posted，跳过 ERP 侧的草稿→审核→过账流程。
        status: 'posted',
        remark: payload.remark ? String(payload.remark) : null,
      });
      if (items.length) {
        await bulkInsert(
          tx,
          inventoryStocktakeItem,
          items.map((it) => {
            const book = num(it.bookQty ?? it.book_qty);
            const actual = num(it.actualQty ?? it.actual_qty);
            return {
              id: randomUUID(),
              stocktakeId: id,
              skuId: stkSkuMap.get(String(it.skuCode ?? it.itemCode ?? it.item_code ?? '')) ?? null,
              itemCode: String(
                it.skuCode ?? it.itemCode ?? it.item_code ?? '',
              ),
              itemName: String(
                it.skuName ?? it.itemName ?? it.item_name ?? it.skuCode ?? '',
              ),
              color: it.color ?? null,
              size: it.size ?? null,
              bookQty: String(book),
              actualQty: String(actual),
              diffQty: String(actual - book),
            };
          }),
        );
      }
    });
  }

  receiveReturns(payload: PosReturnPayload): Promise<PosReceiveResult> {
    const storeCode = String(payload.storeCode ?? payload.store_code ?? '');
    const posDocNo = String(payload.returnNo ?? payload.return_no ?? '');
    if (!posDocNo) throw new BadRequestException('returnNo 缺失');
    return this.receive('returns', posDocNo, payload, async (tx, erpNo) => {
      const resolved = await this.resolveStore(tx, storeCode);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const id = randomUUID();
      await tx.insert(posReturn).values({
        id,
        returnNo: erpNo,
        posOrderNo: payload.posOrderNo ?? payload.pos_order_no ?? null,
        storeCode,
        storeId: resolved.storeId,
        storeName: resolved.storeName,
        returnDate: toDate(payload.returnDate ?? payload.return_date),
        totalAmount: String(num(payload.totalAmount ?? payload.total_amount)),
        reason: payload.reason ? String(payload.reason) : null,
        status: 'received',
        remark: payload.remark ? String(payload.remark) : null,
      });
      if (items.length) {
        await bulkInsert(
          tx,
          posReturnItem,
          items.map((it) => ({
            id: randomUUID(),
            returnId: id,
            skuCode: String(it.skuCode ?? it.sku_code ?? ''),
            styleNo: String(it.styleNo ?? it.style_no ?? ''),
            color: it.color ?? null,
            size: it.size ?? null,
            quantity: String(num(it.quantity)),
            price: String(num(it.price)),
            amount: String(num(it.amount)),
            batchNo: it.batchNo ?? it.batch_no ?? null,
          })),
        );
      }

      /* --------- 接入 ERP 真实零售退货体系（本次打通的核心） ---------
       * 此前 POS 退货只落 pos_return 影子表：库存不回库、退货金额不进零售报表，
       * 导致「门店卖了又退」这条链路在 ERP 侧完全不可见。
       * 现在额外生成真实 retail_return + retail_return_item（迁移 0057），
       * 并通过 StockService 把货回补到门店仓，使零售退货闭环。
       *
       * 定位原零售单的顺序：
       *   ① 直接按 POS 销售单号反查 pos_receive_log（权威映射）
       *   ② 兜底按 [POS:xxx] 标记扫零售单 remark（兼容历史数据）
       * 定位不到则跳过真实退货落库，仅保留影子记录——不因单笔缺原单而整体失败。
       */
      const posOrderNo = String(payload.posOrderNo ?? payload.pos_order_no ?? '');
      if (posOrderNo && resolved.warehouseId) {
        const original = await this.resolveOriginalRetailByPosOrderNo(tx, posOrderNo);
        if (original) {
          await this.buildRealRetailReturn(tx, {
            erpNo,
            posReturnNo: posDocNo,
            originalRetail: original,
            storeId: resolved.storeId,
            storeName: resolved.storeName ?? '',
            warehouseId: resolved.warehouseId,
            warehouseName: resolved.warehouseName ?? '',
            returnDate: toDate(payload.returnDate ?? payload.return_date),
            totalAmount: num(payload.totalAmount ?? payload.total_amount),
            reason: payload.reason ? String(payload.reason) : null,
            remark: payload.remark ? String(payload.remark) : null,
            items,
          });
        } else {
          this.logger.warn(
            `[POS接收] 退货 ${posDocNo} 未找到原销售单 ${posOrderNo}，仅落影子表 pos_return`,
          );
        }
      }
    });
  }

  /**
   * 按 POS 销售单号反查 ERP 零售单。
   * 优先走 pos_receive_log 的权威映射；兜底扫 remark 的 [POS:xxx] 标记。
   */
  private async resolveOriginalRetailByPosOrderNo(
    tx: Tx,
    posOrderNo: string,
  ): Promise<typeof retailOrder.$inferSelect | undefined> {
    const [mapped] = await tx
      .select({ erpNo: posReceiveLog.erpNo })
      .from(posReceiveLog)
      .where(
        and(
          eq(posReceiveLog.bizType, 'sales'),
          eq(posReceiveLog.posDocNo, posOrderNo),
          eq(posReceiveLog.status, 'success'),
        ),
      )
      .limit(1);
    if (mapped?.erpNo) {
      const [row] = await tx
        .select()
        .from(retailOrder)
        .where(eq(retailOrder.retailNo, mapped.erpNo))
        .limit(1);
      if (row) return row;
    }
    // 兜底：按 remark 标记匹配（上行 sales 自迁移 0058 起写入该标记）
    const candidates = await tx
      .select()
      .from(retailOrder)
      .where(like(retailOrder.remark, `[POS:${posOrderNo}]%`))
      .limit(1);
    return candidates[0];
  }

  /**
   * 生成真实零售退货单 + 明细，并把货回补到门店仓库存。
   *
   * 与 ERP 侧 retail.service.refundReturn 的差别：POS 上行的是**已完成的退货**
   * （门店已收银退款、货已确认returned），故直接落终态 refunded 并即时回库，
   * 不再走 ERP 的 draft → refundReturn 两步流程，避免门店端二次审核。
   */
  private async buildRealRetailReturn(
    tx: Tx,
    ctx: {
      erpNo: string;
      posReturnNo: string;
      originalRetail: typeof retailOrder.$inferSelect;
      storeId: string;
      storeName: string;
      warehouseId: string;
      warehouseName: string;
      returnDate: string;
      totalAmount?: number | string;
      reason: string | null;
      remark: string | null;
      items: PosReturnItemPayload[];
    },
  ): Promise<void> {
    const { originalRetail, items, warehouseId, warehouseName } = ctx;

    // 取原零售明细，按 SKU 匹配退货行；匹配不到的行仍写入（保留原始行项目）
    const originalItems = await tx
      .select()
      .from(retailOrderItem)
      .where(eq(retailOrderItem.retailId, originalRetail.id));
    const origBySku = new Map(
      originalItems.map((i) => [`${i.skuCode}|${i.color ?? ''}|${i.size ?? ''}`, i]),
    );
    const origByCode = new Map(originalItems.map((i) => [i.skuCode, i]));

    const returnId = randomUUID();
    await tx.insert(retailReturn).values({
      id: returnId,
      returnNo: ctx.erpNo,
      originalRetailId: originalRetail.id,
      originalRetailNo: originalRetail.retailNo,
      storeId: ctx.storeId,
      storeName: ctx.storeName,
      returnDate: ctx.returnDate,
      totalAmount: String(num(ctx.totalAmount ?? 0) || this.sumReturnAmount(items)),
      refundMethods: [],
      // 门店已完成退款，直接落终态（ck_retail_return_status 为 28 值模板，含 refunded）
      status: 'refunded',
      remark: `[POS:${ctx.posReturnNo}] ${ctx.remark ?? ''}`.trim(),
    });

    const detailRows = items.map((it) => {
      const skuCode = String(it.skuCode ?? it.sku_code ?? '');
      const color = it.color ?? null;
      const size = it.size ?? null;
      const orig =
        origBySku.get(`${skuCode}|${color ?? ''}|${size ?? ''}`) ?? origByCode.get(skuCode);
      const qty = num(it.quantity);
      const deal = orig?.dealPrice != null ? Number(orig.dealPrice) : null;
      return {
        id: randomUUID(),
        returnId,
        retailItemId: orig?.id ?? null,
        skuId: orig?.skuId ?? null,
        skuCode,
        styleNo: String(it.styleNo ?? it.style_no ?? orig?.styleNo ?? ''),
        color: color ?? orig?.color ?? null,
        size: size ?? orig?.size ?? null,
        quantity: String(qty),
        tagPrice: orig?.tagPrice != null ? String(orig.tagPrice) : null,
        dealPrice: orig?.dealPrice != null ? String(orig.dealPrice) : null,
        lineAmount: String(num(it.amount) || (deal != null ? Math.round(deal * qty * 100) / 100 : 0)),
        reason: ctx.reason,
        remark: 'POS上行退货',
      };
    });
    if (detailRows.length) {
      await bulkInsert(tx, retailReturnItem, detailRows);
    }

    // 回补门店仓库存（POS 退货已确认收货，须真实增加库存）
    const stockChanges = detailRows
      .filter((r) => r.skuId && Number(r.quantity) > 0)
      .map((r) => ({
        warehouseId,
        warehouseName,
        skuId: r.skuId as string,
        itemType: 'sku' as const,
        qtyDelta: Number(r.quantity),
        flowType: 'retail_return_in' as const,
        bizNo: ctx.erpNo,
        remark: `POS上行零售退货入库: ${ctx.posReturnNo}`,
      }));
    if (stockChanges.length) {
      await this.stockService.batchChangeStock(tx, stockChanges as never);
    }
  }

  /** POS 退货明细金额合计（payload 未带 totalAmount 时兜底计算） */
  private sumReturnAmount(items: PosReturnItemPayload[]): number {
    return items.reduce((sum, it) => sum + num(it.amount), 0);
  }

  receiveTransferRequest(
    payload: PosRequisitionPayload,
  ): Promise<PosReceiveResult> {
    const storeCode = String(payload.storeCode ?? payload.store_code ?? '');
    const posDocNo = String(payload.reqNo ?? payload.req_no ?? '');
    if (!posDocNo) throw new BadRequestException('reqNo 缺失');
    return this.receive('transfer_requests', posDocNo, payload, async (tx, erpNo) => {
      const resolved = await this.resolveStore(tx, storeCode);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const id = randomUUID();
      await tx.insert(posRequisition).values({
        id,
        reqNo: erpNo,
        storeCode,
        storeId: resolved.storeId,
        storeName: resolved.storeName,
        reqDate: toDate(payload.reqDate ?? payload.req_date),
        status: 'submitted',
        remark: payload.remark ? String(payload.remark) : null,
      });
      if (items.length) {
        await bulkInsert(
          tx,
          posRequisitionItem,
          items.map((it) => ({
            id: randomUUID(),
            requisitionId: id,
            skuCode: String(it.skuCode ?? it.sku_code ?? ''),
            styleNo: String(it.styleNo ?? it.style_no ?? ''),
            color: it.color ?? null,
            size: it.size ?? null,
            qty: String(num(it.qty)),
            remark: it.remark ? String(it.remark) : null,
          })),
        );
      }
    });
  }

  receiveEod(payload: PosEodPayload): Promise<PosReceiveResult> {
    const storeCode = String(payload.storeCode ?? payload.store_code ?? '');
    const posDocNo = String(payload.eodNo ?? payload.eod_no ?? '');
    if (!posDocNo) throw new BadRequestException('eodNo 缺失');
    return this.receive('eod', posDocNo, payload, async (tx, erpNo) => {
      const resolved = await this.resolveStore(tx, storeCode);
      await tx.insert(posDailySettle).values({
        id: randomUUID(),
        settleNo: erpNo,
        storeCode,
        storeId: resolved.storeId,
        storeName: resolved.storeName,
        settleDate: toDate(payload.settleDate ?? payload.settle_date),
        sessionId: payload.sessionId ?? payload.session_id ?? null,
        cashierName: payload.cashierName ?? payload.cashier_name ?? null,
        cashAmount: String(num(payload.cashAmount ?? payload.cash_amount)),
        cardAmount: String(num(payload.cardAmount ?? payload.card_amount)),
        wechatAmount: String(num(payload.wechatAmount ?? payload.wechat_amount)),
        alipayAmount: String(num(payload.alipayAmount ?? payload.alipay_amount)),
        otherAmount: String(num(payload.otherAmount ?? payload.other_amount)),
        totalAmount: String(num(payload.totalAmount ?? payload.total_amount)),
        depositAmount: String(num(payload.depositAmount ?? payload.deposit_amount)),
        diffAmount: String(num(payload.diffAmount ?? payload.diff_amount)),
        status: 'settled',
        remark: payload.remark ? String(payload.remark) : null,
      });
    });
  }

  /* ============================ 失败补偿 ============================ */

  /** 列出待补偿记录（pending/failed），供运营核对与手动重放。 */
  async listFailures(query: {
    status?: 'pending' | 'failed';
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const filters: any[] = [];
    if (query.status) filters.push(eq(posReceiveLog.status, query.status));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(posReceiveLog)
        .where(where)
        .orderBy(desc(posReceiveLog.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ c: sql<number>`count(*)::int` })
        .from(posReceiveLog)
        .where(where),
    ]);
    return {
      total: totalRows[0]?.c ?? 0,
      list: rows.map((r) => ({
        id: r.id,
        bizType: r.bizType,
        posDocNo: r.posDocNo,
        erpNo: r.erpNo,
        status: r.status,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
      })),
    };
  }

  /** 重放一条失败/待处理记录：按 bizType 复用既有 receiveX 幂等骨架翻成 success。 */
  async replay(id: string): Promise<PosReceiveResult> {
    const rows = await this.db
      .select()
      .from(posReceiveLog)
      .where(eq(posReceiveLog.id, id))
      .limit(1);
    if (!rows.length) {
      throw new BadRequestException('补偿记录不存在');
    }
    const row = rows[0];
    if (row.status === 'success') {
      return { success: true, erpNo: row.erpNo ?? undefined, duplicated: true };
    }
    if (!row.payload) {
      throw new BadRequestException('记录缺少 payload，无法重放');
    }
    const payload = row.payload as any;
    switch (row.bizType) {
      case 'sales':
        return this.receiveSales(payload);
      case 'stocktakes':
        return this.receiveStocktake(payload);
      case 'returns':
        return this.receiveReturns(payload);
      case 'transfer_requests':
        return this.receiveTransferRequest(payload);
      case 'eod':
        return this.receiveEod(payload);
      default:
        throw new BadRequestException(`未知 bizType: ${row.bizType}`);
    }
  }
}
