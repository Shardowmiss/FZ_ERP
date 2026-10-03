import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, desc, and, like, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  member,
  memberTag,
  memberPoint,
  retailOrder,
  retailOrderItem,
  style,
} from '@server/database/schema';
import { NumberGeneratorService } from '@server/modules/system/code-rule/number-generator.service';
import { round2 } from '../../common/utils/money';
import type {
  Member,
  MemberTag,
  MemberPoint,
  MemberProfile,
  CampaignResult,
} from '@shared/api.interface';
import { maskMemberPii } from '@server/common/data-scope/pii';
import { encryptField, hmacField } from '@server/common/crypto/field-encryption';
import { MemberWalletService } from './member-wallet.service';


@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly walletService: MemberWalletService,
  ) {}

  /** 将数据库行转为前端 Member 视图：解密脱敏 + 数值字段归一（storedValue 单位=分 → number） */
  private toMember(r: typeof member.$inferSelect): Member {
    const base = maskMemberPii(r);
    return {
      ...base,
      email: base.email ?? undefined,
      storedValue: Number(base.storedValue ?? 0),
    } as unknown as Member;
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    level?: string;
  }): Promise<{ list: Member[]; total: number }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 20));
    const conditions: ReturnType<typeof eq>[] = [isNull(member.deletedAt)];
    if (params.keyword)
      conditions.push(like(member.name, `%${params.keyword}%`));
    if (params.level) conditions.push(eq(member.level, params.level));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(member)
        .where(where)
        .orderBy(desc(member.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ c: sql`count(*)` }).from(member).where(where),
    ]);

    return {
      list: rows.map((r) => this.toMember(r)),
      total: Number(countRows[0]?.c ?? 0),
    };
  }

  async create(body: Partial<Member>): Promise<Member> {
    const prefix = `M${new Date().getFullYear()}`;
    const row = await this.db.transaction(async (tx) => {
      const memberNo = await this.numberGenerator.generateNextNo(
        tx,
        member,
        member.memberNo,
        prefix,
        5,
      );
      const [r] = await tx
        .insert(member)
        .values({
          memberNo,
          name: body.name ?? '',
          phone: encryptField(body.phone),
          phoneHmac: hmacField(body.phone),
          gender: body.gender ?? 'unknown',
          birthday: body.birthday as never,
          level: body.level ?? 'normal',
          tagIds: (body.tagIds ?? []) as never,
          email: body.email ? String(body.email) : null,
          remark: body.remark,
          status: body.status ?? 'active',
        })
        .returning();
      return r;
    });
    return this.toMember(row);
  }

  async update(id: string, body: Partial<Member>): Promise<Member> {
    const [row] = await this.db
      .update(member)
      .set({
        name: body.name,
        gender: body.gender,
        birthday: body.birthday as never,
        level: body.level,
        tagIds: body.tagIds ? ((body.tagIds as never) ?? undefined) : undefined,
        email: body.email === undefined ? undefined : String(body.email),
        remark: body.remark,
        status: body.status,
        // P0-2：仅在请求携带 phone 时重加密（PATCH 语义，不破坏既有密文/指纹）
        ...(body.phone !== undefined
          ? { phone: encryptField(body.phone), phoneHmac: hmacField(body.phone) }
          : {}),
      })
      .where(eq(member.id, id))
      .returning();
    return this.toMember(row);
  }

  /** #10 软删除：仅置位 _deleted_at（member.status 约束不含 deleted，且钱包流水 cascade 禁止硬删） */
  async deleteMember(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('会员不存在');

    await this.db
      .update(member)
      .set({ deletedAt: new Date(), status: 'disabled', updatedAt: new Date() })
      .where(eq(member.id, id));
    this.logger.log(`软删除会员成功: id=${id}`);
  }

  /**
   * #10 储值调整：复用 MemberWalletService 的钱包账本范式（幂等事件 + SQL 层原子余额 + 防透支）。
   * 每次手工调整使用唯一 eventKey，确保逐笔入账、不重复、不读-算-写。
   */
  async adjustStoredValue(memberId: string, changeValue: number, operator?: string) {
    return this.db.transaction(async (tx) => {
      const [m] = await tx
        .select({ id: member.id })
        .from(member)
        .where(eq(member.id, memberId))
        .limit(1);
      if (!m) throw new NotFoundException('会员不存在');

      const eventKey = `adjust-sv:${memberId}:${randomUUID()}`;
      const res = await this.walletService.applyWalletEvent(
        {
          eventKey,
          memberId,
          kind: 'stored_value',
          changeValue,
          sourceType: 'adjust',
          sourceNo: operator,
        },
        tx,
      );
      if (res.status === 'rejected') {
        throw new BadRequestException(res.message ?? '储值调整被拒');
      }
      return res;
    });
  }

  async adjustPoints(
    memberId: string,
    changeType: string,
    changeValue: number,
    remark?: string,
  ): Promise<MemberPoint> {
    return this.db.transaction(async (tx) => {
      const [m] = await tx
        .select({ points: member.points })
        .from(member)
        .where(eq(member.id, memberId))
        .limit(1);
      if (!m) throw new NotFoundException('会员不存在');
      const balance = (m.points ?? 0) + changeValue;
      const [p] = await tx
        .insert(memberPoint)
        .values({
          memberId,
          changeType,
          changeValue,
          balance,
          remark,
        })
        .returning();
      await tx
        .update(member)
        .set({ points: balance })
        .where(eq(member.id, memberId));
      return p as unknown as MemberPoint;
    });
  }

  async listTags(): Promise<MemberTag[]> {
    return (await this.db.select().from(memberTag).orderBy(memberTag.name)) as unknown as MemberTag[];
  }

  async createTag(name: string, remark?: string): Promise<MemberTag> {
    const [row] = await this.db
      .insert(memberTag)
      .values({ name, remark })
      .returning();
    return row as unknown as MemberTag;
  }

  async profile(memberId: string): Promise<MemberProfile> {
    const [m] = await this.db
      .select()
      .from(member)
      .where(eq(member.id, memberId))
      .limit(1);
    if (!m) throw new NotFoundException('会员不存在');

    const orderRows = (await this.db.execute(sql`
      SELECT COALESCE(SUM(receivable_amount),0) AS amt, COUNT(*) AS cnt,
             MAX(sale_date) AS last_date
      FROM retail_order
      WHERE member_id = ${memberId} AND status IN ('settled','returned')
    `)) as unknown as Array<{ amt: string; cnt: string; last_date: string }>;

    const catRows = (await this.db.execute(sql`
      SELECT st.category AS category, COALESCE(SUM(roi.line_amount),0) AS amount, SUM(roi.quantity) AS qty
      FROM retail_order_item roi
      JOIN retail_order ro ON roi.retail_id = ro.id
      LEFT JOIN style st ON roi.style_no = st.style_no
      WHERE ro.member_id = ${memberId} AND ro.status IN ('settled','returned')
      GROUP BY st.category ORDER BY 2 DESC
    `)) as unknown as Array<{ category: string | null; amount: string; qty: string }>;

    const topRows = (await this.db.execute(sql`
      SELECT roi.style_no AS style_no, SUM(roi.quantity) AS qty, COALESCE(SUM(roi.line_amount),0) AS amount
      FROM retail_order_item roi
      JOIN retail_order ro ON roi.retail_id = ro.id
      WHERE ro.member_id = ${memberId} AND ro.status IN ('settled','returned')
      GROUP BY roi.style_no ORDER BY 2 DESC LIMIT 10
    `)) as unknown as Array<{ style_no: string; qty: string; amount: string }>;

    const monthRows = (await this.db.execute(sql`
      SELECT to_char(sale_date,'YYYY-MM') AS month, COALESCE(SUM(receivable_amount),0) AS amount
      FROM retail_order
      WHERE member_id = ${memberId} AND status IN ('settled','returned')
      GROUP BY 1 ORDER BY 1
    `)) as unknown as Array<{ month: string; amount: string }>;

    const totalSpent = Number(round2(Number(orderRows[0]?.amt ?? 0)));
    const orderCount = Number(orderRows[0]?.cnt ?? 0);

    return {
      memberId,
      memberName: (m as unknown as Member).name,
      totalSpent,
      orderCount,
      points: (m as unknown as Member).points,
      avgOrderValue: orderCount ? Number(round2(totalSpent / orderCount)) : 0,
      lastPurchaseDate: orderRows[0]?.last_date,
      categoryBreakdown: catRows.map((r) => ({
        category: r.category ?? '(未分类)',
        amount: Number(round2(Number(r.amount ?? 0))),
        qty: Number(r.qty ?? 0),
      })),
      topStyles: topRows.map((r) => ({
        styleNo: r.style_no,
        qty: Number(r.qty ?? 0),
        amount: Number(round2(Number(r.amount ?? 0))),
      })),
      purchaseMonths: monthRows.map((r) => ({
        month: r.month,
        amount: Number(round2(Number(r.amount ?? 0))),
      })),
    };
  }

  async campaign(
    tagId: string,
    title: string,
    content?: string,
  ): Promise<CampaignResult> {
    const [tag] = await this.db
      .select()
      .from(memberTag)
      .where(eq(memberTag.id, tagId))
      .limit(1);
    if (!tag) throw new NotFoundException('标签不存在');
    const rows = await this.db
      .select({ id: member.id })
      .from(member)
      .where(sql`${member.tagIds}::jsonb ? ${tagId}`);
    // 模拟推送：记录受影响会员数（实际可对接短信/微信模板）
    this.logger.log(
      `营销推送[${title}] 至标签 ${tag.name}，覆盖 ${rows.length} 人，内容：${content ?? ''}`,
    );
    return {
      tagId,
      tagName: (tag as unknown as MemberTag).name,
      affectedCount: rows.length,
      title,
    };
  }
}
