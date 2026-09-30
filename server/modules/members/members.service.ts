import { fromCents, toCents } from '@server/database/money';
import { auditAction } from '@server/common/audit';
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
import {
  posMember,
  posPointsLog,
  posStoredLog,
  posCoupon,
} from '@server/database/schema';
import { eq, and, count, desc, ilike, sql, gte, lte } from 'drizzle-orm';
import type {
  Member,
  MemberQuery,
  ListResponse,
  CreateMemberDto,
  UpdateMemberDto,
  PointsLog,
  StoredLog,
  Coupon,
  RechargeDto,
  IssueCouponDto,
  LevelCount,
  SaleOrder,
} from '@shared/api.interface';
import { posSaleOrder } from '@server/database/schema';
import { maskPhone } from '@server/common/pii';

/** 单笔储值手工调整上限（元）。超过必须走财务流程，不得由店端直接调整 */
const MAX_ADJUST_AMOUNT = 5000;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    ) {
    this.db = scopeDatabase(this.db);
  }

  async getMembers(query: MemberQuery): Promise<ListResponse<Member>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.level) conditions.push(eq(posMember.level, query.level));
    if (query.keyword) {
      conditions.push(
        sql`(${posMember.memberNo} || ' ' || COALESCE(${posMember.name}, '') || ' ' || ${posMember.phone}) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posMember)
        .where(whereClause),
      this.db
        .select()
        .from(posMember)
        .where(whereClause)
        .orderBy(desc(posMember.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapMember(row)),
      total,
      page,
      pageSize,
    };
  }

  async getMember(id: string): Promise<Member> {
    const rows = await this.db.select().from(posMember).where(eq(posMember.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('会员不存在');
    }
    return this.mapMember(rows[0]);
  }

  async createMember(dto: CreateMemberDto): Promise<Member> {
    // 幂等：如果 clientId 已存在，直接返回已有会员
    if (dto.clientId) {
      const existing = await this.db
        .select()
        .from(posMember)
        .where(eq(posMember.clientId, dto.clientId));
      if (existing.length > 0) {
        return this.mapMember(existing[0]);
      }
    }

    // 检查手机号是否已存在
    const existing = await this.db
      .select()
      .from(posMember)
      .where(eq(posMember.phone, dto.phone));
    if (existing.length > 0) {
      throw new ConflictException('该手机号已注册');
    }

    const memberNo = generateDocNo('M');

    const [result] = await this.db
      .insert(posMember)
      .values({
        memberNo,
        name: dto.name,
        phone: dto.phone,
        gender: dto.gender,
        birthday: dto.birthday ?? undefined,
        level: dto.level ?? 'normal',
        preferSize: dto.preferSize,
        preferStyle: dto.preferStyle,
        clientId: dto.clientId,
      })
      .returning();

    return this.mapMember(result);
  }

  async updateMember(id: string, dto: UpdateMemberDto): Promise<Member> {
    // F-6：积分与储值是可兑现的资金类字段，禁止通过通用资料接口直接改写。
    // 否则任何人都能 `PATCH /members/:id {storedValue: 999999}` 凭空造储值且不留流水。
    if (dto.points !== undefined || dto.storedValue !== undefined) {
      throw new BadRequestException(
        '积分与储值余额不可通过本接口修改，请使用充值/调整专用接口',
      );
    }
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.birthday !== undefined) patch.birthday = dto.birthday ?? null;
    if (dto.level !== undefined) patch.level = dto.level;
    if (dto.preferSize !== undefined) patch.preferSize = dto.preferSize;
    if (dto.preferStyle !== undefined) patch.preferStyle = dto.preferStyle;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const [result] = await this.db
      .update(posMember)
      .set(patch)
      .where(eq(posMember.id, id))
      .returning();

    if (!result) {
      throw new NotFoundException('会员不存在');
    }

    return this.mapMember(result);
  }

  async getPointsLog(
    memberId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<ListResponse<PointsLog>> {
    const offset = (page - 1) * pageSize;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posPointsLog)
        .where(eq(posPointsLog.memberId, memberId)),
      this.db
        .select()
        .from(posPointsLog)
        .where(eq(posPointsLog.memberId, memberId))
        .orderBy(desc(posPointsLog.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        change: fromCents(row.change),
        balance: fromCents(row.balance),
        type: row.type,
        sourceNo: row.sourceNo ?? undefined,
        remark: row.remark ?? undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getStoredLog(
    memberId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<ListResponse<StoredLog>> {
    const offset = (page - 1) * pageSize;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posStoredLog)
        .where(eq(posStoredLog.memberId, memberId)),
      this.db
        .select()
        .from(posStoredLog)
        .where(eq(posStoredLog.memberId, memberId))
        .orderBy(desc(posStoredLog.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        change: fromCents(row.change),
        balance: fromCents(row.balance),
        type: row.type,
        sourceNo: row.sourceNo ?? undefined,
        remark: row.remark ?? undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getCoupons(memberId: string): Promise<Coupon[]> {
    const rows = await this.db
      .select()
      .from(posCoupon)
      .where(eq(posCoupon.memberId, memberId))
      .orderBy(desc(posCoupon.createdAt));

    return rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      couponCode: row.couponCode,
      name: row.name,
      type: row.type,
      discountValue: fromCents(row.discountValue),
      minAmount: fromCents(row.minAmount),
      status: row.status,
      validFrom: row.validFrom ? new Date(row.validFrom).toISOString().split('T')[0] : undefined,
      validTo: row.validTo ? new Date(row.validTo).toISOString().split('T')[0] : undefined,
      usedAt: row.usedAt?.toISOString(),
      usedOrderNo: row.usedOrderNo ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getLevelCounts(): Promise<LevelCount[]> {
    const rows = await this.db
      .select({
        level: posMember.level,
        count: count(),
      })
      .from(posMember)
      .groupBy(posMember.level);

    return rows.map((row) => ({
      level: row.level,
      count: Number(row.count),
    }));
  }

  async getMemberOrders(
    memberId: string,
    page: number = 1,
    pageSize: number = 5,
  ): Promise<ListResponse<SaleOrder>> {
    const offset = (page - 1) * pageSize;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posSaleOrder)
        .where(eq(posSaleOrder.memberId, memberId)),
      this.db
        .select()
        .from(posSaleOrder)
        .where(eq(posSaleOrder.memberId, memberId))
        .orderBy(desc(posSaleOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
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
      })),
      total,
      page,
      pageSize,
    };
  }

  async issueCoupon(
    memberId: string,
    dto: IssueCouponDto,
    operatorId?: string | null,
  ): Promise<Coupon> {
    const memberRows = await this.db
      .select()
      .from(posMember)
      .where(eq(posMember.id, memberId));
    if (memberRows.length === 0) {
      throw new NotFoundException('会员不存在');
    }

    const couponCode = generateDocNo('CP');
    const couponName = dto.name ?? (dto.type === 'discount'
      ? `${Math.round(dto.discountValue * 10)}折优惠券`
      : `满${dto.minAmount ?? 0}减${dto.discountValue}券`);

    const today = new Date();
    const validFromStr = dto.validFrom ?? today.toISOString().split('T')[0];
    let validToStr = dto.validTo;
    if (!validToStr && dto.validDays) {
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + dto.validDays);
      validToStr = endDate.toISOString().split('T')[0];
    }

    const [result] = await this.db
      .insert(posCoupon)
      .values({
        memberId,
        couponCode,
        name: couponName,
        type: dto.type,
        discountValue: toCents(dto.discountValue),
        minAmount: toCents(dto.minAmount ?? 0),
        validFrom: validFromStr,
        validTo: validToStr ?? undefined,
      })
      .returning();

    // P0-2：发券审计（失败仅告警不阻断主流程）
    await auditAction(this.db, {
      storeId: null,
      employeeId: operatorId ?? null,
      module: 'members',
      action: 'issue_coupon',
      targetNo: memberId,
      content: { memberId, couponCode, type: dto.type },
    });

    return {
      id: result.id,
      memberId: result.memberId,
      couponCode: result.couponCode,
      name: result.name,
      type: result.type,
      discountValue: fromCents(Number(result.discountValue)),
      minAmount: fromCents(Number(result.minAmount)),
      status: result.status,
      validFrom: result.validFrom
        ? new Date(result.validFrom).toISOString().split('T')[0]
        : undefined,
      validTo: result.validTo
        ? new Date(result.validTo).toISOString().split('T')[0]
        : undefined,
      usedAt: result.usedAt?.toISOString(),
      usedOrderNo: result.usedOrderNo ?? undefined,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  async recharge(memberId: string, dto: RechargeDto, operatorId?: string | null): Promise<StoredLog> {
    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('充值金额必须大于0');
    }

    const giftAmount = dto.giftAmount ?? 0;
    const totalChange = dto.amount + giftAmount;

    let newLog: StoredLog | null = null;

    await this.db.transaction(async (tx) => {
      // 行锁：避免并发充值导致余额计算错乱（与 adjustStoredValue 一致）
      const memberRows = await tx
        .select()
        .from(posMember)
        .where(eq(posMember.id, memberId))
        .for('update');
      if (memberRows.length === 0) {
        throw new NotFoundException('会员不存在');
      }

      const currentBalance = fromCents(Number(memberRows[0].storedValue));
      const newBalance = currentBalance + totalChange;

      await tx
        .update(posMember)
        .set({ storedValue: toCents(newBalance) })
        .where(eq(posMember.id, memberId));

      const [logRow] = await tx
        .insert(posStoredLog)
        .values({
          memberId,
          change: toCents(totalChange),
          balance: toCents(newBalance),
          type: 'recharge',
          remark: dto.remark ?? '储值充值',
        })
        .returning();

      newLog = {
        id: logRow.id,
        memberId: logRow.memberId,
        change: fromCents(Number(logRow.change)),
        balance: fromCents(Number(logRow.balance)),
        type: logRow.type,
        sourceNo: logRow.sourceNo ?? undefined,
        remark: logRow.remark ?? undefined,
        createdAt: logRow.createdAt.toISOString(),
      };

      // 如果有赠送金额，也记录赠送
      if (giftAmount > 0) {
        const giftBalance = newBalance;
        await tx.insert(posStoredLog).values({
          memberId,
          change: toCents(giftAmount),
          balance: toCents(giftBalance),
          type: 'gift',
          remark: '充值赠送',
        });
      }

      // P0-2：储值充值审计（与充值同事务，失败仅告警不回滚主流程）
      await auditAction(tx, {
        storeId: null,
        employeeId: operatorId ?? null,
        module: 'members',
        action: 'recharge',
        targetNo: memberId,
        content: { memberId, amount: totalChange, giftAmount },
      });
    });

    if (!newLog) {
      throw new BadRequestException('充值失败');
    }

    return newLog;
  }

  /**
   * F-6：储值手工调整，用于替代被关闭的「PATCH 直改余额」通道。
   * 与直改相比它保证三件事：必有流水、余额不为负、单人单笔金额受限。
   */
  async adjustStoredValue(
    memberId: string,
    dto: { amount: number; reason: string },
    operatorId?: string | null,
  ): Promise<StoredLog> {
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      throw new BadRequestException('调整金额不能为 0');
    }
    if (!dto.reason || dto.reason.trim().length < 4) {
      throw new BadRequestException('调整原因必填且不少于 4 个字符，用于资金审计');
    }
    if (Math.abs(amount) > MAX_ADJUST_AMOUNT) {
      throw new BadRequestException(
        `单笔调整金额不得超过 ¥${MAX_ADJUST_AMOUNT}`,
      );
    }

    let newLog: StoredLog | null = null;

    await this.db.transaction(async (tx) => {
      // 行锁：避免并发调整导致余额计算错乱
      const memberRows = await tx
        .select()
        .from(posMember)
        .where(eq(posMember.id, memberId))
        .for('update');
      if (memberRows.length === 0) {
        throw new NotFoundException('会员不存在');
      }

      const current = fromCents(Number(memberRows[0].storedValue));
      const newBalance = Math.round((current + amount) * 100) / 100;
      if (newBalance < 0) {
        throw new BadRequestException(
          `调整后余额不能为负（当前 ¥${current.toFixed(2)}，本次调整 ¥${amount.toFixed(2)}）`,
        );
      }

      await tx
        .update(posMember)
        .set({ storedValue: toCents(newBalance) })
        .where(eq(posMember.id, memberId));

      const [logRow] = await tx
        .insert(posStoredLog)
        .values({
          memberId,
          change: toCents(amount),
          balance: toCents(newBalance),
          type: 'adjust',
          remark: dto.reason,
        })
        .returning();

      newLog = {
        id: logRow.id,
        memberId: logRow.memberId,
        change: fromCents(Number(logRow.change)),
        balance: fromCents(Number(logRow.balance)),
        type: logRow.type,
        sourceNo: logRow.sourceNo ?? undefined,
        remark: logRow.remark ?? undefined,
        createdAt: logRow.createdAt.toISOString(),
      };

      // P0-2：储值调整审计（与调整同事务，失败仅告警不回滚主流程）
      await auditAction(tx, {
        storeId: null,
        employeeId: operatorId ?? null,
        module: 'members',
        action: 'stored_adjust',
        targetNo: memberId,
        content: { memberId, amount, reason: dto.reason },
      });
    });

    if (!newLog) {
      throw new BadRequestException('调整失败');
    }
    return newLog;
  }

  private mapMember(row: typeof posMember.$inferSelect): Member {
    return {
      id: row.id,
      memberNo: row.memberNo,
      name: row.name ?? undefined,
      // P1-b：会员手机号脱敏返回，避免隐私合规风险与批量 dump。
      phone: maskPhone(row.phone),
      gender: row.gender ?? undefined,
      birthday: row.birthday ? new Date(row.birthday).toISOString().split('T')[0] : undefined,
      level: row.level,
      points: row.points,
      storedValue: fromCents(row.storedValue),
      preferSize: row.preferSize ?? undefined,
      preferStyle: row.preferStyle ?? undefined,
      totalSpent: fromCents(row.totalSpent),
      totalCount: row.totalCount,
      lastPurchaseAt: row.lastPurchaseAt?.toISOString(),
      erpSyncAt: row.erpSyncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
