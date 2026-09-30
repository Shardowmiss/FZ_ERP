import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import { generateDocNo } from '@server/database/id';
import { buildDeductLines, deductStockBatch } from '@server/database/stock-batch';
import { toCents, fromCents } from '@server/database/money';
import { auditAction } from '@server/common/audit';
import { resolveStoreId, enforceStoreScope } from '@server/common/tenant';
import { maskPhone } from '@server/common/pii';
import { ErpIntegrationService } from '../erp-integration/erp-integration.service';
import { PromotionsService } from '../promotions/promotions.service';
import { evaluatePromotions } from '../promotions/promotion-engine';
import {
  posSaleOrder,
  posSaleItem,
  posSaleDiscount,
  posSalePayment,
  posStock,
  posMember,
  posEmployee,
  posSuspendedOrder,
  posPointsLog,
  posStoredLog,
  posSku,
  posStyle,
  posShift,
} from '@server/database/schema';
import { eq, and, count, desc, ilike, sql, gte, lte, inArray } from 'drizzle-orm';
import type {
  SaleOrder,
  SaleOrderQuery,
  ListResponse,
  CreateSaleOrderDto,
  SuspendedOrder,
  SuspendOrderDto,
  SaleItem,
} from '@shared/api.interface';
import type { AuthPrincipal } from '../auth/auth.service';

/** 默认门店。生产环境应由登录会话注入，见 F-5/P0-5 鉴权改造 */
const STORE_ID = 'HZ-HB-YT-001';

/** 积分换算率：多少积分抵扣 1 元 */
const POINTS_PER_YUAN = 100;

/** 金额按分取整，避免 JS 浮点长尾（P2-7） */
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** 单笔抹零上限（元）。超过该值必须走折扣/审批流程，不得由收银员直接抹除 */
const MAX_ROUNDING_AMOUNT = 1;

/** 支付金额校验容差（元） */
const PAYMENT_TOLERANCE = 0.01;

/**
 * 是否启用「促销优惠上限」服务端校验。
 * 默认开启。设为 false 可应急放开（例如促销中心故障导致门店大面积被拒单），
 * 但这意味着退回「优惠全凭客户端填」的状态，仅作事故期兜底。
 */
function enforcePromotionCap(): boolean {
  const v = (process.env.POS_ENFORCE_PROMOTION_CAP ?? 'true').trim().toLowerCase();
  return v !== 'false' && v !== '0';
}

const SALE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析业务成交日期。
 *
 * 客户端在**成交那一刻**打戳并随单上行（离线优先 POS 的订单可能在断网数天后才同步，
 * 服务端无从还原真实成交日）。这里只做格式校验与兜底，不篡改其值。
 *
 * 兜底用服务端当日（CURRENT_DATE 同源），而不是"同步时刻"——后者在离线场景下
 * 正是造成数据漂移的根因，绝不能再用。
 */
