import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  rbacUser,
  rbacRole,
  rbacPermission,
  rbacUserRole,
  rbacRolePermission,
  rbacUserToken,
  rbacUserStore,
  store,
  dealer,
} from '@server/database/schema';
import { eq, and, count, desc, or, ilike, inArray, asc, isNull, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { escapeLike } from '@server/common/utils/escape-like';
import { encryptField, hmacField, decryptField } from '@server/common/crypto/field-encryption';
import { TTL, cached, invalidate } from '@server/common/cache';
import type { DealerScope } from '@server/common/context/request-context';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import type {
  RbacUser,
  RbacRole,
  RbacPermission,
  LoginResponse,
  CurrentUserResponse,
  PaginationResult,
} from '@shared/api.interface';

type RbacUserInsert = typeof rbacUser.$inferInsert;
type RbacRoleInsert = typeof rbacRole.$inferInsert;

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // ─── Password helpers ────────────────────────────────────────────────

  private hashPassword(password: string): string {
    return bcrypt.hashSync(password, 10);
  }

  private verifyPassword(password: string, hashedPassword: string): boolean {
    if (!hashedPassword) return false;
    // pbkdf2 format: salt:hash
    if (hashedPassword.includes(':') && !hashedPassword.startsWith('$')) {
      const parts = hashedPassword.split(':');
      if (parts.length === 2) {
        const [salt, storedHash] = parts;
        const hash = crypto
          .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
          .toString('hex');
        // 使用恒定时间比较，避免时序攻击
        try {
          const a = Buffer.from(hash, 'hex');
          const b = Buffer.from(storedHash, 'hex');
          return a.length === b.length && crypto.timingSafeEqual(a, b);
        } catch {
          return false;
        }
      }
    }
    // bcrypt format: $2b$... (seed data uses Python bcrypt)
    if (hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2a$')) {
      return bcrypt.compareSync(password, hashedPassword);
    }
    return false;
  }

  // ─── Token management (DB-backed) ───────────────────────────────────

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async setToken(token: string, userId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await this.db.insert(rbacUserToken).values({
      token,
      userId,
      expiresAt,
    });
    void this.cleanupExpiredTokens();
  }

  private async getTokenUserId(token: string): Promise<string | null> {
    const rows = await this.db
      .select({ userId: rbacUserToken.userId, expiresAt: rbacUserToken.expiresAt })
      .from(rbacUserToken)
      .where(eq(rbacUserToken.token, token))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    if (new Date() > row.expiresAt) {
      await this.db.delete(rbacUserToken).where(eq(rbacUserToken.token, token));
      return null;
    }

    const newExpiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    const remainMs = row.expiresAt.getTime() - Date.now();
    if (remainMs < TOKEN_TTL_MS * 0.5) {
      await this.db
        .update(rbacUserToken)
        .set({ expiresAt: newExpiresAt })
        .where(eq(rbacUserToken.token, token));
    }

    return row.userId;
  }

  private async removeToken(token: string): Promise<void> {
    await this.db.delete(rbacUserToken).where(eq(rbacUserToken.token, token));
  }

  private async cleanupExpiredTokens(): Promise<void> {
    try {
      await this.db.delete(rbacUserToken).where(lt(rbacUserToken.expiresAt, new Date()));
    } catch {
      // cleanup is best-effort, ignore errors
    }
  }

  // ─── Permission tree builder ────────────────────────────────────────

  private buildTree(permissions: RbacPermission[]): RbacPermission[] {
    const map = new Map<string, RbacPermission>();
    const roots: RbacPermission[] = [];

    for (const p of permissions) {
      map.set(p.id, { ...p, children: [] });
    }
    for (const p of permissions) {
      const node = map.get(p.id)!;
      if (p.parentId && map.has(p.parentId)) {
        const parent = map.get(p.parentId)!;
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    // Sort by sortOrder recursively
    const sortRecursive = (nodes: RbacPermission[]): RbacPermission[] => {
      nodes.sort((a, b) => a.sortOrder - b.sortOrder);
      for (const n of nodes) {
        if (n.children && n.children.length > 0) {
          sortRecursive(n.children);
        }
      }
      return nodes;
    };
    return sortRecursive(roots);
  }

  private mapPermissionRow(row: typeof rbacPermission.$inferSelect): RbacPermission {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      parentId: row.parentId ?? undefined,
      sortOrder: row.sortOrder ?? 0,
    };
  }

  private mapUserRow(row: typeof rbacUser.$inferSelect): RbacUser {
    return {
      id: row.id,
      username: row.username,
      name: row.name,
      phone: decryptField(row.phone) ?? undefined,
      department: row.department ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      language: row.language ?? 'zh-CN',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapRoleRow(row: typeof rbacRole.$inferSelect): RbacRole {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status,
    };
  }

  // ─── Auth methods ───────────────────────────────────────────────────

  async login(username: string, password: string): Promise<LoginResponse> {
    if (!username?.trim()) throw new BadRequestException('用户名不能为空');
    if (!password) throw new BadRequestException('密码不能为空');

    const users = await this.db
      .select()
      .from(rbacUser)
      .where(eq(rbacUser.username, username))
      .limit(1);

    if (users.length === 0) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const userRow = users[0];
    if (userRow.status !== 'active') {
      throw new UnauthorizedException('账号已被禁用');
    }

    const valid = this.verifyPassword(password, userRow.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const token = this.generateToken();
    await this.setToken(token, userRow.id);

    const user = this.mapUserRow(userRow);
    const { menus, permissions } = await this.getUserPermissions(userRow.id);
    const roleIds = await this.getUserRoles(userRow.id);
    user.roleIds = roleIds;

    return { token, user, menus, permissions };
  }

  async getCurrentUser(token: string): Promise<CurrentUserResponse> {
    const userId = await this.getTokenUserId(token);
    if (!userId) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const users = await this.db
      .select()
      .from(rbacUser)
      .where(eq(rbacUser.id, userId))
      .limit(1);

    if (users.length === 0) {
      throw new UnauthorizedException('用户不存在');
    }

    const user = this.mapUserRow(users[0]);
    const { menus, permissions } = await this.getUserPermissions(userId);
    const roleIds = await this.getUserRoles(userId);
    user.roleIds = roleIds;

    return { user, menus, permissions };
  }

  /**
   * 更新「当前登录用户」的个人语种偏好（user.language）。
   * 由 /api/auth/me/language 调用：用户身份由 token 确定，无需特殊权限，
   * 任何已登录个人均可修改自己的语种（满足「个人用户在系统设置中单独配置语种」）。
   */
  async updateCurrentUserLanguage(
    token: string,
    language: string,
  ): Promise<CurrentUserResponse> {
    const userId = await this.getTokenUserId(token);
    if (!userId) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (language !== 'zh-CN' && language !== 'en') {
      throw new BadRequestException('不支持的语种');
    }
    await this.db
      .update(rbacUser)
      .set({ language, updatedAt: new Date() })
      .where(eq(rbacUser.id, userId));
    return this.getCurrentUser(token);
  }

  async logout(token: string): Promise<void> {
    await this.removeToken(token);
  }

  async checkPermission(token: string, permissionCode: string): Promise<boolean> {
    const userId = await this.getTokenUserId(token);
    if (!userId) return false;
    const { permissions } = await this.getUserPermissions(userId);
    return permissions.includes(permissionCode);
  }

  /**
   * 权限目录（权威清单）。
   *
   * 支持「资源树 + 动作子节点」模型：
   * - `type: 'group'` 表示资源/模块分组（如 `purchase:inbound`），
   *   其下挂的 `parent: 'purchase:inbound'` 子码即为可独立授权的动作
   *   （view/create/edit/approve/accept/void/delete）。
   * - `type: 'api'` 为普通写入口权限码；`type: 'menu'` 为菜单门控码。
   * - `parent` 指向上级分组的 code；`sortOrder` 控制同组内子节点排序。
   *
   * 任何新增的“写入口权限码”都应在本清单登记……
   */
  private static readonly PERMISSION_CATALOG: {
    code: string;
    name: string;
    type?: 'api' | 'group' | 'menu';
    parent?: string;
    sortOrder?: number;
  }[] = [
    { code: 'dashboard', name: '仪表盘' },
    { code: 'dashboard:view', name: '仪表盘-查看' },
    { code: 'base:style', name: '基础-款式' },
    { code: 'base:sku', name: '基础-SKU' },
    { code: 'base:import', name: '基础-批量导入' },
    { code: 'base:material', name: '基础-物料' },
    { code: 'base:color', name: '基础-颜色' },
    { code: 'base:size', name: '基础-尺码' },
    { code: 'base:supplier', name: '基础-供应商' },
    { code: 'base:warehouse', name: '基础-仓库' },
    { code: 'base:dealer', name: '基础-经销商' },
    { code: 'base:store', name: '基础-门店' },
    { code: 'purchase:order', name: '采购-订单' },
    // 采购-入库：资源分组（type=group），下挂 7 个可独立授权的动作子节点。
    // 既有的 purchasing / warehouse 角色仍只持有分组码 `purchase:inbound`，
    // 由 ensureOperationalRoles 自动展开授予全部子码，保证零改造兼容。
    { code: 'purchase:inbound', name: '采购-入库', type: 'group' },
    { code: 'purchase:inbound:view', name: '查看', parent: 'purchase:inbound', sortOrder: 1 },
    { code: 'purchase:inbound:create', name: '新增', parent: 'purchase:inbound', sortOrder: 2 },
    { code: 'purchase:inbound:edit', name: '编辑', parent: 'purchase:inbound', sortOrder: 3 },
    { code: 'purchase:inbound:approve', name: '审核', parent: 'purchase:inbound', sortOrder: 4 },
    { code: 'purchase:inbound:accept', name: '验收', parent: 'purchase:inbound', sortOrder: 5 },
    { code: 'purchase:inbound:void', name: '作废', parent: 'purchase:inbound', sortOrder: 6 },
    { code: 'purchase:inbound:delete', name: '删除', parent: 'purchase:inbound', sortOrder: 7 },
    { code: 'purchase:return', name: '采购-退货' },
    { code: 'purchase:reconciliation', name: '采购-对账' },
    { code: 'production:bom', name: '生产-BOM' },
    { code: 'production:material_order', name: '生产-物料订单' },
    { code: 'production:material_inbound', name: '生产-物料入库' },
    { code: 'production:mrp', name: '生产-MRP' },
    { code: 'production:cost', name: '生产-成本' },
    { code: 'production:work_order', name: '生产-工单' },
    { code: 'production:material_issue', name: '生产-发料' },
    { code: 'production:finish_receipt', name: '生产-成品入库' },
    // 销售-订单：资源分组（type=group），下挂 7 个可独立授权的动作子节点。
    // 既有的 warehouse 角色仍只持有分组码 `sales:order`，
    // 由 ensureOperationalRoles 自动展开授予全部子码，保证零改造兼容。
    { code: 'sales:order', name: '销售-订单', type: 'group' },
    { code: 'sales:order:view', name: '查看', parent: 'sales:order', sortOrder: 1 },
    { code: 'sales:order:create', name: '新增', parent: 'sales:order', sortOrder: 2 },
    { code: 'sales:order:edit', name: '编辑', parent: 'sales:order', sortOrder: 3 },
    { code: 'sales:order:approve', name: '审核', parent: 'sales:order', sortOrder: 4 },
    { code: 'sales:order:delete', name: '删除', parent: 'sales:order', sortOrder: 5 },
    { code: 'sales:order:void', name: '作废', parent: 'sales:order', sortOrder: 6 },
    { code: 'sales:order:print', name: '打印', parent: 'sales:order', sortOrder: 7 },
    { code: 'sales:outbound', name: '销售-出库' },
    { code: 'sales:return', name: '销售-退货' },
    { code: 'sales:reconciliation', name: '销售-对账' },
    { code: 'sales:view', name: '销售-查看' },
    { code: 'inventory:flow', name: '库存-流水' },
    { code: 'inventory:query', name: '库存-查询' },
    { code: 'inventory:inbound', name: '库存-入库' },
    { code: 'inventory:outbound', name: '库存-出库' },
    { code: 'inventory:transfer', name: '库存-调拨' },
    { code: 'inventory:stocktake', name: '库存-盘点' },
    { code: 'inventory:replenish-plan', name: '库存-补货计划' },
    { code: 'inventory:replenish-template', name: '库存-补货模板' },
    { code: 'inventory:warning', name: '库存-预警' },
    { code: 'pos:receiver:manage', name: 'POS接收-补偿管理' },
    { code: 'finance:receivable', name: '财务-应收' },
    { code: 'finance:payable', name: '财务-应付' },
    { code: 'finance:receipt', name: '财务-收款' },
    { code: 'finance:payment', name: '财务-付款' },
    { code: 'finance:profit', name: '财务-利润' },
    { code: 'system:permission', name: '系统-权限' },
    { code: 'system:user', name: '系统-用户' },
    { code: 'system:role', name: '系统-角色' },
    { code: 'system:operation_log', name: '系统-操作日志' },
    { code: 'system:config', name: '系统-配置' },
    { code: 'tradeshow:preorder', name: '展会-预购' },
    { code: 'tradeshow:allocation', name: '展会-配货' },
    { code: 'tradeshow:manage', name: '展会-管理' },
    { code: 'tradeshow:theme', name: '展会-主题主数据' },
    { code: 'report:garment_purchase', name: '报表-成衣采购' },
    { code: 'report:material_purchase', name: '报表-物料采购' },
    { code: 'report:sales', name: '报表-销售' },
    { code: 'report:retail', name: '报表-零售' },
    { code: 'report:inventory', name: '报表-库存' },
    { code: 'report:transfer', name: '报表-调拨' },
    { code: 'report:stockmovement', name: '报表-库存变动' },
    { code: 'report:pivot', name: '报表-透视分析' },
    { code: 'retail:view', name: '零售-查看' },
    { code: 'pos:cashier', name: 'POS-收银' },
    { code: 'pricing:manage', name: '价格-管理' },
    { code: 'member:manage', name: '会员-管理' },
    { code: 'member:merge', name: '会员-合并（主数据去重，资金敏感）' },
    { code: 'member:level', name: '会员-等级主数据' },
    { code: 'md:merge', name: '主数据-合并（商品/客户去重，泛化）' },
    { code: 'omni:manage', name: '全渠道-管理' },
    { code: 'subcontract:manage', name: '委外-管理' },
    { code: 'product:barcode', name: '商品-条形码管理' },
  ];

  /** 超级管理员角色固定 UUID（与迁移 0005 保持一致） */
  private static readonly SUPER_ADMIN_ROLE_ID = '11111111-1111-1111-1111-111111111111';

  /**
   * 启动时幂等确保权限目录完整且超级管理员持有全部权限。
   *
   * - 第 1 步：把 PERMISSION_CATALOG 全部写入 rbac_permission（已存在则跳过）。
   * - 第 2 步：确保 super_admin 角色存在（固定 UUID，已存在则跳过）。
   * - 第 3 步：将全部权限授予 super_admin（已授权则跳过）。
   *
   * 作用：新增权限码后无需手动改库；同时防止“写授权”改造把管理员锁在门外。
   * 由 AppModule.onModuleInit 调用一次。
   */
  async ensureRbacCatalog(): Promise<void> {
    // 第 1 遍：按目录 upsert 全部权限码（含 type 纠正，分组码由此从 'api' 改 'group'）。
    // 子节点的 parentId 暂留空，第 2 遍回填，避免插入时无法预知父节点 UUID。
    const catalogRows = RbacService.PERMISSION_CATALOG.map((p) => ({
      code: p.code,
      name: p.name,
      type: p.type ?? 'api',
      sortOrder: p.sortOrder ?? 0,
    }));
    await this.db
      .insert(rbacPermission)
      .values(catalogRows)
      .onConflictDoUpdate({
        target: rbacPermission.code,
        set: {
          name: sql`excluded.name`,
          type: sql`excluded.type`,
          sortOrder: sql`excluded.sort_order`,
        },
      });

    // 第 2 遍：按目录 parent 回填 parentId（子查询定位父节点 id，幂等可重跑）。
    for (const p of RbacService.PERMISSION_CATALOG) {
      if (!p.parent) continue;
      await this.db
        .update(rbacPermission)
        .set({
          parentId: sql`(SELECT id FROM rbac_permission WHERE code = ${p.parent})`,
        })
        .where(eq(rbacPermission.code, p.code));
    }

    await this.db
      .insert(rbacRole)
      .values({
        id: RbacService.SUPER_ADMIN_ROLE_ID,
        code: 'super_admin',
        name: '超级管理员',
        description: '持有全部权限，可见全部门店数据',
        status: 'active',
      })
      .onConflictDoNothing({ target: rbacRole.code });

    const allPerms = await this.db
      .select({ id: rbacPermission.id })
      .from(rbacPermission);
    const granted = await this.db
      .select({ pid: rbacRolePermission.permissionId })
      .from(rbacRolePermission)
      .where(eq(rbacRolePermission.roleId, RbacService.SUPER_ADMIN_ROLE_ID));
    const have = new Set(granted.map((g) => g.pid));
    const toAdd = allPerms
      .filter((p) => !have.has(p.id))
      .map((p) => ({ roleId: RbacService.SUPER_ADMIN_ROLE_ID, permissionId: p.id }));
    if (toAdd.length > 0) {
      await this.db
        .insert(rbacRolePermission)
        .values(toAdd)
        .onConflictDoNothing({
          target: [rbacRolePermission.roleId, rbacRolePermission.permissionId],
        });
    }
    // 启动安全网：若当前没有任何用户持有 super_admin（初始/演示态，迁移 0005 步骤 4 未执行），
    // 将 admin 用户（不存在则取首个用户）指派为超级管理员，避免“写授权”改造把唯一管理员锁在门外。
    const saHolderCount = await this.db
      .select({ c: count() })
      .from(rbacUserRole)
      .innerJoin(rbacRole, eq(rbacUserRole.roleId, rbacRole.id))
      .where(eq(rbacRole.code, 'super_admin'));
    if (Number(saHolderCount[0]?.c ?? 0) === 0) {
      const adminUser = await this.db
        .select({ id: rbacUser.id })
        .from(rbacUser)
        .where(eq(rbacUser.username, 'admin'))
        .limit(1);
      const target =
        adminUser[0] ??
        (await this.db.select({ id: rbacUser.id }).from(rbacUser).limit(1))[0];
      if (target) {
        await this.db
          .insert(rbacUserRole)
          .values({ userId: target.id, roleId: RbacService.SUPER_ADMIN_ROLE_ID })
          .onConflictDoNothing({
            target: [rbacUserRole.userId, rbacUserRole.roleId],
          });
        this.logger.log(
          `ensureRbacCatalog: assigned super_admin to user ${target.id}`,
        );
      }
    }

    // P1-c① 扩展：目录/角色权限可能随启动自愈变更，失效相关缓存避免脏读
    await invalidate(
      this.cacheManager,
      RbacService.PERM_TREE_KEY,
      RbacService.MENU_TREE_KEY,
    );

    this.logger.log(
      `ensureRbacCatalog done: ${allPerms.length} permission codes, granted ${toAdd.length} new to super_admin`,
    );
  }

  /**
   * 运营角色定义（与 68 码权限目录对齐，按古茗零售业务划分）。
   *
   * 注意：本清单是“权限建议矩阵”，仅描述各角色应持有的权限码；实际是否启用、
   * 是否拆分更细，由部署方在角色管理界面二次调整。种子只做“加法”——缺则建、
   * 缺则授权，绝不删除既有授权（避免启动自愈冲掉管理员在界面上的手动调整）。
   */
  private static readonly OPERATIONAL_ROLES: {
    code: string;
    name: string;
    description: string;
    permissions: string[];
  }[] = [
    {
      code: 'data_governor',
      name: '数据治理员',
      description: '主数据去重合并（会员/商品），资金敏感操作需培训',
      permissions: [
        'md:merge',
        'member:merge',
        'member:manage',
        'base:style',
        'base:sku',
        'base:color',
        'base:size',
        'base:import',
        'report:pivot',
        'dashboard:view',
      ],
    },
    {
      code: 'store_manager',
      name: '店长',
      description: '门店日常运营：零售/销售/收银/会员/库存查询与预警',
      permissions: [
        'base:store',
        'retail:view',
        'sales:view',
        'pos:cashier',
        'member:manage',
        'member:merge',
        'inventory:query',
        'inventory:flow',
        'inventory:warning',
        'pricing:manage',
        'dashboard:view',
        'report:retail',
        'report:sales',
        'report:stockmovement',
      ],
    },
    {
      code: 'finance',
      name: '财务',
      description: '应收应付/收款付款/利润与对账',
      permissions: [
        'finance:receivable',
        'finance:payable',
        'finance:receipt',
        'finance:payment',
        'finance:profit',
        'sales:reconciliation',
        'purchase:reconciliation',
        'dashboard:view',
        'report:garment_purchase',
        'report:material_purchase',
        'report:sales',
        'report:inventory',
      ],
    },
    {
      code: 'purchasing',
      name: '采购',
      description: '采购订单/入库/退货与生产关系、物料与供应商主数据',
      permissions: [
        'purchase:order',
        'purchase:inbound',
        'purchase:return',
        'purchase:reconciliation',
        'production:bom',
        'production:material_order',
        'production:material_inbound',
        'production:mrp',
        'production:cost',
        'production:work_order',
        'production:material_issue',
        'production:finish_receipt',
        'base:material',
        'base:supplier',
        'inventory:query',
        'report:material_purchase',
        'report:garment_purchase',
      ],
    },
    {
      code: 'warehouse',
      name: '仓储',
      description: '库存流水/入库/出库/调拨/盘点/补货与预警',
      permissions: [
        'inventory:flow',
        'inventory:query',
        'inventory:inbound',
        'inventory:outbound',
        'inventory:transfer',
        'inventory:stocktake',
        'inventory:replenish-plan',
        'inventory:replenish-template',
        'inventory:warning',
        'base:warehouse',
        'sales:outbound',
        'sales:order',
        'purchase:inbound',
        'report:inventory',
        'report:transfer',
        'report:stockmovement',
      ],
    },
  ];

  /**
   * 启动幂等补全运营角色（数据治理/店长/财务/采购/仓储）并授予对应权限码。
   *
   * 与 ensureRbacCatalog 同机制（按 code 反查 permission id），但采用“只增不删”
   * 的追加授权：仅补登缺失的 role_permission，不删除既有授权，避免启动自愈把
   * 管理员在界面上手动调过的授权冲掉。权限码若在目录中不存在（防御性）则跳过并告警。
   *
   * 由 AppModule.onModuleInit 在 ensureRbacCatalog 之后调用一次，随部署生效。
   */
  async ensureOperationalRoles(): Promise<void> {
    // 一次性拉取 code->id 映射
    const permRows = await this.db
      .select({ id: rbacPermission.id, code: rbacPermission.code })
      .from(rbacPermission);
    const codeToId = new Map<string, string>();
    for (const r of permRows) codeToId.set(r.code, r.id);

    // 构建 分组码 -> 子动作码列表 映射（用于向后兼容：持有分组码即连带授予其全部子动作码）
    const groupChildren = new Map<string, string[]>();
    for (const p of RbacService.PERMISSION_CATALOG) {
      if (p.parent) {
        const arr = groupChildren.get(p.parent) ?? [];
        arr.push(p.code);
        groupChildren.set(p.parent, arr);
      }
    }

    for (const def of RbacService.OPERATIONAL_ROLES) {
      const existing = await this.db
        .select({ id: rbacRole.id })
        .from(rbacRole)
        .where(eq(rbacRole.code, def.code))
        .limit(1);
      let roleId: string;
      if (existing.length === 0) {
        const created = await this.createRole({
          code: def.code,
          name: def.name,
          description: def.description,
          status: 'active',
        });
        roleId = created.id;
      } else {
        roleId = existing[0].id;
      }

      // 解析目标权限 id（跳过目录中不存在的码，防御性）
      const targetIds: string[] = [];
      const skipped: string[] = [];
      for (const code of def.permissions) {
        const pid = codeToId.get(code);
        if (pid) targetIds.push(pid);
        else skipped.push(code);
        // 分组码：连带授予其全部子动作码。purchase:inbound 同时是前端菜单/路由门控码，
        // 既有的 purchasing / warehouse 角色只声明了分组码，须展开子码以免动作权限缺失。
        const kids = groupChildren.get(code);
        if (kids) {
          for (const kc of kids) {
            const kpid = codeToId.get(kc);
            if (kpid) targetIds.push(kpid);
            else skipped.push(kc);
          }
        }
      }
      if (skipped.length > 0) {
        this.logger.warn(
          `ensureOperationalRoles: 角色 ${def.code} 跳过不存在的权限码: ${skipped.join(', ')}`,
        );
      }

      // 既有的授权
      const granted = await this.db
        .select({ pid: rbacRolePermission.permissionId })
        .from(rbacRolePermission)
        .where(eq(rbacRolePermission.roleId, roleId));
      const have = new Set(granted.map((g) => g.pid));
      const toAdd = targetIds
        .filter((pid) => !have.has(pid))
        .map((pid) => ({ roleId, permissionId: pid }));
      if (toAdd.length > 0) {
        await this.db
          .insert(rbacRolePermission)
          .values(toAdd)
          .onConflictDoNothing({
            target: [rbacRolePermission.roleId, rbacRolePermission.permissionId],
          });
      }

      // 失效该角色权限缓存（re-run 时确保立即生效）
      await invalidate(this.cacheManager, RbacService.rolePermsKey(roleId));

      this.logger.log(
        `ensureOperationalRoles: 角色 ${def.code} 目标 ${targetIds.length} 码，新增授权 ${toAdd.length}`,
      );
    }

    // 失效权限树/菜单树缓存，确保新增授权立即在界面/接口生效
    await invalidate(
      this.cacheManager,
      RbacService.PERM_TREE_KEY,
      RbacService.MENU_TREE_KEY,
    );
  }

  /** 校验 token 有效性并返回用户 ID（供 AuthGuard 调用） */
  async getUserIdByToken(token: string): Promise<string | null> {
    if (!token) return null;
    return this.getTokenUserId(token);
  }

  private async getUserPermissions(
    userId: string,
  ): Promise<{ menus: RbacPermission[]; permissions: string[] }> {
    // Get user's roles
    const userRoles = await this.db
      .select({ roleId: rbacUserRole.roleId })
      .from(rbacUserRole)
      .where(eq(rbacUserRole.userId, userId));

    if (userRoles.length === 0) {
      return { menus: [], permissions: [] };
    }

    const roleIds = userRoles.map((r) => r.roleId);

    // Get active roles
    const activeRoles = await this.db
      .select({ id: rbacRole.id })
      .from(rbacRole)
      .where(and(inArray(rbacRole.id, roleIds), eq(rbacRole.status, 'active')));

    if (activeRoles.length === 0) {
      return { menus: [], permissions: [] };
    }

    const activeRoleIds = activeRoles.map((r) => r.id);

    // Get permissions through role-permission links
    const rolePerms = await this.db
      .select({ permissionId: rbacRolePermission.permissionId })
      .from(rbacRolePermission)
      .where(inArray(rbacRolePermission.roleId, activeRoleIds));

    if (rolePerms.length === 0) {
      return { menus: [], permissions: [] };
    }

    const permIds = [...new Set(rolePerms.map((rp) => rp.permissionId))];

    // Get all permission details
    const allPerms = await this.db
      .select()
      .from(rbacPermission)
      .where(inArray(rbacPermission.id, permIds))
      .orderBy(asc(rbacPermission.sortOrder));

    // Collect all parent menu IDs and add them (so tree is properly nested)
    const parentIds = new Set<string>();
    for (const p of allPerms) {
      if (p.parentId) parentIds.add(p.parentId);
    }
    if (parentIds.size > 0) {
      const parentPerms = await this.db
        .select()
        .from(rbacPermission)
        .where(inArray(rbacPermission.id, Array.from(parentIds)));
      const existingIds = new Set(allPerms.map((p) => p.id));
      for (const pp of parentPerms) {
        if (!existingIds.has(pp.id)) {
          allPerms.push(pp);
        }
      }
    }

    const permissionList: RbacPermission[] = allPerms.map((row) =>
      this.mapPermissionRow(row),
    );
    const permissionCodes = permissionList
      .filter((p) => permIds.includes(p.id))
      .map((p) => p.code);

    // Build menu tree (only type=menu)
    const menuPerms = permissionList.filter((p) => p.type === 'menu');
    const menus = this.buildTree(menuPerms);

    return { menus, permissions: permissionCodes };
  }

  // ─── User CRUD ──────────────────────────────────────────────────────

  async getUserList(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: string;
  }): Promise<PaginationResult<RbacUser>> {
    const { page, pageSize, keyword, status } = params;
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        or(
          ilike(rbacUser.username, `%${escaped}%`),
          ilike(rbacUser.name, `%${escaped}%`),
        ),
      );
    }
    if (status) {
      conditions.push(eq(rbacUser.status, status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(rbacUser).where(where as any),
      this.db
        .select()
        .from(rbacUser)
        .where(where as any)
        .orderBy(desc(rbacUser.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: RbacUser[] = rows.map((row) => this.mapUserRow(row));

    // Enrich with role ids
    if (items.length > 0) {
      const userIds = items.map((u) => u.id);
      const userRoleRows = await this.db
        .select({ userId: rbacUserRole.userId, roleId: rbacUserRole.roleId })
        .from(rbacUserRole)
        .where(inArray(rbacUserRole.userId, userIds));
      const roleMap = new Map<string, string[]>();
      for (const ur of userRoleRows) {
        if (!roleMap.has(ur.userId)) roleMap.set(ur.userId, []);
        roleMap.get(ur.userId)!.push(ur.roleId);
      }
      for (const item of items) {
        item.roleIds = roleMap.get(item.id) ?? [];
      }
    }

    return { items, total, page, pageSize };
  }

  async getUser(id: string): Promise<RbacUser> {
    const rows = await this.db.select().from(rbacUser).where(eq(rbacUser.id, id));
    if (rows.length === 0) throw new NotFoundException('用户不存在');
    const user = this.mapUserRow(rows[0]);
    user.roleIds = await this.getUserRoles(id);
    return user;
  }

  async createUser(data: {
    username: string;
    name: string;
    password: string;
    phone?: string;
    department?: string;
    status?: string;
    remark?: string;
    roleIds?: string[];
  }): Promise<RbacUser> {
    if (!data.username?.trim()) throw new BadRequestException('用户名不能为空');
    if (!data.name?.trim()) throw new BadRequestException('姓名不能为空');
    if (!data.password) throw new BadRequestException('密码不能为空');
    if (data.password.length < 6)
      throw new BadRequestException('密码长度不能少于6位');

    const existing = await this.db
      .select()
      .from(rbacUser)
      .where(eq(rbacUser.username, data.username));
    if (existing.length > 0) throw new ConflictException('用户名已存在');

    const passwordHash = this.hashPassword(data.password);

    const values: RbacUserInsert = {
      username: data.username,
      name: data.name,
      passwordHash,
      phone: encryptField(data.phone) ?? null,
      phoneHmac: hmacField(data.phone),
      department: data.department ?? null,
      status: data.status ?? 'active',
      remark: data.remark ?? null,
    };

    const inserted = await this.db
      .insert(rbacUser)
      .values(values)
      .returning();
    const user = this.mapUserRow(inserted[0]);

    if (data.roleIds && data.roleIds.length > 0) {
      await this.assignUserRoles(user.id, data.roleIds);
    }
    user.roleIds = data.roleIds ?? [];

    return user;
  }

  async updateUser(
    id: string,
    data: {
      username?: string;
      name?: string;
      password?: string;
      phone?: string;
      department?: string;
      status?: string;
      remark?: string;
      language?: string;
    },
  ): Promise<RbacUser> {
    const patch: Partial<RbacUserInsert> = {};

    if (data.username !== undefined) {
      if (!data.username.trim()) throw new BadRequestException('用户名不能为空');
      // Check uniqueness
      const existing = await this.db
        .select()
        .from(rbacUser)
        .where(
          and(eq(rbacUser.username, data.username), eq(rbacUser.id, id)),
        );
      const other = await this.db
        .select()
        .from(rbacUser)
        .where(
          and(eq(rbacUser.username, data.username)),
        );
      if (other.length > 0 && other[0].id !== id) {
        throw new ConflictException('用户名已存在');
      }
      patch.username = data.username;
    }
    if (data.name !== undefined) {
      if (!data.name.trim()) throw new BadRequestException('姓名不能为空');
      patch.name = data.name;
    }
    if (data.password !== undefined && data.password !== '') {
      if (data.password.length < 6)
        throw new BadRequestException('密码长度不能少于6位');
      patch.passwordHash = this.hashPassword(data.password);
    }
    if (data.phone !== undefined) {
      patch.phone = encryptField(data.phone) ?? null;
      patch.phoneHmac = hmacField(data.phone);
    }
    if (data.department !== undefined) {
      patch.department = data.department ?? null;
    }
    if (data.status !== undefined) {
      patch.status = data.status;
    }
    if (data.remark !== undefined) {
      patch.remark = data.remark ?? null;
    }
    if (data.language !== undefined) {
      if (data.language !== 'zh-CN' && data.language !== 'en') {
        throw new BadRequestException('不支持的语种');
      }
      patch.language = data.language;
    }

    if (Object.keys(patch).length === 0)
      throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(rbacUser)
      .set(patch)
      .where(eq(rbacUser.id, id))
      .returning();
    if (updated.length === 0) throw new NotFoundException('用户不存在');

    const user = this.mapUserRow(updated[0]);
    user.roleIds = await this.getUserRoles(id);
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    const deleted = await this.db
      .delete(rbacUser)
      .where(eq(rbacUser.id, id))
      .returning({ id: rbacUser.id });
    if (deleted.length === 0) throw new NotFoundException('用户不存在');
  }

  // ─── Data scope (row-level permission) ──────────────────────────────

  /**
   * 判断用户是否为超级管理员（持有 code='super_admin' 的启用角色）。
   * 超级管理员可见全部门店数据（数据域 type='all'）。
   */
  async isSuperAdmin(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: rbacRole.id })
      .from(rbacUserRole)
      .innerJoin(rbacRole, eq(rbacUserRole.roleId, rbacRole.id))
      .where(
        and(
          eq(rbacUserRole.userId, userId),
          eq(rbacRole.code, 'super_admin'),
          eq(rbacRole.status, 'active'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * 解析用户的数据域（行级权限，最小权限原则）：
   * - 超级管理员 → { type:'all' }（可见全部门店）
   * - 普通用户且有门店映射 → { type:'store', storeIds }
   * - 普通用户无门店映射 → { type:'store', storeIds:[] }（不可见任何门店数据）
   *
   * 注意：与早期“无映射即全部可见”的实现不同，这里默认最小权限，
   * 避免新用户/遗漏配置获得最大权限（P0-3）。
   */
  async getUserDataScope(
    userId: string,
  ): Promise<{ type: 'all' | 'store'; storeIds: string[] }> {
    // 本地令牌登录时平台注入的 userContext.userId 可能为空串，若直接以空串查 UUID 列会抛 500；
    // 空 userId 视为初始/本地管理员，单租户模式下默认全量可见（与 rbac 文档规则 3 一致）。
    if (!userId) return { type: 'all', storeIds: [] };
    if (await this.isSuperAdmin(userId)) {
      return { type: 'all', storeIds: [] };
    }
    const rows = await this.db
      .select({ storeId: rbacUserStore.storeId })
      .from(rbacUserStore)
      .where(eq(rbacUserStore.userId, userId));
    if (rows.length === 0) {
      return { type: 'store', storeIds: [] };
    }
    return { type: 'store', storeIds: rows.map((r) => r.storeId) };
  }

  /**
   * 根据数据域构造门店过滤条件，供各业务查询复用（防止水平越权/IDOR）。
   * - type='all' → undefined（不加门店限制）
   * - type='store' 且 storeIds 非空 → inArray(column, storeIds)
   * - type='store' 且 storeIds 为空 → sql`1=0`（无任何可见门店，返回空集）
   */
  buildStoreCondition(
    scope: { type: 'all' | 'store'; storeIds: string[] },
    column: PgColumn | SQL,
  ): SQL | undefined {
    if (scope.type === 'all') return undefined;
    if (scope.storeIds.length === 0) return sql`1=0`;
    return inArray(column as PgColumn, scope.storeIds);
  }

  // ─── Data scope (dealer-level multi-tenant isolation) ─────────────
  //
  // 与上面的 store 维度数据域不同，本系统核心单据表（sales_order / purchase_order /
  // inventory_*）多数已直接持有 dealerId 列（sales_order / sales_outbound / sales_return /
  // receivable / finance_receipt / sales_reconciliation），其余通过 supplier.partner_id
  // （外键指向 dealer）以及 warehouse.dealer_id 可反查到经销商。因此“经销商作用域”以
  // dealerIds 表达，由用户可见门店（rbac_user_store → store.dealer_id）反查得到。
  //
  // 解析规则（兼顾安全性与单租户向后兼容，见 ERP_MULTI_TENANT 开关）：
  //   1. 超级管理员（持有启用态 super_admin 角色）→ { type:'all' }
  //   2. 已配角色 但 无门店映射：多租户模式（ERP_MULTI_TENANT=true，且存在 dealer 记录）→ 拒绝（dealerIds:[]，查询返回空集）；
  //      单租户模式（默认）→ 全部可见（无租户边界可守）
  //   3. 完全未配置（无角色 且 无门店映射，即初始 admin/未初始化态）：
  //      多租户模式 → 拒绝（dealerIds:[]，默认最小权限，与 store 维度 1=0 兜底一致，P0-6 修正）；
  //      单租户模式（默认）→ 全部可见（避免破坏开箱即用的演示/初始化）
  //   4. 命中门店映射 → 反查出 dealerIds，仅可见这些经销商的数据
  //
  // 说明：规则 2/3 的区别在于“是否已为用户分配过角色/门店”——一旦分配，立即进入严格模式。
  // 单租户/多租户由环境变量 ERP_MULTI_TENANT 控制（默认 false=单租户）。多租户 SaaS 部署必须
  // 设为 true，否则未配置用户将越权可见全部经销商数据。
  //
  // 与 store 维度 buildStoreCondition 的兜底已对齐：store 维度空映射恒为 1=0（拒绝）；dealer 维度
  // 在多租户模式下空映射也恒为 1=0（拒绝），仅在单租户模式下为兼容演示才放行。

  /** 按用户级缓存，避免每个请求都回查权限表（TTL 60s）。 */
  private dealerScopeCache = new Map<string, { value: DealerScope; ts: number }>();
  private anyDealerCache: { value: boolean; ts: number } | null = null;

  private async hasAnyDealer(): Promise<boolean> {
    const now = Date.now();
    if (this.anyDealerCache && now - this.anyDealerCache.ts < 60_000) {
      return this.anyDealerCache.value;
    }
    const rows = await this.db.select({ c: count() }).from(dealer);
    const value = Number(rows[0]?.c ?? 0) > 0;
    this.anyDealerCache = { value, ts: now };
    return value;
  }

  async getUserDealerScope(userId: string): Promise<DealerScope> {
    const now = Date.now();
    const cached = this.dealerScopeCache.get(userId);
    if (cached && now - cached.ts < 60_000) return cached.value;

    const scope = await this.resolveDealerScope(userId);
    this.dealerScopeCache.set(userId, { value: scope, ts: now });
    return scope;
  }

  /**
   * 是否多租户隔离模式。
   *
   * 默认 false（单租户），与现有开箱即用/演示态兼容：未配置门店映射的用户全部可见。
   * 多租户 SaaS 部署必须将 ERP_MULTI_TENANT 设为 'true'，此时未配置门店映射的普通用户
   * 默认拒绝（最小权限），与 store 维度 1=0 兜底一致，避免“未配置即越权可见全部经销商”。
   */
  private isMultiTenantMode(): boolean {
    return process.env.ERP_MULTI_TENANT === 'true';
  }

  private async resolveDealerScope(userId: string): Promise<DealerScope> {
    if (await this.isSuperAdmin(userId)) {
      return { type: 'all', dealerIds: [] };
    }

    // 用户是否已被分配过角色（用于区分“已配置”与“初始未配置”）
    const roleRows = await this.db
      .select({ id: rbacUserRole.roleId })
      .from(rbacUserRole)
      .where(eq(rbacUserRole.userId, userId));
    const hasRoles = roleRows.length > 0;

    const storeRows = await this.db
      .select({ storeId: rbacUserStore.storeId })
      .from(rbacUserStore)
      .where(eq(rbacUserStore.userId, userId));

    // 完全未配置（无角色 且 无门店映射）
    if (!hasRoles && storeRows.length === 0) {
      // 多租户模式（P0-6 修正）：默认拒绝（最小权限），与 store 维度 1=0 兜底一致；
      // 单租户模式（默认）：保留向后兼容，全量可见（避免破坏开箱即用的演示/初始化）
      return this.isMultiTenantMode()
        ? { type: 'dealer', dealerIds: [] }
        : { type: 'all', dealerIds: [] };
    }

    // 已配角色但无门店映射：多租户启用时拒绝，否则单租户放行
    if (storeRows.length === 0) {
      const anyDealer = await this.hasAnyDealer();
      return anyDealer
        ? { type: 'dealer', dealerIds: [] }
        : { type: 'all', dealerIds: [] };
    }

    // 反查可见门店所属的经销商（去重、剔除 NULL）
    const storeIds = storeRows.map((r) => r.storeId);
    const dealerRows = await this.db
      .select({ dealerId: store.dealerId })
      .from(store)
      .where(inArray(store.id, storeIds));
    const dealerIds = [
      ...new Set(
        dealerRows
          .map((r) => r.dealerId)
          .filter((d): d is string => d != null),
      ),
    ];

    if (dealerIds.length === 0) {
      const anyDealer = await this.hasAnyDealer();
      return anyDealer
        ? { type: 'dealer', dealerIds: [] }
        : { type: 'all', dealerIds: [] };
    }

    return { type: 'dealer', dealerIds };
  }

  async getUserStores(
    userId: string,
  ): Promise<Array<{ id: string; name: string; code: string }>> {
    const rows = await this.db
      .select({
        id: store.id,
        name: store.name,
        code: store.code,
      })
      .from(rbacUserStore)
      .innerJoin(store, eq(rbacUserStore.storeId, store.id))
      .where(eq(rbacUserStore.userId, userId));
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code }));
  }

  async assignUserStores(userId: string, storeIds: string[]): Promise<void> {
    if (storeIds.length > 0) {
      const stores = await this.db
        .select({ id: store.id })
        .from(store)
        .where(inArray(store.id, storeIds));
      if (stores.length !== storeIds.length) {
        throw new BadRequestException('存在无效的门店ID');
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(rbacUserStore).where(eq(rbacUserStore.userId, userId));
      if (storeIds.length > 0) {
        await tx
          .insert(rbacUserStore)
          .values(storeIds.map((sid) => ({ userId, storeId: sid })));
      }
    });
  }

  // ─── Role CRUD ──────────────────────────────────────────────────────

  async getRoleList(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: string;
  }): Promise<PaginationResult<RbacRole>> {
    const { page, pageSize, keyword, status } = params;
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        or(
          ilike(rbacRole.code, `%${escaped}%`),
          ilike(rbacRole.name, `%${escaped}%`),
        ),
      );
    }
    if (status) {
      conditions.push(eq(rbacRole.status, status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(rbacRole).where(where as any),
      this.db
        .select()
        .from(rbacRole)
        .where(where as any)
        .orderBy(desc(rbacRole.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: RbacRole[] = rows.map((row) => this.mapRoleRow(row));

    return { items, total, page, pageSize };
  }

  async getAllRoles(): Promise<RbacRole[]> {
    const rows = await this.db
      .select()
      .from(rbacRole)
      .orderBy(asc(rbacRole.code));
    return rows.map((row) => this.mapRoleRow(row));
  }

  async getRole(id: string): Promise<RbacRole> {
    const rows = await this.db.select().from(rbacRole).where(eq(rbacRole.id, id));
    if (rows.length === 0) throw new NotFoundException('角色不存在');
    return this.mapRoleRow(rows[0]);
  }

  async createRole(data: {
    code: string;
    name: string;
    description?: string;
    status?: string;
  }): Promise<RbacRole> {
    if (!data.code?.trim()) throw new BadRequestException('角色编码不能为空');
    if (!data.name?.trim()) throw new BadRequestException('角色名称不能为空');

    const existing = await this.db
      .select()
      .from(rbacRole)
      .where(eq(rbacRole.code, data.code));
    if (existing.length > 0) throw new ConflictException('角色编码已存在');

    const values: RbacRoleInsert = {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      status: data.status ?? 'active',
    };

    const inserted = await this.db
      .insert(rbacRole)
      .values(values)
      .returning();
    return this.mapRoleRow(inserted[0]);
  }

  async updateRole(
    id: string,
    data: {
      code?: string;
      name?: string;
      description?: string;
      status?: string;
    },
  ): Promise<RbacRole> {
    const patch: Partial<RbacRoleInsert> = {};

    if (data.code !== undefined) {
      if (!data.code.trim()) throw new BadRequestException('角色编码不能为空');
      const other = await this.db
        .select()
        .from(rbacRole)
        .where(eq(rbacRole.code, data.code));
      if (other.length > 0 && other[0].id !== id) {
        throw new ConflictException('角色编码已存在');
      }
      patch.code = data.code;
    }
    if (data.name !== undefined) {
      if (!data.name.trim()) throw new BadRequestException('角色名称不能为空');
      patch.name = data.name;
    }
    if (data.description !== undefined) {
      patch.description = data.description ?? null;
    }
    if (data.status !== undefined) {
      patch.status = data.status;
    }

    if (Object.keys(patch).length === 0)
      throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(rbacRole)
      .set(patch)
      .where(eq(rbacRole.id, id))
      .returning();
    if (updated.length === 0) throw new NotFoundException('角色不存在');

    return this.mapRoleRow(updated[0]);
  }

  async deleteRole(id: string): Promise<void> {
    const deleted = await this.db
      .delete(rbacRole)
      .where(eq(rbacRole.id, id))
      .returning({ id: rbacRole.id });
    if (deleted.length === 0) throw new NotFoundException('角色不存在');
  }

  // ─── Permission methods ─────────────────────────────────────────────

  /** 全局权限目录缓存键（权限目录是全局数据，不带经销商作用域） */
  private static readonly PERM_TREE_KEY = 'rbac:perm-tree';
  private static readonly MENU_TREE_KEY = 'rbac:menu-tree';

  async getPermissionTree(): Promise<RbacPermission[]> {
    return cached<RbacPermission[]>(
      this.cacheManager,
      RbacService.PERM_TREE_KEY,
      TTL.reference,
      async () => {
        const rows = await this.db
          .select()
          .from(rbacPermission)
          .orderBy(asc(rbacPermission.sortOrder));
        const perms = rows.map((row) => this.mapPermissionRow(row));
        return this.buildTree(perms);
      },
    );
  }

  async getMenuTree(): Promise<RbacPermission[]> {
    return cached<RbacPermission[]>(
      this.cacheManager,
      RbacService.MENU_TREE_KEY,
      TTL.reference,
      async () => {
        const rows = await this.db
          .select()
          .from(rbacPermission)
          .where(eq(rbacPermission.type, 'menu'))
          .orderBy(asc(rbacPermission.sortOrder));
        const perms = rows.map((row) => this.mapPermissionRow(row));
        return this.buildTree(perms);
      },
    );
  }

  // ─── Role-Permission methods ────────────────────────────────────────

  private static rolePermsKey(roleId: string): string {
    return `rbac:role-perms:${roleId}`;
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    return cached<string[]>(
      this.cacheManager,
      RbacService.rolePermsKey(roleId),
      TTL.reference,
      async () => {
        // Verify role exists
        const roles = await this.db
          .select({ id: rbacRole.id })
          .from(rbacRole)
          .where(eq(rbacRole.id, roleId));
        if (roles.length === 0) throw new NotFoundException('角色不存在');

        const rows = await this.db
          .select({ permissionId: rbacRolePermission.permissionId })
          .from(rbacRolePermission)
          .where(eq(rbacRolePermission.roleId, roleId));
        return rows.map((r) => r.permissionId);
      },
    );
  }

  async assignRolePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    // Verify role exists
    const roles = await this.db
      .select({ id: rbacRole.id })
      .from(rbacRole)
      .where(eq(rbacRole.id, roleId));
    if (roles.length === 0) throw new NotFoundException('角色不存在');

    // Verify all permissions exist
    if (permissionIds.length > 0) {
      const perms = await this.db
        .select({ id: rbacPermission.id })
        .from(rbacPermission)
        .where(inArray(rbacPermission.id, permissionIds));
      if (perms.length !== permissionIds.length) {
        throw new BadRequestException('存在无效的权限ID');
      }
    }

    await this.db.transaction(async (tx) => {
      // Delete all existing
      await tx
        .delete(rbacRolePermission)
        .where(eq(rbacRolePermission.roleId, roleId));

      // Insert new ones
      if (permissionIds.length > 0) {
        const values = permissionIds.map((pid) => ({
          roleId,
          permissionId: pid,
        }));
        await tx.insert(rbacRolePermission).values(values);
      }
    });

    // P1-c① 扩展：角色→权限映射已变更，主动失效该角色权限缓存
    await invalidate(this.cacheManager, RbacService.rolePermsKey(roleId));
  }

  // ─── User-Role methods ──────────────────────────────────────────────

  async getUserRoles(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ roleId: rbacUserRole.roleId })
      .from(rbacUserRole)
      .where(eq(rbacUserRole.userId, userId));
    return rows.map((r) => r.roleId);
  }

  async assignUserRoles(userId: string, roleIds: string[]): Promise<void> {
    // Verify user exists
    const users = await this.db
      .select({ id: rbacUser.id })
      .from(rbacUser)
      .where(eq(rbacUser.id, userId));
    if (users.length === 0) throw new NotFoundException('用户不存在');

    // Verify all roles exist
    if (roleIds.length > 0) {
      const roles = await this.db
        .select({ id: rbacRole.id })
        .from(rbacRole)
        .where(inArray(rbacRole.id, roleIds));
      if (roles.length !== roleIds.length) {
        throw new BadRequestException('存在无效的角色ID');
      }
    }

    await this.db.transaction(async (tx) => {
      // Delete all existing
      await tx
        .delete(rbacUserRole)
        .where(eq(rbacUserRole.userId, userId));

      // Insert new ones
      if (roleIds.length > 0) {
        const values = roleIds.map((rid) => ({
          userId,
          roleId: rid,
        }));
        await tx.insert(rbacUserRole).values(values);
      }
    });
  }
}
