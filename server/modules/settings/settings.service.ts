import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import {
  posStore,
  posEmployee,
  posOperationLog,
} from '@server/database/schema';
import { eq, and, count, desc, sql, gte, lte } from 'drizzle-orm';
import type {
  Store,
  Employee,
  EmployeeQuery,
  ListResponse,
  PaymentMethod,
  PointsRule,
  OperationLog,
  OperationLogQuery,
} from '@shared/api.interface';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    ) {
    this.db = scopeDatabase(this.db);
  }

  async getStore(id?: string): Promise<Store | null> {
    const conditions = [];
    if (id) conditions.push(eq(posStore.id, id));

    const rows = await this.db
      .select()
      .from(posStore)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address ?? undefined,
      phone: row.phone ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getEmployees(query: EmployeeQuery): Promise<ListResponse<Employee>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posEmployee.storeId, query.storeId));
    if (query.role) conditions.push(eq(posEmployee.role, query.role));
    if (query.status) conditions.push(eq(posEmployee.status, query.status));
    if (query.keyword) {
      conditions.push(
        sql`(${posEmployee.name} || ' ' || ${posEmployee.code}) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posEmployee)
        .where(whereClause),
      this.db
        .select()
        .from(posEmployee)
        .where(whereClause)
        .orderBy(desc(posEmployee.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        role: row.role,
        storeId: row.storeId ?? undefined,
        status: row.status,
        language: row.language ?? 'zh-CN',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 返回当前登录员工档案（含已保存的语种偏好），供前端初始化语言。 */
  async getCurrentEmployee(employeeId: string): Promise<Employee | null> {
    const rows = await this.db
      .select()
      .from(posEmployee)
      .where(eq(posEmployee.id, employeeId))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      role: row.role,
      storeId: row.storeId ?? undefined,
      status: row.status,
      language: row.language ?? 'zh-CN',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 当前登录员工更新自己的语种偏好（个人独立配置，仅改自己）。 */
  async updateCurrentEmployeeLanguage(
    employeeId: string,
    language: string,
  ): Promise<{ language: string }> {
    if (language !== 'zh-CN' && language !== 'en') {
      throw new BadRequestException('不支持的语种');
    }
    await this.db
      .update(posEmployee)
      .set({ language })
      .where(eq(posEmployee.id, employeeId));
    return { language };
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    // 支付方式配置 - 内置默认配置
    const methods: PaymentMethod[] = [
      { code: 'cash', name: '现金', type: 'cash', enabled: true, sortOrder: 1 },
      { code: 'wechat', name: '微信支付', type: 'digital', enabled: true, sortOrder: 2 },
      { code: 'alipay', name: '支付宝', type: 'digital', enabled: true, sortOrder: 3 },
      { code: 'unionpay', name: '银联卡', type: 'card', enabled: true, sortOrder: 4 },
      { code: 'stored_value', name: '储值卡', type: 'stored', enabled: true, sortOrder: 5 },
      { code: 'points', name: '积分抵扣', type: 'points', enabled: true, sortOrder: 6 },
    ];
    return methods;
  }

  async getPointsRules(): Promise<PointsRule[]> {
    // 积分规则配置
    const rules: PointsRule[] = [
      {
        id: 'rule-1',
        name: '基础积分规则',
        pointsPerYuan: 1,
        minAmount: 0,
        enabled: true,
      },
      {
        id: 'rule-2',
        name: 'VIP会员双倍积分',
        pointsPerYuan: 2,
        minAmount: 0,
        enabled: true,
      },
    ];
    return rules;
  }

  async getOperationLogs(query: OperationLogQuery): Promise<ListResponse<OperationLog>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.storeId) conditions.push(eq(posOperationLog.storeId, query.storeId));
    if (query.module) conditions.push(eq(posOperationLog.module, query.module));
    if (query.action) conditions.push(eq(posOperationLog.action, query.action));
    if (query.keyword) {
      conditions.push(
        sql`(${posOperationLog.targetNo} || ' ' || COALESCE(${posOperationLog.content}, '')) ILIKE ${'%' + query.keyword + '%'}`,
      );
    }
    if (query.startDate) conditions.push(gte(posOperationLog.createdAt, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(posOperationLog.createdAt, new Date(query.endDate)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posOperationLog)
        .where(whereClause),
      this.db
        .select()
        .from(posOperationLog)
        .where(whereClause)
        .orderBy(desc(posOperationLog.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        storeId: row.storeId ?? undefined,
        employeeId: row.employeeId ? String(row.employeeId) : undefined,
        module: row.module,
        action: row.action,
        targetNo: row.targetNo ?? undefined,
        content: row.content ?? undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