function resolveSaleDate(raw?: string): string {
  const s = (raw ?? '').trim();
  if (s !== '' && SALE_DATE_RE.test(s)) return s;
  const now = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly erp: ErpIntegrationService,
    private readonly promotions: PromotionsService,
  ) {
    this.db = scopeDatabase(this.db);
  }

  /**
   * 生成订单号（并发安全）
   *
   * 采用 ULID 后缀（Crockford base32，26 字符，按毫秒时间可排序，碰撞概率 ~1/2^80），
   * 从根本上消除并发重号风险，不再依赖唯一索引兜底。
   * 保留 "XS" 业务前缀，整串可字典序排序、可读。
   */
  private generateOrderNo(): string {
    return generateDocNo('XS');
  }

  /**
   * F-2：以主数据覆写客户端传入的商品明细。
   *
   * 客户端传来的 qty / tagPrice / styleId / styleName 一律不可信——若直接采信，
   * 攻击者可构造 `tagPrice=0.01` 或负数量的明细实现 0 元提货 / 反向加库存。
   * 这里统一按 skuId 反查 pos_sku → pos_style，用服务端权威数据覆写。
   */
  private async hydrateItemsFromMasterData(items: SaleItem[]): Promise<void> {
    for (const it of items) {
      if (!it.skuId) {
        throw new BadRequestException('销售明细缺少 SKU 标识');
      }
      if (!Number.isInteger(it.qty) || it.qty <= 0) {
        throw new BadRequestException(
          `明细「${it.styleName ?? it.skuId}」数量必须为正整数，当前为 ${it.qty}`,
        );
      }
    }

    const skuIds = [...new Set(items.map((it) => it.skuId).filter(Boolean))];
    const skuRows = skuIds.length
      ? await this.db
          .select({ skuId: posSku.id, styleId: posSku.styleId })
          .from(posSku)
          .where(inArray(posSku.id, skuIds))
      : [];
    const skuToStyle = new Map(skuRows.map((r) => [r.skuId, r.styleId]));

    const styleIds = [
      ...new Set(
        [
          ...items.map((it) => it.styleId),
          ...items.map((it) => skuToStyle.get(it.skuId)),
        ].filter((v): v is string => Boolean(v)),
      ),
    ];
    const styleRows = styleIds.length
      ? await this.db
          .select({
            id: posStyle.id,
            name: posStyle.name,
            tagPrice: sql<number>`${posStyle.tagPrice} / 100.0`,
          })
          .from(posStyle)
          .where(inArray(posStyle.id, styleIds))
      : [];
    const styleInfo = new Map(
      styleRows.map((r) => [
        r.id,
        { name: r.name, tagPrice: fromCents(r.tagPrice) },
      ]),
    );

    for (const it of items) {
      const styleId = skuToStyle.get(it.skuId) ?? it.styleId;
      const info = styleId ? styleInfo.get(styleId) : undefined;
      if (!info || !(info.tagPrice > 0)) {
        throw new BadRequestException(
          `商品 ${it.styleName ?? it.skuId} 未查询到有效吊牌价，无法销售`,
        );
      }
      // 覆写为服务端权威数据
      it.tagPrice = info.tagPrice;
      if (styleId) it.styleId = styleId;
      it.styleName = info.name;
      // P0-2：单价/行金额服务端权威重算，杜绝客户端伪造 0 元提货或低报营收
      it.unitPrice = info.tagPrice;
      it.lineAmount = round2(info.tagPrice * it.qty);
    }
  }

  /**
   * F-5：解析并校验单据所属班次。
   *
   * 硬性要求：班次必须存在且属于同一门店——否则统计口径会串店。
   * 软性要求：班次已结班时仍允许补录（离线单可能在结班后才同步），
   *           仅记录告警，交由人工核对，避免单据直接进死信。
   */
  private async resolveShiftId(
    shiftId: string | undefined,
    storeId: string,
  ): Promise<string | undefined> {
    if (shiftId === undefined) return undefined;
    if (!shiftId) {
      throw new BadRequestException('缺少班次信息，请先在交接班页面开班');
    }
    const rows = await this.db
      .select()
      .from(posShift)
      .where(eq(posShift.id, shiftId));
    const shift = rows[0];
    if (!shift) {
      throw new BadRequestException(`班次 ${shiftId} 不存在`);
    }
    if (shift.storeId !== storeId) {
      throw new BadRequestException('班次与门店不匹配，禁止跨店归属');
    }
    if (shift.status !== 'open') {
      this.logger.warn(
        `单据归属到已结班班次 ${shiftId}（源自离线补传或结班后补录），请人工核对`,
      );
    }
    return shiftId;
  }

  // 门店归属服务端权威推导统一收敛到 @server/common/tenant（resolveStoreId）：
  // 忽略客户端下发的 dto.storeId，杜绝跨店越权；无登录态时回退到服务端常量 STORE_ID。

  /**
   * 将开单单据异步推送到 ERP 接收端（server-to-server）。
   * 失败由 ErpIntegrationService.pushUpstream 记 posSyncLog(failed) 并可由 retryFailedUpstream 重推；
   * 此处 fire-and-forget，不阻断本地开单业务。
   */
  private pushSalesUpstream(order: SaleOrder): Promise<void> {
    // 找零按 S-1 口径（全部 cash 行汇总）从支付明细重算后回传；
    // 否则 ERP 侧 changeAmount 恒为 0，收银找零无法对账。
    const cashChange = (order.payments ?? [])
      .filter((p) => p.payMethod === 'cash')
      .reduce((s, p) => s + (Number(p.changeAmount) || 0), 0);
    const payload = {
      storeId: order.storeId,
      orderNo: order.orderNo,
      memberId: order.memberId,
      // 成交日必须显式带上：ERP 接收端对缺失 sale_date 是**拒绝落库**的
      // （旧实现会静默用同步当天顶替，把离线隔日同步的单全写成同步当天）。
      saleDate: order.saleDate,
      totalAmount: order.totalAmount,
      discountAmount: order.discountAmount,
      payAmount: order.payAmount,
      changeAmount: cashChange,
      // 用 totalQty 而非明细条数：一笔单可能同 SKU 多行，itemCount 是数量不是行数
      itemCount: order.totalQty,
      remark: order.remark,
      items: (order.items ?? []).map((it) => ({
        skuId: it.skuId,
        styleId: it.styleId,
        colorId: it.colorId,
        sizeId: it.sizeId,
        qty: it.qty,
        // 明细金额在 POS 库为「分」，ERP 期望「元」，需转换
        tagPrice: fromCents(it.tagPrice),
        unitPrice: fromCents(it.unitPrice),
        discountAmount: fromCents(it.discountAmount),
        lineAmount: fromCents(it.lineAmount),
      })),
    };
    return this.erp.pushUpstream('sales', order.orderNo, payload);
  }

  async createOrder(dto: CreateSaleOrderDto, principal?: AuthPrincipal): Promise<SaleOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('商品明细不能为空');
    }
    if (!dto.payments || dto.payments.length === 0) {
      throw new BadRequestException('支付明细不能为空');
    }

    // 幂等：如果 clientId 已存在，直接返回已有订单
    if (dto.clientId) {
      const existing = await this.db
        .select()
        .from(posSaleOrder)
        .where(eq(posSaleOrder.clientId, dto.clientId));
      if (existing.length > 0) {
        return this.getOrderDetail(existing[0].id);
      }
    }

    // ============ F-2：服务端定价 + 数量合法性校验 ============
    await this.hydrateItemsFromMasterData(dto.items);

    // ============ F-5：班次归属校验 ============
    // 此前客户端从不下发 shiftId，导致班次销售额/现金/退款恒为 0，
    // cashExpected 永远等于备用金，长短款机制形同虚设。此处强制归属。
    // P0-1：门店归属服务端权威推导（忽略客户端 dto.storeId），供班次与订单共用
    const storeId = resolveStoreId(principal, STORE_ID);
    const validatedShiftId = await this.resolveShiftId(dto.shiftId, storeId);

    // 业务成交日期：离线优先 POS 的**唯一可信成交时间**。
    // 客户端在成交那一刻打戳并随单上行；缺失则退回服务端当日（比"同步日"更接近真实，
    // 但仍要求客户端补传——ERP 侧对缺失 sale_date 是拒绝落库的，见 normalize.ts）。
    const saleDate = resolveSaleDate(dto.saleDate);

    const totalQty = dto.items.reduce((sum, it) => sum + it.qty, 0);
    // P0-2：订单金额 = Σ行金额（行金额已在 hydrateItemsFromMasterData 服务端权威重算）
    const totalAmount = round2(
      dto.items.reduce((sum, it) => sum + (Number(it.lineAmount) || 0), 0),
    );
    const baseDiscountAmount = dto.discounts?.reduce((sum, d) => sum + d.amount, 0) ?? 0;
    if (baseDiscountAmount < 0) {
      throw new BadRequestException('优惠金额不能为负');
    }

    // ============ Wave 4-C：服务端促销上限校验 ============
    // 此前收银台的优惠金额**完全由客户端说了算**（只要不超过商品总额），
    // 与门店生效的促销活动毫无关系 —— 收银员填多少就少收多少。
    // 这里用服务端 + 库里真实生效的促销算出上限来卡，让利必须能在
    // pos_sale_discount 里逐条找到出处。设 POS_ENFORCE_PROMOTION_CAP=false 可应急关闭。
    if (enforcePromotionCap()) {
      const subtotalCents = Math.round(totalAmount * 100);
      const promos = await this.promotions.getActiveForStore(storeId, dto.memberId);
      const { capCents, applied } = evaluatePromotions(promos, {
        storeId,
        subtotalCents,
        memberId: dto.memberId,
      });
      // 容差 1 分：支付侧本就有 0.01 元的对账容差，避免边界金额被误拒
      const requestedCents = Math.round(baseDiscountAmount * 100);
      if (requestedCents > capCents + 1) {
        throw new BadRequestException(
          `优惠金额超出促销活动允许范围（本单促销上限 ${(capCents / 100).toFixed(2)} 元` +
            (applied.length > 0
              ? `，生效促销：${applied.map((a) => a.name).join('、')}`
              : '，本单无生效促销') +
            `，当前 ${(requestedCents / 100).toFixed(2)} 元）`,
        );
      }
    }

    // ============ P0-1 积分抵扣：以支付明细为唯一可信来源 ============
    // 不使用 dto.pointsUsed，避免客户端伪造；由 payMethod==='points' 的支付行反算。
    const pointsPayAmount = dto.payments
      .filter((p) => p.payMethod === 'points')
      .reduce((sum, p) => sum + Math.max(0, Number(p.amount) || 0), 0);
    // 换算率：100 积分 = 1 元。pointsUsed 单位「分」，pointsDeduction 单位「元」
    const pointsUsed = Math.round(pointsPayAmount * POINTS_PER_YUAN);
    const pointsDeduction = Math.round(pointsPayAmount * 100) / 100;

    if (pointsUsed < 0) {
      throw new BadRequestException('积分抵扣不能为负');
    }

    // ============ P2-3 抹零：服务端上限保护 ============
    // 单笔抹零不得超过 1 元，且不得超过扣除优惠后的商品金额
    const roundingAmount = Math.min(
      Math.max(0, Number(dto.roundingAmount) || 0),
      MAX_ROUNDING_AMOUNT,
      Math.max(0, totalAmount - baseDiscountAmount - pointsDeduction),
    );

    // 抹零并入订单优惠总额，保证「pos_sale_discount 明细之和 === 订单.discountAmount」
    const discountAmount =
      Math.round((baseDiscountAmount + roundingAmount) * 100) / 100;

    if (discountAmount > totalAmount) {
      throw new BadRequestException('优惠金额不得超过商品金额');
    }

    // 注意单位：减去的是「元」为单位的 pointsDeduction，而非「分」为单位的 pointsUsed
    const payAmount = Math.max(
      0,
      Math.round((totalAmount - discountAmount - pointsDeduction) * 100) / 100,
    );

    // ============ S-4：支付明细合法性 ============
    for (const p of dto.payments) {
      if (!p.payMethod) {
        throw new BadRequestException('支付方式不能为空');
      }
      const amt = Number(p.amount);
      if (!Number.isFinite(amt) || amt < 0) {
        throw new BadRequestException(
          `支付方式 ${p.payMethod} 的金额不合法：${String(p.amount)}`,
        );
      }
      const chg = Number(p.changeAmount ?? 0);
      if (!Number.isFinite(chg) || chg < 0) {
        throw new BadRequestException(
          `支付方式 ${p.payMethod} 的找零金额不能为负`,
        );
      }
      if (chg > amt + 0.01) {
        throw new BadRequestException(
          `支付方式 ${p.payMethod} 的找零不能超过收取金额`,
        );
      }
    }

    // 验证支付金额
    const totalPayment = dto.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    // S-1：现金相关一律按全部 cash 行汇总，多条现金时不会漏统计
    const cashRows = dto.payments.filter((p) => p.payMethod === 'cash');
    const cashChange =
      Math.round(
        cashRows.reduce((s, p) => s + (Number(p.changeAmount) || 0), 0) * 100,
      ) / 100;

    if (Math.abs(totalPayment - cashChange - payAmount) > 0.01) {
      throw new BadRequestException(
        `支付金额与应付金额不符，应付${payAmount.toFixed(2)}，实付${(totalPayment - cashChange).toFixed(2)}`,
      );
    }


    let orderId = '';
    // storeId 已在上方（P0-1）服务端权威推导，本事务复用

    await this.db.transaction(async (tx) => {
      // 1. 库存校验与扣减（P1-5：批量化，见 @server/database/stock-batch）
      //    往返次数由「逐件 2N 次」降为恒定 2 次，且 FOR UPDATE 先行锁再扣减，杜绝超卖。
      await deductStockBatch(
        tx,
        storeId,
        buildDeductLines(dto.items),
      );

      // 2. 生成订单号
      const orderNo = this.generateOrderNo();

      // 3. 计算积分：消费1元积1分（按实付金额）
      const pointsEarned = Math.floor(payAmount);

      // 4. 创建订单
      const [order] = await tx
        .insert(posSaleOrder)
        .values({
          orderNo,
          storeId,
          memberId: dto.memberId,
          employeeId: dto.employeeId,
          saleDate,
          totalQty,
          totalAmount: toCents(totalAmount),
          discountAmount: toCents(discountAmount),
          payAmount: toCents(payAmount),
          pointsUsed,
          pointsEarned,
          status: 'completed',
          channel: 'store',
          // F-5：使用已校验的班次
          shiftId: validatedShiftId,
          remark: dto.remark,
          syncedToErp: false,
          syncStatus: 'pending',
          clientId: dto.clientId,
        })
        .returning({ id: posSaleOrder.id });
      orderId = order.id;

      // 5. 批量写入订单明细（P1-5：原逐行 insert 在百店高并发下形成 N+1 写尖峰，改为单次批量 insert）
      const saleItemValues = dto.items.map((item) => ({
        orderId: order.id,
        skuId: item.skuId,
        styleId: item.styleId,
        styleName: item.styleName,
        colorId: item.colorId,
        sizeId: item.sizeId,
        qty: item.qty,
        tagPrice: toCents(item.tagPrice),
        unitPrice: toCents(item.unitPrice),
        discountAmount: toCents(item.discountAmount ?? 0),
        lineAmount: toCents(item.lineAmount),
      }));
      if (saleItemValues.length > 0) {
        await tx.insert(posSaleItem).values(saleItemValues);
      }

      // 6. 批量写入优惠明细（含抹零）
      const discountValues: Array<{
        orderId: string;
        promotionId: string | undefined;
        name: string;
        type: string;
        amount: number;
      }> = [];
      if (dto.discounts && dto.discounts.length > 0) {
        for (const d of dto.discounts) {
          discountValues.push({
            orderId: order.id,
            promotionId: d.promotionId,
            name: d.name,
            type: d.type,
            amount: toCents(d.amount),
          });
        }
      }
      // 6b. P2-3：抹零计入折扣明细，保证财务可对账（订单.discountAmount = Σ优惠明细）
      if (roundingAmount > 0) {
        discountValues.push({
          orderId: order.id,
          promotionId: undefined,
          name: '抹零',
          type: 'rounding',
          amount: toCents(roundingAmount),
        });
      }
      if (discountValues.length > 0) {
        await tx.insert(posSaleDiscount).values(discountValues);
      }

      // 7. 批量写入支付明细
      const paymentValues = dto.payments.map((p) => ({
        orderId: order.id,
        payMethod: p.payMethod,
        amount: toCents(p.amount),
        changeAmount: toCents(p.changeAmount ?? 0),
        transactionId: p.transactionId,
      }));
      if (paymentValues.length > 0) {
        await tx.insert(posSalePayment).values(paymentValues);
      }

      // 8. 会员相关更新
      if (dto.memberId) {
        // S-2：行锁。否则并发消费（双 POS / 离线补传）会读到同一份余额造成透支
        const memberRows = await tx
          .select()
          .from(posMember)
          .where(eq(posMember.id, dto.memberId))
          .for('update');
        if (memberRows.length === 0) {
          throw new BadRequestException('会员不存在');
        }
        const member = memberRows[0];

        // 验证积分是否足够
        if (pointsUsed > member.points) {
          throw new BadRequestException(
            `积分不足，当前积分 ${member.points}，使用 ${pointsUsed}`,
          );
        }

        // S-1：汇总全部储值支付行。
        // 原先只用 find() 取第一条做校验和扣减，传两条储值支付时第二条等于白送。
        const storedDeduct =
          Math.round(
            dto.payments
              .filter((p) => p.payMethod === 'stored_value')
              .reduce((sum, p) => sum + (Number(p.amount) || 0), 0) * 100,
          ) / 100;

        if (storedDeduct > 0) {
          const storedValueNum = fromCents(member.storedValue);
          if (storedValueNum < storedDeduct) {
            throw new BadRequestException(
              `储值余额不足，当前余额 ${storedValueNum.toFixed(2)}，本次使用 ${storedDeduct.toFixed(2)}`,
            );
          }
        }

        // 更新会员统计
        const newPoints = member.points - pointsUsed + pointsEarned;

        await tx
          .update(posMember)
          .set({
            totalSpent: sql`${posMember.totalSpent} + ${toCents(payAmount)}`,
            totalCount: sql`${posMember.totalCount} + 1`,
            points: newPoints,
            storedValue: sql`GREATEST(0, ${posMember.storedValue} - ${toCents(storedDeduct)})`,
            lastPurchaseAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(posMember.id, dto.memberId));

        // 批量写入积分/储值日志（P1-5：收集后单次批量 insert，减少事务内写往返）
        const pointsLogValues: Array<{
          memberId: string;
          change: number;
          balance: number;
          type: string;
          sourceNo: string;
          remark: string;
        }> = [];
        if (pointsEarned > 0) {
          pointsLogValues.push({
            memberId: dto.memberId,
            change: pointsEarned,
            balance: newPoints,
            type: 'earn',
            sourceNo: orderNo,
            remark: '消费积分',
          });
        }
        if (pointsUsed > 0) {
          pointsLogValues.push({
            memberId: dto.memberId,
            change: -pointsUsed,
            balance: member.points - pointsUsed,
            type: 'deduct',
            sourceNo: orderNo,
            remark: '积分抵扣',
          });
        }
        const storedLogValues: Array<{
          memberId: string;
          change: number;
          balance: number;
          type: string;
          sourceNo: string;
          remark: string;
        }> = [];
        if (storedDeduct > 0) {
          const newStored = Math.max(0, fromCents(member.storedValue) - storedDeduct);
          storedLogValues.push({
            memberId: dto.memberId,
            change: toCents(-storedDeduct),
            balance: toCents(newStored),
            type: 'consume',
            sourceNo: orderNo,
            remark: '消费扣款',
          });
        }
        if (pointsLogValues.length > 0) {
          await tx.insert(posPointsLog).values(pointsLogValues);
        }
        if (storedLogValues.length > 0) {
          await tx.insert(posStoredLog).values(storedLogValues);
        }
      }

      // P0-2：销售单创建审计（与订单同事务，失败仅告警不回滚主流程）
      await auditAction(tx, {
        storeId,
        employeeId: principal?.employeeId ?? null,
        module: 'sales',
        action: 'create',
        targetNo: orderNo,
        content: {
          orderNo,
          storeId,
          memberId: dto.memberId,
          totalAmount,
          payAmount,
        },
      });
    });

    const order = await this.getOrderDetail(orderId);
    // 上行 ERP：开单完成后异步推送（不阻断本地业务；失败由 ErpIntegrationService 记 posSyncLog 并可重试）
    this.pushSalesUpstream(order).catch(() => {});
    return order;
  }

  async getOrderList(query: SaleOrderQuery, principal?: AuthPrincipal): Promise<ListResponse<SaleOrder>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    // P0-1：列表查询强制门店作用域。主体已绑定门店时忽略客户端传入的 storeId，
    // 杜绝越权读取其他门店订单；跨店督导角色则按客户端指定门店查询。
    const scopedStoreId = enforceStoreScope(principal, query.storeId);
    if (scopedStoreId) conditions.push(eq(posSaleOrder.storeId, scopedStoreId));
    if (query.status) conditions.push(eq(posSaleOrder.status, query.status));
    if (query.memberId) conditions.push(eq(posSaleOrder.memberId, query.memberId));
    if (query.startDate) conditions.push(gte(posSaleOrder.createdAt, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(posSaleOrder.createdAt, new Date(query.endDate)));
    if (query.keyword) {
      conditions.push(
        sql`${posSaleOrder.orderNo} ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, orderRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posSaleOrder)
        .where(whereClause),
      this.db
        .select({
          id: posSaleOrder.id,
          orderNo: posSaleOrder.orderNo,
          storeId: posSaleOrder.storeId,
          memberId: posSaleOrder.memberId,
          employeeId: posSaleOrder.employeeId,
          totalQty: posSaleOrder.totalQty,
          totalAmount: sql<number>`${posSaleOrder.totalAmount} / 100.0`,
          discountAmount: sql<number>`${posSaleOrder.discountAmount} / 100.0`,
          payAmount: sql<number>`${posSaleOrder.payAmount} / 100.0`,
          pointsUsed: posSaleOrder.pointsUsed,
          pointsEarned: posSaleOrder.pointsEarned,
          status: posSaleOrder.status,
          channel: posSaleOrder.channel,
          saleDate: posSaleOrder.saleDate,
          shiftId: posSaleOrder.shiftId,
          remark: posSaleOrder.remark,
          syncedToErp: posSaleOrder.syncedToErp,
          syncStatus: posSaleOrder.syncStatus,
          syncAt: posSaleOrder.syncAt,
          createdAt: posSaleOrder.createdAt,
          updatedAt: posSaleOrder.updatedAt,
          memberName: posMember.name,
          memberPhone: posMember.phone,
          employeeName: posEmployee.name,
        })
        .from(posSaleOrder)
        .leftJoin(posMember, eq(posSaleOrder.memberId, posMember.id))
        .leftJoin(posEmployee, eq(posSaleOrder.employeeId, posEmployee.id))
        .where(whereClause)
        .orderBy(desc(posSaleOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: orderRows.map((row) => ({
        id: row.id,
        orderNo: row.orderNo,
        storeId: row.storeId,
        memberId: row.memberId ?? undefined,
        employeeId: row.employeeId ?? undefined,
        totalQty: row.totalQty,
        totalAmount: fromCents(row.totalAmount),
        discountAmount: fromCents(row.discountAmount),
        payAmount: fromCents(row.payAmount),
        pointsUsed: row.pointsUsed,
        pointsEarned: row.pointsEarned,
        status: row.status,
        channel: row.channel,
        saleDate: row.saleDate,
        shiftId: row.shiftId ?? undefined,
        remark: row.remark ?? undefined,
        syncedToErp: row.syncedToErp,
        syncStatus: row.syncStatus,
        syncAt: row.syncAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        memberName: row.memberName ?? undefined,
        // P1-b：会员手机号脱敏返回
        memberPhone: row.memberPhone ? maskPhone(row.memberPhone) : undefined,
        employeeName: row.employeeName ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getOrderDetail(id: string): Promise<SaleOrder> {
    const rows = await this.db
      .select({
        id: posSaleOrder.id,
        orderNo: posSaleOrder.orderNo,
        storeId: posSaleOrder.storeId,
        memberId: posSaleOrder.memberId,
        employeeId: posSaleOrder.employeeId,
        saleDate: posSaleOrder.saleDate,
        totalQty: posSaleOrder.totalQty,
        totalAmount: sql<number>`${posSaleOrder.totalAmount} / 100.0`,
        discountAmount: sql<number>`${posSaleOrder.discountAmount} / 100.0`,
        payAmount: sql<number>`${posSaleOrder.payAmount} / 100.0`,
        pointsUsed: posSaleOrder.pointsUsed,
        pointsEarned: posSaleOrder.pointsEarned,
        status: posSaleOrder.status,
        channel: posSaleOrder.channel,
        shiftId: posSaleOrder.shiftId,
        remark: posSaleOrder.remark,
        syncedToErp: posSaleOrder.syncedToErp,
        syncStatus: posSaleOrder.syncStatus,
        syncAt: posSaleOrder.syncAt,
        createdAt: posSaleOrder.createdAt,
        updatedAt: posSaleOrder.updatedAt,
        memberName: posMember.name,
        memberPhone: posMember.phone,
        employeeName: posEmployee.name,
      })
      .from(posSaleOrder)
      .leftJoin(posMember, eq(posSaleOrder.memberId, posMember.id))
      .leftJoin(posEmployee, eq(posSaleOrder.employeeId, posEmployee.id))
      .where(eq(posSaleOrder.id, id));

    if (rows.length === 0) {
      throw new NotFoundException('零售单不存在');
    }

    const row = rows[0];

    const [items, discounts, payments] = await Promise.all([
      this.db.select().from(posSaleItem).where(eq(posSaleItem.orderId, id)),
      this.db.select().from(posSaleDiscount).where(eq(posSaleDiscount.orderId, id)),
      this.db.select().from(posSalePayment).where(eq(posSalePayment.orderId, id)),
    ]);

    return {
      id: row.id,
      orderNo: row.orderNo,
      storeId: row.storeId,
      memberId: row.memberId ?? undefined,
      employeeId: row.employeeId ?? undefined,
      totalQty: row.totalQty,
      totalAmount: fromCents(row.totalAmount),
      discountAmount: fromCents(row.discountAmount),
      payAmount: fromCents(row.payAmount),
      pointsUsed: row.pointsUsed,
      pointsEarned: row.pointsEarned,
      status: row.status,
      channel: row.channel,
      saleDate: row.saleDate,
      shiftId: row.shiftId ?? undefined,
      remark: row.remark ?? undefined,
      syncedToErp: row.syncedToErp,
      syncStatus: row.syncStatus,
      syncAt: row.syncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      memberName: row.memberName ?? undefined,
      // P1-b：会员手机号脱敏返回
      memberPhone: row.memberPhone ? maskPhone(row.memberPhone) : undefined,
      employeeName: row.employeeName ?? undefined,
      items: items.map((it) => ({
        id: it.id,
        orderId: it.orderId,
        skuId: it.skuId,
        styleId: it.styleId,
        styleName: it.styleName,
        colorId: it.colorId,
        sizeId: it.sizeId,
        qty: it.qty,
        tagPrice: Number(it.tagPrice),
        unitPrice: Number(it.unitPrice),
        discountAmount: Number(it.discountAmount),
        lineAmount: Number(it.lineAmount),
        refundedQty: it.refundedQty,
      })),
      discounts: discounts.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        promotionId: d.promotionId ?? undefined,
        name: d.name,
        type: d.type,
        amount: Number(d.amount),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        payMethod: p.payMethod,
        amount: Number(p.amount),
        changeAmount: Number(p.changeAmount),
        transactionId: p.transactionId ?? undefined,
      })),
    };
  }

  async suspendOrder(dto: SuspendOrderDto, principal?: AuthPrincipal): Promise<SuspendedOrder> {
    // 幂等：如果 clientId 已存在，直接返回已有挂单
    if (dto.clientId) {
      const existing = await this.db
        .select()
        .from(posSuspendedOrder)
        .where(eq(posSuspendedOrder.clientId, dto.clientId));
      if (existing.length > 0) {
        const result = existing[0];
        return {
          id: result.id,
          storeId: result.storeId,
          memberId: result.memberId ?? undefined,
          employeeId: result.employeeId ?? undefined,
          items: (result.items as unknown as Record<string, unknown>[]).map(
            (it) => ({
              skuId: String(it.skuId),
              styleId: String(it.styleId),
              styleName: String(it.styleName),
              colorId: String(it.colorId),
              sizeId: String(it.sizeId),
              qty: Number(it.qty),
              tagPrice: Number(it.tagPrice),
              unitPrice: Number(it.unitPrice),
              discountAmount: Number(it.discountAmount ?? 0),
              lineAmount: Number(it.lineAmount),
            }),
          ),
          totalAmount: fromCents(Number(result.totalAmount)),
          status: result.status,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        };
      }
    }

    const [result] = await this.db
      .insert(posSuspendedOrder)
      .values({
        storeId: resolveStoreId(principal, STORE_ID),
        memberId: dto.memberId,
        employeeId: dto.employeeId,
        items: dto.items as unknown as Record<string, unknown>[],
        totalAmount: toCents(Number(dto.totalAmount)),
        status: 'active',
        clientId: dto.clientId,
      })
      .returning();

    return {
      id: result.id,
      storeId: result.storeId,
      memberId: result.memberId ?? undefined,
      employeeId: result.employeeId ?? undefined,
      items: (result.items as unknown as Record<string, unknown>[]).map(
        (it) => ({
          skuId: String(it.skuId),
          styleId: String(it.styleId),
          styleName: String(it.styleName),
          colorId: String(it.colorId),
          sizeId: String(it.sizeId),
          qty: Number(it.qty),
          tagPrice: Number(it.tagPrice),
          unitPrice: Number(it.unitPrice),
          discountAmount: Number(it.discountAmount ?? 0),
          lineAmount: Number(it.lineAmount),
        }),
      ),
      totalAmount: fromCents(Number(result.totalAmount)),
      status: result.status,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  async getSuspendedList(storeId: string): Promise<SuspendedOrder[]> {
    const rows = await this.db
      .select()
      .from(posSuspendedOrder)
      .where(
        and(
          eq(posSuspendedOrder.storeId, storeId),
          eq(posSuspendedOrder.status, 'active'),
        ),
      )
      .orderBy(desc(posSuspendedOrder.createdAt));

    return rows.map((row) => ({
      id: row.id,
      storeId: row.storeId,
      memberId: row.memberId ?? undefined,
      employeeId: row.employeeId ?? undefined,
      items: (row.items as unknown as Record<string, unknown>[]).map(
        (it) => ({
          skuId: String(it.skuId),
          styleId: String(it.styleId),
          styleName: String(it.styleName),
          colorId: String(it.colorId),
          sizeId: String(it.sizeId),
          qty: Number(it.qty),
          tagPrice: Number(it.tagPrice),
          unitPrice: Number(it.unitPrice),
          discountAmount: Number(it.discountAmount ?? 0),
          lineAmount: Number(it.lineAmount),
        }),
      ),
      totalAmount: fromCents(row.totalAmount),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async activateSuspended(id: string): Promise<SuspendedOrder> {
    const rows = await this.db
      .update(posSuspendedOrder)
      .set({ status: 'activated' })
      .where(eq(posSuspendedOrder.id, id))
      .returning();

    if (rows.length === 0) {
      throw new NotFoundException('挂单不存在');
    }

    const row = rows[0];
    return {
      id: row.id,
      storeId: row.storeId,
      memberId: row.memberId ?? undefined,
      employeeId: row.employeeId ?? undefined,
      items: (row.items as unknown as Record<string, unknown>[]).map(
        (it) => ({
          skuId: String(it.skuId),
          styleId: String(it.styleId),
          styleName: String(it.styleName),
          colorId: String(it.colorId),
          sizeId: String(it.sizeId),
          qty: Number(it.qty),
          tagPrice: Number(it.tagPrice),
          unitPrice: Number(it.unitPrice),
          discountAmount: Number(it.discountAmount ?? 0),
          lineAmount: Number(it.lineAmount),
        }),
      ),
      totalAmount: fromCents(row.totalAmount),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
