/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { isNull, isNotNull } from 'drizzle-orm';
import { bigint, boolean, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, varchar, customType, primaryKey } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const memberPoint = pgTable("member_point", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull(),
  changeType: varchar("change_type", { length: 30 }).notNull(),
  changeValue: integer("change_value").notNull().default(0),
  balance: integer("balance").notNull().default(0),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_member_point_member").on(table.memberId),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [member.id],
    name: "member_point_member_id_fkey",
  }).onDelete("cascade"),
]);

export const member = pgTable("member", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberNo: varchar("member_no", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // P0-2 字段级加密：phone 改为存储 AES-256-GCM 密文（前缀 enc::），宽度加至 255。
  phone: varchar("phone", { length: 255 }),
  // P0-2 可搜索加密：手机号 HMAC-SHA256 确定性指纹，用于按手机号搜索/去重/一致性校验。
  phoneHmac: varchar("phone_hmac", { length: 64 }),
  gender: varchar("gender", { length: 10 }).default('unknown'),
  birthday: date("birthday"),
  level: varchar("level", { length: 20 }).notNull().default('normal'),
  tagIds: jsonb("tag_ids").notNull().default('[]'),
  totalSpent: numeric("total_spent").notNull().default('0'),
  orderCount: integer("order_count").notNull().default(0),
  points: integer("points").notNull().default(0),
  lastPurchaseDate: date("last_purchase_date"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // #10 会员管理：邮箱（可选 PII，维护用）
  email: varchar("email", { length: 255 }),
  // P0-c 主数据治理：会员储值余额（单位=分，与 POS posMember.storedValue 对齐，供上行回写落点）
  storedValue: numeric("stored_value").notNull().default('0'),
  // P0-3 主数据合并：被合并指向（指向存活方 member.id）。被合并会员绝不删除，仅打标，规避 cascade 清空钱包流水。
  mergedInto: uuid("merged_into"),
  // P0-3 主数据合并：合并时间（打标用，非软删）
  mergedAt: customTimestamptz("merged_at", { precision: 3 }),
  // #10 软删除：删除置位时间戳，list 过滤 IS NULL。member.status 约束不含 'deleted'，且 member_wallet_event/member_point 均 cascade，硬删会清空钱包流水 = 资金事故。
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("member_member_no_key").on(table.memberNo),
  index("idx_member_phone_hmac").on(table.phoneHmac),
  index("idx_member_level").on(table.level),
  index("idx_member_status").on(table.status),
  index("idx_member_merged_into").on(table.mergedInto),
  // #10 软删加速：list 仅取未删除行（与迁移 0030 同名部分索引对应）
  index("idx_member_not_deleted").on(table.deletedAt),
  // 自愈引用：删除/改指 survivor 时把 mergedInto 置空（被合并方不会被级联删）
  foreignKey({
    columns: [table.mergedInto],
    foreignColumns: [table.id],
    name: "member_merged_into_fkey",
  }).onDelete("set null"),
]);

/**
 * #11 会员等级主数据（迁移 0031）。
 *
 * 会员等级的权威来源：会员表 member.level 持有本表 code。
 * condition_type 限定 'cumulative' | 'monthly' | 'quarterly'（达标周期）；
 * threshold_amount 为对应周期的累计消费金额门槛；
 * discount 为正常折扣（0.85 = 8.5 折）；discount_on_promo 标记是否支持折上折。
 */
export const memberLevel = pgTable("member_level", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  conditionType: varchar("condition_type", { length: 20 }).notNull().default('cumulative'),
  thresholdAmount: numeric("threshold_amount").notNull().default('0'),
  discount: numeric("discount").notNull().default('1'),
  discountOnPromo: boolean("discount_on_promo").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // 会员等级升级设定：达到本等级后升级到的目标等级 code。
  // 业务链：会员卡(normal)→银卡(silver)→金卡(gold)→钻石卡(diamond)；空表示顶级不再升级。
  upgradeTo: varchar("upgrade_to", { length: 30 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("member_level_code_key").on(table.code),
  index("idx_member_level_status").on(table.status),
  index("idx_member_level_sort").on(table.sortOrder),
]);

/**
 * P0-3 主数据合并：会员合并审计/回滚日志（迁移 0025）。
 *
 * 用途：会员去重合并时记录「谁被合并进谁、转移了多少积分/储值、由谁操作、为何合并」。
 * 是合并操作的**唯一审计来源**，也是 reverse() 回滚的**唯一依据**。
 *
 * 资金安全设计（历史教训：曾发生储值清零资金事故）：
 *   · 被合并会员**绝不删除**（member 无 _deleted_at，且 member_wallet_event/member_point 均 onDelete cascade，
 *     删除会级联清空钱包流水 = 资金事故）。合并只改指依赖行到 survivor + 打标(mergedInto/mergedAt)。
 *   · 积分/储值经 member_wallet_event 账本事件原子累加，不读-算-写。
 *   · reverse() 依据本表 moved_points / moved_stored_value 精确回滚，避免双计或误冲。
 */
export const memberMergeLog = pgTable("member_merge_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 同一次合并操作的批次号（一个 survivor 合并多个 merged 时共用），便于整批回滚 */
  runId: varchar("run_id", { length: 40 }).notNull(),
  survivorId: uuid("survivor_id").notNull(),
  mergedId: uuid("merged_id").notNull(),
  mergedMemberNo: varchar("merged_member_no", { length: 50 }),
  mergedName: varchar("merged_name", { length: 100 }),
  mergedPhoneHmac: varchar("merged_phone_hmac", { length: 64 }),
  /** 本行从被合并方转移到 survivor 的积分（= 被合并方合并前 points） */
  movedPoints: integer("moved_points").notNull().default(0),
  /** 本行从被合并方转移到 survivor 的储值（单位=分，= 被合并方合并前 stored_value） */
  movedStoredValue: numeric("moved_stored_value").notNull().default('0'),
  /** 本行从被合并方转移到 survivor 的累计消费额（去重化展示计数器，= 合并前 total_spent） */
  movedTotalSpent: numeric("moved_total_spent").notNull().default('0'),
  /** 本行从被合并方转移到 survivor 的订单数（去重化展示计数器，= 合并前 order_count） */
  movedOrderCount: integer("moved_order_count").notNull().default(0),
  /** 合并原因（如「手机号重复」「门店录入重复」） */
  reason: text("reason"),
  /** 操作人（来自登录态 app.user_id，由上层传入） */
  operator: varchar("operator", { length: 64 }),
  /** 回滚时间：reverse() 成功回滚后置位，避免重复回滚 */
  reversedAt: customTimestamptz("reversed_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_member_merge_log_run").on(table.runId),
  index("idx_member_merge_log_survivor").on(table.survivorId),
  index("idx_member_merge_log_merged").on(table.mergedId),
  foreignKey({
    columns: [table.survivorId],
    foreignColumns: [member.id],
    name: "member_merge_log_survivor_fkey",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.mergedId],
    foreignColumns: [member.id],
    name: "member_merge_log_merged_fkey",
  }).onDelete("restrict"),
]);

/**
 * P0-3 通用主数据合并审计/回滚日志（迁移 0027，3b/3c 泛化）。
 *
 * 用途：把 P0-3 会员合并（member_merge_log）的"审计+回滚"范式泛化到所有主数据合并
 * （style / customer，未来 store），用 entity_type 区分。是合并操作的**唯一审计来源**，
 * 也是 reverse() 回滚的**唯一依据**。
 *
 * 与 member 的差异：本日志**不记录资金/积分**（style/customer 无资金列，合并不涉及资金迁移），
 * 仅记录"谁合并进谁、业务编码、操作人、原因"。
 */
export const masterDataMergeLog = pgTable("master_data_merge_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 主数据实体类型：style / customer（未来 store） */
  entityType: varchar("entity_type", { length: 20 }).notNull(),
  /** 同一次合并操作的批次号（一个 survivor 合并多个 merged 时共用），便于整批回滚 */
  runId: varchar("run_id", { length: 40 }).notNull(),
  survivorId: uuid("survivor_id").notNull(),
  mergedId: uuid("merged_id").notNull(),
  /** 被合并方的业务唯一编码（style=style_no，customer=code） */
  mergedCode: varchar("merged_code", { length: 50 }),
  /** 被合并方展示名（style=style_no，customer=name） */
  mergedName: varchar("merged_name", { length: 200 }),
  /** 合并原因（如「重复录入」「门店误建」） */
  reason: text("reason"),
  /** 操作人（来自登录态 app.user_id，由上层传入） */
  operator: varchar("operator", { length: 64 }),
  /** 回滚时间：reverse() 成功回滚后置位，避免重复回滚 */
  reversedAt: customTimestamptz("reversed_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_master_data_merge_log_entity").on(table.entityType),
  index("idx_master_data_merge_log_run").on(table.runId),
  index("idx_master_data_merge_log_survivor").on(table.survivorId),
  index("idx_master_data_merge_log_merged").on(table.mergedId),
  // run_id + merged_id 防同批重复记录（幂等）
  uniqueIndex("uniq_master_data_merge_log_run_merged").on(table.runId, table.mergedId),
]);

/**
 * S3 会员钱包事件账本（迁移 0022）。
 *
 * 用途：POS 门店消费产生的积分/储值变动，以「幂等事件」上行到 ERP，由 ERP 统一入账。
 * `eventKey` 的唯一索引是幂等的**唯一依赖** —— 重试 / 离线补传 / 重放同一事件都只入账一次。
 *
 * 背景（为什么需要它）：
 *   POS 侧在 sales / returns / omnichannel 三处各自本地累加 pos_member.points / stored_value；
 *   而 ERP 只在「零售单结算」时加积分（retail.service.ts:556），且 POS 上行销售单走的是
 *   pos-receiver.receiveSales，建的是 status='completed' 的 retail_order，
 *   **不经过 settleRetailOrder** → ERP 侧根本不会为门店消费加积分。
 *   结果就是两端各记一套、互不打通，ERP 会员积分对门店消费完全失真。
 *
 * ⚠ 注意定义位置：本表外键引用 member.id，必须写在 member 之后。
 *   曾因写在 member 之前触及 TDZ 而被回滚过一次。
 */
export const memberWalletEvent = pgTable("member_wallet_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 幂等键：{sourceType}:{sourceNo}:{kind}，如 sale:SO20261001-0001:points */
  eventKey: varchar("event_key", { length: 160 }).notNull().unique(),
  memberId: uuid("member_id").notNull(),
  /** points（积分，整数）| stored_value（储值，单位=分，与 member.storedValue 对齐） */
  kind: varchar("kind", { length: 20 }).notNull(),
  /** 增量，可为负（退货回冲为负） */
  changeValue: bigint("change_value", { mode: "number" }).notNull(),
  /** 入账后的余额快照，用于对账 */
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  /** sale | return | omnichannel | adjust */
  sourceType: varchar("source_type", { length: 30 }).notNull(),
  sourceNo: varchar("source_no", { length: 100 }),
  storeCode: varchar("store_code", { length: 50 }),
  /** applied（已入账）| rejected（被拒：会员不存在 / 余额不足） */
  status: varchar("status", { length: 20 }).notNull().default("applied"),
  message: text("message"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uniq_member_wallet_event_key").on(table.eventKey),
  index("idx_member_wallet_event_member").on(table.memberId, table.createdAt),
  index("idx_member_wallet_event_source").on(table.sourceType, table.sourceNo),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [member.id],
    name: "member_wallet_event_member_id_fkey",
  }).onDelete("cascade"),
]);

export const memberTag = pgTable("member_tag", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("member_tag_name_key").on(table.name),
]);

export const omniOrderItem = pgTable("omni_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  omniOrderId: uuid("omni_order_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  allocatedQty: numeric("allocated_qty").notNull().default('0'),
  shortageQty: numeric("shortage_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_omni_order_item_order").on(table.omniOrderId),
  foreignKey({
    columns: [table.omniOrderId],
    foreignColumns: [omniOrder.id],
    name: "omni_order_item_omni_order_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.skuId],
    foreignColumns: [sku.id],
    name: "omni_order_item_sku_id_fkey",
  }),
]);

export const omniOrder = pgTable("omni_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  channelId: uuid("channel_id").notNull(),
  channelName: varchar("channel_name", { length: 200 }).notNull(),
  externalNo: varchar("external_no", { length: 100 }),
  customerName: varchar("customer_name", { length: 200 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 50 }),
  address: text("address"),
  totalAmount: numeric("total_amount").notNull().default('0'),
  itemCount: integer("item_count").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  shipStatus: varchar("ship_status", { length: 20 }).notNull().default('unshipped'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("omni_order_order_no_key").on(table.orderNo),
  index("idx_omni_order_channel").on(table.channelId),
  index("idx_omni_order_status").on(table.status),
  foreignKey({
    columns: [table.channelId],
    foreignColumns: [salesChannel.id],
    name: "omni_order_channel_id_fkey",
  }),
]);

export const salesChannel = pgTable("sales_channel", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelCode: varchar("channel_code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  platform: varchar("platform", { length: 50 }).notNull().default('other'),
  apiConfig: jsonb("api_config").notNull().default('{}'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sales_channel_channel_code_key").on(table.channelCode),
]);

export const subcontractFee = pgTable("subcontract_fee", {
  id: uuid("id").primaryKey().defaultRandom(),
  feeNo: varchar("fee_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  feeType: varchar("fee_type", { length: 20 }).notNull().default('processing'),
  amount: numeric("amount").notNull().default('0'),
  payableId: uuid("payable_id"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  supplierId: uuid("supplier_id"),
  supplierName: varchar("supplier_name", { length: 200 }),
  quantity: numeric("quantity").notNull().default('0'),
  unitPrice: numeric("unit_price").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("subcontract_fee_fee_no_key").on(table.feeNo),
  index("idx_subcontract_fee_order").on(table.orderId),
  index("idx_subcontract_fee_status").on(table.status),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [subcontractOrder.id],
    name: "subcontract_fee_order_id_fkey",
  }),
]);

export const subcontractReceiptItem = pgTable("subcontract_receipt_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  unitPrice: numeric("unit_price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  qualifiedQty: numeric("qualified_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_subcontract_receipt_item_receipt").on(table.receiptId),
  index("idx_subcontract_receipt_item_sku").on(table.skuId),
  foreignKey({
    columns: [table.receiptId],
    foreignColumns: [subcontractReceipt.id],
    name: "subcontract_receipt_item_receipt_id_fkey",
  }).onDelete("cascade"),
]);

export const subcontractReceipt = pgTable("subcontract_receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNo: varchar("receipt_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  receiptDate: date("receipt_date").notNull(),
  totalQuantity: numeric("total_quantity").notNull().default('0'),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  supplierId: uuid("supplier_id"),
  supplierName: varchar("supplier_name", { length: 200 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("subcontract_receipt_receipt_no_key").on(table.receiptNo),
  index("idx_subcontract_receipt_order").on(table.orderId),
  index("idx_subcontract_receipt_status").on(table.status),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [subcontractOrder.id],
    name: "subcontract_receipt_order_id_fkey",
  }),
]);

export const subcontractIssueItem = pgTable("subcontract_issue_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  issueId: uuid("issue_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }),
  quantity: numeric("quantity").notNull().default('0'),
  unitPrice: numeric("unit_price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_subcontract_issue_item_issue").on(table.issueId),
  index("idx_subcontract_issue_item_material").on(table.materialId),
  foreignKey({
    columns: [table.issueId],
    foreignColumns: [subcontractIssue.id],
    name: "subcontract_issue_item_issue_id_fkey",
  }).onDelete("cascade"),
]);

export const subcontractIssue = pgTable("subcontract_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  issueNo: varchar("issue_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  issueDate: date("issue_date").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  supplierId: uuid("supplier_id"),
  supplierName: varchar("supplier_name", { length: 200 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("subcontract_issue_issue_no_key").on(table.issueNo),
  index("idx_subcontract_issue_order").on(table.orderId),
  index("idx_subcontract_issue_status").on(table.status),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [subcontractOrder.id],
    name: "subcontract_issue_order_id_fkey",
  }),
]);

export const subcontractOrderItem = pgTable("subcontract_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  unitPrice: numeric("unit_price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  receivedQty: numeric("received_qty").notNull().default('0'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_subcontract_order_item_order").on(table.orderId),
  index("idx_subcontract_order_item_sku").on(table.skuId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [subcontractOrder.id],
    name: "subcontract_order_item_order_id_fkey",
  }).onDelete("cascade"),
]);

export const subcontractOrder = pgTable("subcontract_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  orderDate: date("order_date").notNull(),
  deliveryDate: date("delivery_date"),
  totalQuantity: numeric("total_quantity").notNull().default('0'),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("subcontract_order_order_no_key").on(table.orderNo),
  index("idx_subcontract_order_status").on(table.status),
  index("idx_subcontract_order_supplier").on(table.supplierId),
]);

export const inventoryBatch = pgTable("inventory_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  batchNo: varchar("batch_no", { length: 50 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  productionDate: date("production_date"),
  expiryDate: date("expiry_date"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("uq_inventory_batch_sk_wh_batch").on(table.skuId, table.warehouseId, table.batchNo),
  index("idx_inventory_batch_sku").on(table.skuId),
  index("idx_inventory_batch_wh").on(table.warehouseId),
  foreignKey({
    columns: [table.skuId],
    foreignColumns: [sku.id],
    name: "fk_inventory_batch_sku",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "fk_inventory_batch_wh",
  }),
]);

export const systemConfig = pgTable("system_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  configKey: varchar("config_key", { length: 100 }).notNull().unique(),
  configValue: text("config_value").notNull(),
  description: varchar("description", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("system_config_config_key_key").on(table.configKey),
  index("idx_system_config_key").on(table.configKey),
]);

export const styleAttrValue = pgTable("style_attr_value", {
  id: uuid("id").primaryKey().defaultRandom(),
  attrDefId: uuid("attr_def_id").notNull(),
  valueCode: varchar("value_code", { length: 50 }).notNull(),
  valueName: varchar("value_name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: varchar("remark", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_style_attr_value_def_code").on(table.attrDefId, table.valueCode),
  index("idx_style_attr_value_def_id").on(table.attrDefId),
  index("idx_style_attr_value_status").on(table.status),
  foreignKey({
    columns: [table.attrDefId],
    foreignColumns: [styleAttrDef.id],
    name: "style_attr_value_attr_def_id_fkey",
  }).onDelete("cascade"),
]);

export const styleAttrDef = pgTable("style_attr_def", {
  id: uuid("id").primaryKey().defaultRandom(),
  attrCode: varchar("attr_code", { length: 50 }).notNull().unique(),
  attrName: varchar("attr_name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: varchar("remark", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("style_attr_def_attr_code_key").on(table.attrCode),
  index("idx_style_attr_def_status").on(table.status),
  index("idx_style_attr_def_sort").on(table.sortOrder),
]);

export const systemOperationLog = pgTable("system_operation_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationTime: customTimestamptz("operation_time", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  userId: varchar("user_id", { length: 64 }),
  userName: varchar("user_name", { length: 100 }),
  module: varchar("module", { length: 50 }),
  operationType: varchar("operation_type", { length: 20 }),
  objectId: varchar("object_id", { length: 64 }),
  objectName: varchar("object_name", { length: 200 }),
  summary: text("summary"),
  ip: varchar("ip", { length: 50 }),
  userAgent: varchar("user_agent", { length: 500 }),
}, (table) => [
  index("idx_sol_operation_time").on(table.operationTime),
  index("idx_sol_user_id").on(table.userId),
  index("idx_sol_module").on(table.module),
  index("idx_sol_operation_type").on(table.operationType),
]);

export const salesReconciliation = pgTable("sales_reconciliation", {
  id: uuid("id").primaryKey().defaultRandom(),
  reconNo: varchar("recon_no", { length: 50 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 200 }),
  dealerId: uuid("dealer_id"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  outboundAmount: numeric("outbound_amount").notNull().default('0'),
  returnAmount: numeric("return_amount").notNull().default('0'),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("sales_reconciliation_recon_no_key").on(table.reconNo),
  index("idx_sr_dealer_id").on(table.dealerId),
  index("idx_sr_status").on(table.status),
  index("idx_sr_start_date").on(table.startDate),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "sales_reconciliation_dealer_id_fkey",
  }),
]);

export const purchaseReconciliation = pgTable("purchase_reconciliation", {
  id: uuid("id").primaryKey().defaultRandom(),
  reconNo: varchar("recon_no", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  inboundAmount: numeric("inbound_amount").notNull().default('0'),
  returnAmount: numeric("return_amount").notNull().default('0'),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("purchase_reconciliation_recon_no_key").on(table.reconNo),
  index("idx_pr_supplier_id").on(table.supplierId),
  index("idx_pr_status").on(table.status),
  index("idx_pr_start_date").on(table.startDate),
]);

export const financePaymentWriteoff = pgTable("finance_payment_writeoff", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull(),
  payableId: uuid("payable_id").notNull(),
  payableNo: varchar("payable_no", { length: 50 }),
  writeoffAmount: numeric("writeoff_amount").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_fpw_payment_id").on(table.paymentId),
  index("idx_fpw_payable_id").on(table.payableId),
]);

export const financePayment = pgTable("finance_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentNo: varchar("payment_no", { length: 50 }).notNull().unique(),
  paymentDate: date("payment_date").notNull(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }),
  amount: numeric("amount").notNull().default('0'),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default('transfer'),
  handler: varchar("handler", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("finance_payment_payment_no_key").on(table.paymentNo),
  index("idx_fp_status").on(table.status),
  index("idx_fp_supplier_id").on(table.supplierId),
  index("idx_fp_payment_date").on(table.paymentDate),
]);

export const financeReceiptWriteoff = pgTable("finance_receipt_writeoff", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull(),
  receivableId: uuid("receivable_id").notNull(),
  receivableNo: varchar("receivable_no", { length: 50 }),
  writeoffAmount: numeric("writeoff_amount").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_frw_receipt_id").on(table.receiptId),
  index("idx_frw_receivable_id").on(table.receivableId),
]);

export const financeReceipt = pgTable("finance_receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNo: varchar("receipt_no", { length: 50 }).notNull().unique(),
  receiptDate: date("receipt_date").notNull(),
  customerName: varchar("customer_name", { length: 200 }),
  dealerId: uuid("dealer_id"),
  amount: numeric("amount").notNull().default('0'),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default('transfer'),
  handler: varchar("handler", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("finance_receipt_receipt_no_key").on(table.receiptNo),
  index("idx_fr_dealer_id").on(table.dealerId),
  index("idx_fr_status").on(table.status),
  index("idx_fr_receipt_date").on(table.receiptDate),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "finance_receipt_dealer_id_fkey",
  }),
]);

export const productionFinishReceiptItem = pgTable("production_finish_receipt_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 50 }),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  qty: numeric("qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_pfri_receipt_id").on(table.receiptId),
  index("idx_pfri_sku_id").on(table.skuId),
]);

export const productionFinishReceipt = pgTable("production_finish_receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNo: varchar("receipt_no", { length: 50 }).notNull().unique(),
  workOrderId: uuid("work_order_id").notNull(),
  workOrderNo: varchar("work_order_no", { length: 50 }),
  warehouseId: uuid("warehouse_id").notNull(),
  receiptDate: date("receipt_date").notNull(),
  finishedQty: numeric("finished_qty").notNull().default('0'),
  defectiveQty: numeric("defective_qty").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("production_finish_receipt_receipt_no_key").on(table.receiptNo),
  index("idx_pfr_status").on(table.status),
  index("idx_pfr_work_order_id").on(table.workOrderId),
  index("idx_pfr_receipt_date").on(table.receiptDate),
]);

export const productionMaterialIssueItem = pgTable("production_material_issue_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  issueId: uuid("issue_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }),
  materialName: varchar("material_name", { length: 200 }),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }),
  planQty: numeric("plan_qty").notNull().default('0'),
  actualQty: numeric("actual_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_pmii_issue_id").on(table.issueId),
  index("idx_pmii_material_id").on(table.materialId),
]);

export const productionMaterialIssue = pgTable("production_material_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  issueNo: varchar("issue_no", { length: 50 }).notNull().unique(),
  workOrderId: uuid("work_order_id").notNull(),
  workOrderNo: varchar("work_order_no", { length: 50 }),
  warehouseId: uuid("warehouse_id").notNull(),
  issueDate: date("issue_date").notNull(),
  receiver: varchar("receiver", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("production_material_issue_issue_no_key").on(table.issueNo),
  index("idx_pmi_status").on(table.status),
  index("idx_pmi_work_order_id").on(table.workOrderId),
  index("idx_pmi_issue_date").on(table.issueDate),
]);

export const productionWorkOrder = pgTable("production_work_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }),
  quantity: numeric("quantity").notNull().default('0'),
  supplierId: uuid("supplier_id"),
  factoryName: varchar("factory_name", { length: 200 }),
  planStartDate: date("plan_start_date"),
  planFinishDate: date("plan_finish_date"),
  actualStartDate: date("actual_start_date"),
  actualFinishDate: date("actual_finish_date"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("production_work_order_order_no_key").on(table.orderNo),
  index("idx_pwo_status").on(table.status),
  index("idx_pwo_style_id").on(table.styleId),
  index("idx_pwo_plan_start_date").on(table.planStartDate),
]);

export const rbacUserToken = pgTable("rbac_user_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  userId: uuid("user_id").notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("rbac_user_token_token_key").on(table.token),
  index("idx_rbac_user_token_user").on(table.userId),
  index("idx_rbac_user_token_expires").on(table.expiresAt),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [rbacUser.id],
    name: "rbac_user_token_user_id_fkey",
  }).onDelete("cascade"),
]);

export const materialPurchaseInboundItem = pgTable("material_purchase_inbound_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  inboundId: uuid("inbound_id").notNull(),
  orderItemId: uuid("order_item_id"),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_mpi_item_inbound_id").on(table.inboundId),
  foreignKey({
    columns: [table.inboundId],
    foreignColumns: [materialPurchaseInbound.id],
    name: "material_purchase_inbound_item_inbound_id_fkey",
  }).onDelete("cascade"),
]);

export const materialPurchaseInbound = pgTable("material_purchase_inbound", {
  id: uuid("id").primaryKey().defaultRandom(),
  inboundNo: varchar("inbound_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  inboundDate: date("inbound_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("material_purchase_inbound_inbound_no_key").on(table.inboundNo),
]);

export const materialPurchaseOrderItem = pgTable("material_purchase_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  receivedQty: numeric("received_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_mpo_item_order_id").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [materialPurchaseOrder.id],
    name: "material_purchase_order_item_order_id_fkey",
  }).onDelete("cascade"),
]);

export const materialPurchaseOrder = pgTable("material_purchase_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  orderDate: date("order_date").notNull(),
  expectDate: date("expect_date"),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("material_purchase_order_order_no_key").on(table.orderNo),
]);

export const garmentPurchaseReturnSku = pgTable("garment_purchase_return_sku", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull(),
  inboundSkuId: uuid("inbound_sku_id"),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  skuId: uuid("sku_id").notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_gpr_sku_return_id").on(table.returnId),
  index("idx_gpr_sku_sku_id").on(table.skuId),
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [garmentPurchaseReturn.id],
    name: "garment_purchase_return_sku_return_id_fkey",
  }).onDelete("cascade"),
]);

export const garmentPurchaseReturn = pgTable("garment_purchase_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  // 关联采购入库单：解耦后可为空（支持批量/无单退货），历史单据仍保留原值
  inboundId: uuid("inbound_id"),
  inboundNo: varchar("inbound_no", { length: 50 }),
  supplierId: uuid("supplier_id"),
  supplierName: varchar("supplier_name", { length: 200 }),
  // 业务归属经销商：HQ 退货为 NULL，经销商退货=本经销商，用于行级数据隔离
  dealerId: uuid("dealer_id"),
  // 退货店仓（货物来源）
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  // 收货方（多态）：supplier=供应商（总部退货）；store=上级经销商店仓（经销商退货）
  receiverType: varchar("receiver_type", { length: 20 }).notNull().default('supplier'),
  receiverId: uuid("receiver_id"),
  receiverName: varchar("receiver_name", { length: 200 }),
  returnDate: date("return_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  totalQty: numeric("total_qty").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  sourceDocId: uuid("source_doc_id"),
  sourceDocType: varchar("source_doc_type", { length: 30 }),
  downstreamOrgId: uuid("downstream_org_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("garment_purchase_return_return_no_key").on(table.returnNo),
  index("idx_gpr_dealer").on(table.dealerId),
  index("idx_gpr_receiver").on(table.receiverId),
  index("idx_gpr_source_doc").on(table.sourceDocId),
  index("idx_gpr_downstream").on(table.downstreamOrgId),
]);

export const garmentPurchaseInboundSku = pgTable("garment_purchase_inbound_sku", {
  id: uuid("id").primaryKey().defaultRandom(),
  inboundId: uuid("inbound_id").notNull(),
  orderSkuId: uuid("order_sku_id"),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  skuId: uuid("sku_id").notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // 验收数量：仓库实际到货扫码/手填录入，验收环节按此值真正入库
  acceptedQty: numeric("accepted_qty").notNull().default('0'),
  // SKU 货号：冗余自 sku.sku_code，供扫码录入与明细展示
  skuCode: varchar("sku_code", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_gpi_sku_inbound_id").on(table.inboundId),
  index("idx_gpi_sku_sku_id").on(table.skuId),
  foreignKey({
    columns: [table.inboundId],
    foreignColumns: [garmentPurchaseInbound.id],
    name: "garment_purchase_inbound_sku_inbound_id_fkey",
  }).onDelete("cascade"),
]);

export const garmentPurchaseInbound = pgTable("garment_purchase_inbound", {
  id: uuid("id").primaryKey().defaultRandom(),
  inboundNo: varchar("inbound_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  inboundDate: date("inbound_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  totalQty: numeric("total_qty").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("garment_purchase_inbound_inbound_no_key").on(table.inboundNo),
]);

export const garmentPurchaseOrderSku = pgTable("garment_purchase_order_sku", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  skuId: uuid("sku_id").notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  receivedQty: numeric("received_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_gpo_sku_order_id").on(table.orderId),
  index("idx_gpo_sku_style_id").on(table.styleId),
  uniqueIndex("idx_gpo_sku_order_sku").on(table.orderId, table.skuId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [garmentPurchaseOrder.id],
    name: "garment_purchase_order_sku_order_id_fkey",
  }).onDelete("cascade"),
]);

export const garmentPurchaseOrder = pgTable("garment_purchase_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  orderDate: date("order_date").notNull(),
  expectDate: date("expect_date"),
  brand: varchar("brand", { length: 50 }),
  buyer: varchar("buyer", { length: 50 }),
  totalAmount: numeric("total_amount").notNull().default('0'),
  totalQty: numeric("total_qty").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  sourceDocId: uuid("source_doc_id"),
  sourceDocType: varchar("source_doc_type", { length: 30 }),
  downstreamOrgId: uuid("downstream_org_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("garment_purchase_order_order_no_key").on(table.orderNo),
  index("idx_gpo_source_doc").on(table.sourceDocId),
  index("idx_gpo_downstream").on(table.downstreamOrgId),
]);

export const rbacRolePermission = pgTable("rbac_role_permission", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
}, (table) => [
  uniqueIndex("rbac_role_permission_role_id_permission_id_key").on(table.roleId, table.permissionId),
  index("idx_rbac_role_permission_role").on(table.roleId),
  index("idx_rbac_role_permission_perm").on(table.permissionId),
  foreignKey({
    columns: [table.roleId],
    foreignColumns: [rbacRole.id],
    name: "rbac_role_permission_role_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.permissionId],
    foreignColumns: [rbacPermission.id],
    name: "rbac_role_permission_permission_id_fkey",
  }).onDelete("cascade"),
]);

export const rbacUserRole = pgTable("rbac_user_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
}, (table) => [
  uniqueIndex("rbac_user_role_user_id_role_id_key").on(table.userId, table.roleId),
  index("idx_rbac_user_role_user").on(table.userId),
  index("idx_rbac_user_role_role").on(table.roleId),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [rbacUser.id],
    name: "rbac_user_role_user_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.roleId],
    foreignColumns: [rbacRole.id],
    name: "rbac_user_role_role_id_fkey",
  }).onDelete("cascade"),
]);

export const rbacPermission = pgTable("rbac_permission", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  parentId: uuid("parent_id"),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("rbac_permission_code_key").on(table.code),
  index("idx_rbac_permission_parent").on(table.parentId),
]);

export const rbacRole = pgTable("rbac_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 50 }).notNull(),
  description: varchar("description", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("rbac_role_code_key").on(table.code),
]);

export const rbacUser = pgTable("rbac_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 50 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 255 }),
  phoneHmac: varchar("phone_hmac", { length: 64 }),
  department: varchar("department", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: varchar("remark", { length: 500 }),
  // 个人语种偏好（个人级 i18n）：落库后登录即应用；缺省简体中文
  language: varchar("language", { length: 10 }).notNull().default('zh-CN'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("rbac_user_username_key").on(table.username),
  index("idx_rbac_user_phone_hmac").on(table.phoneHmac),
]);

export const monthCloseLog = pgTable("month_close_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: varchar("month", { length: 7 }).notNull(),
  action: varchar("action", { length: 20 }).notNull(),
  operator: userProfile("operator").notNull(),
  operatedAt: customTimestamptz("operated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  remark: varchar("remark", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_month_close_log_month").on(table.month),
]);

export const monthCloseDetail = pgTable("month_close_detail", {
  id: uuid("id").primaryKey().defaultRandom(),
  closeId: uuid("close_id").notNull(),
  dimensionType: varchar("dimension_type", { length: 20 }).notNull(),
  brand: varchar("brand", { length: 50 }),
  warehouseId: uuid("warehouse_id"),
  warehouseName: varchar("warehouse_name", { length: 100 }),
  flowType: varchar("flow_type", { length: 50 }),
  qty: numeric("qty").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_month_close_detail_close_id").on(table.closeId),
  index("idx_month_close_detail_dim").on(table.dimensionType),
  foreignKey({
    columns: [table.closeId],
    foreignColumns: [monthClose.id],
    name: "month_close_detail_close_id_fkey",
  }).onDelete("cascade"),
]);

export const monthClose = pgTable("month_close", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: varchar("month", { length: 7 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default('open'),
  closedBy: userProfile("closed_by"),
  closedAt: customTimestamptz("closed_at", { precision: 3 }),
  remark: varchar("remark", { length: 255 }),
  openingQty: numeric("opening_qty").notNull().default('0'),
  openingAmount: numeric("opening_amount").notNull().default('0'),
  inboundQty: numeric("inbound_qty").notNull().default('0'),
  inboundAmount: numeric("inbound_amount").notNull().default('0'),
  outboundQty: numeric("outbound_qty").notNull().default('0'),
  outboundAmount: numeric("outbound_amount").notNull().default('0'),
  closingQty: numeric("closing_qty").notNull().default('0'),
  closingAmount: numeric("closing_amount").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_month_close_month").on(table.month),
]);

export const retailReturn = pgTable("retail_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 32 }).notNull().unique(),
  originalRetailId: uuid("original_retail_id").notNull(),
  originalRetailNo: varchar("original_retail_no", { length: 32 }).notNull(),
  storeId: uuid("store_id").notNull(),
  storeName: varchar("store_name", { length: 100 }).notNull(),
  returnDate: date("return_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  /**
   * @type { method: string, amount: string }[]
   */
  refundMethods: jsonb("refund_methods").notNull().default('[]'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: varchar("remark", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("retail_return_return_no_key").on(table.returnNo),
  index("idx_retail_return_store").on(table.storeId, table.returnDate),
]);

export const retailOrderItem = pgTable("retail_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  retailId: uuid("retail_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 64 }).notNull(),
  styleNo: varchar("style_no", { length: 32 }).notNull(),
  color: varchar("color", { length: 32 }),
  size: varchar("size", { length: 32 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('1'),
  tagPrice: numeric("tag_price").notNull().default('0'),
  dealPrice: numeric("deal_price").notNull().default('0'),
  discountRate: numeric("discount_rate"),
  lineAmount: numeric("line_amount").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_retail_item_retail_id").on(table.retailId),
]);

export const retailOrder = pgTable("retail_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  retailNo: varchar("retail_no", { length: 32 }).notNull().unique(),
  storeId: uuid("store_id").notNull(),
  storeName: varchar("store_name", { length: 100 }).notNull(),
  saleDate: date("sale_date").notNull(),
  cashierName: varchar("cashier_name", { length: 50 }),
  memberId: varchar("member_id", { length: 64 }),
  source: varchar("source", { length: 20 }).notNull().default('store_pos'),
  totalAmount: numeric("total_amount").notNull().default('0'),
  discountAmount: numeric("discount_amount").notNull().default('0'),
  receivableAmount: numeric("receivable_amount").notNull().default('0'),
  receivedAmount: numeric("received_amount").notNull().default('0'),
  changeAmount: numeric("change_amount").notNull().default('0'),
  /**
   * @type { method: string, amount: string }[]
   */
  payMethods: jsonb("pay_methods").notNull().default('[]'),
  itemCount: integer("item_count").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: varchar("remark", { length: 500 }),
  // POS 班次关联：标记该零售单属于哪个收银班次（用于班次对账/交班汇总）。
  // 注意：外键约束在迁移脚本 0004 中建立（此处不引用 pos_session 以避免前向引用 TDZ）。
  posSessionId: uuid("pos_session_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("retail_order_retail_no_key").on(table.retailNo),
  index("idx_retail_order_store").on(table.storeId, table.saleDate),
  index("idx_retail_order_session").on(table.posSessionId),
]);

export const allocationItem = pgTable("allocation_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  allocationId: uuid("allocation_id").notNull(),
  preOrderId: uuid("pre_order_id"),
  submitterType: varchar("submitter_type", { length: 20 }).notNull(),
  dealerId: uuid("dealer_id"),
  dealerName: varchar("dealer_name", { length: 200 }),
  storeId: uuid("store_id"),
  storeName: varchar("store_name", { length: 200 }),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  preQty: numeric("pre_qty").notNull().default('0'),
  allocatedQty: numeric("allocated_qty").notNull().default('0'),
  generatedDocType: varchar("generated_doc_type", { length: 20 }),
  generatedDocId: uuid("generated_doc_id"),
  generatedDocNo: varchar("generated_doc_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_allocation_item_alloc").on(table.allocationId),
  index("idx_allocation_item_sku").on(table.skuId),
]);

export const allocationOrder = pgTable("allocation_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  allocationNo: varchar("allocation_no", { length: 50 }).notNull().unique(),
  tradeShowId: uuid("trade_show_id").notNull(),
  tradeShowName: varchar("trade_show_name", { length: 200 }).notNull(),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  styleName: varchar("style_name", { length: 200 }).notNull(),
  totalArrivedQty: numeric("total_arrived_qty").notNull().default('0'),
  totalAllocatedQty: numeric("total_allocated_qty").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("allocation_order_allocation_no_key").on(table.allocationNo),
  index("idx_allocation_show").on(table.tradeShowId),
  index("idx_allocation_status").on(table.status),
  index("idx_allocation_style").on(table.styleId),
]);

export const preOrderItem = pgTable("pre_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  preOrderId: uuid("pre_order_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  qty: numeric("qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_pre_order_item_order").on(table.preOrderId),
  index("idx_pre_order_item_sku").on(table.skuId),
]);

export const preOrder = pgTable("pre_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  preOrderNo: varchar("pre_order_no", { length: 50 }).notNull().unique(),
  tradeShowId: uuid("trade_show_id").notNull(),
  tradeShowName: varchar("trade_show_name", { length: 200 }).notNull(),
  submitterType: varchar("submitter_type", { length: 20 }).notNull(),
  dealerId: uuid("dealer_id"),
  dealerName: varchar("dealer_name", { length: 200 }),
  storeId: uuid("store_id"),
  storeName: varchar("store_name", { length: 200 }),
  styleId: uuid("style_id"),
  styleNo: varchar("style_no", { length: 50 }),
  styleName: varchar("style_name", { length: 200 }),
  totalQty: numeric("total_qty").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  submitDate: date("submit_date"),
  confirmDate: date("confirm_date"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("pre_order_pre_order_no_key").on(table.preOrderNo),
  index("idx_pre_order_show").on(table.tradeShowId),
  index("idx_pre_order_status").on(table.status),
  index("idx_pre_order_style").on(table.styleId),
  index("idx_pre_order_dealer").on(table.dealerId),
]);

export const tradeShow = pgTable("trade_show", {
  id: uuid("id").primaryKey().defaultRandom(),
  showNo: varchar("show_no", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  year: varchar("year", { length: 10 }),
  season: varchar("season", { length: 20 }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("trade_show_show_no_key").on(table.showNo),
  index("idx_trade_show_status").on(table.status),
]);

export const tradeShowTheme = pgTable("trade_show_theme", {
  id: uuid("id").primaryKey().defaultRandom(),
  themeCode: varchar("theme_code", { length: 50 }).notNull().unique(),
  themeName: varchar("theme_name", { length: 200 }).notNull(),
  year: varchar("year", { length: 10 }),
  season: varchar("season", { length: 20 }),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("trade_show_theme_theme_code_key").on(table.themeCode),
  index("idx_trade_show_theme_status").on(table.status),
  index("idx_trade_show_theme_year").on(table.year),
  index("idx_trade_show_theme_sort").on(table.sortOrder),
]);

export const store = pgTable("store", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  storeType: varchar("store_type", { length: 20 }).notNull().default('direct'),
  dealerId: uuid("dealer_id"),
  warehouseId: uuid("warehouse_id"),
  contactPerson: varchar("contact_person", { length: 100 }),
  phone: varchar("phone", { length: 255 }),
  phoneHmac: varchar("phone_hmac", { length: 64 }),
  address: text("address"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("store_code_key").on(table.code),
  index("idx_store_type").on(table.storeType),
  index("idx_store_dealer").on(table.dealerId),
  index("idx_store_warehouse").on(table.warehouseId),
  index("idx_store_status").on(table.status),
  index("idx_store_phone_hmac").on(table.phoneHmac),
]);

export const dealer = pgTable("dealer", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  contactPerson: varchar("contact_person", { length: 100 }),
  phone: varchar("phone", { length: 255 }),
  phoneHmac: varchar("phone_hmac", { length: 64 }),
  address: text("address"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  parentId: uuid("parent_id"),
  level: integer("level").notNull().default(0),
  treePath: varchar("tree_path", { length: 500 }),
  partnerType: varchar("partner_type", { length: 20 }).notNull().default('hq'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("dealer_code_key").on(table.code),
  index("idx_dealer_status").on(table.status),
  index("idx_dealer_phone_hmac").on(table.phoneHmac),
  index("idx_dealer_parent_id").on(table.parentId),
  index("idx_dealer_tree_path").on(table.treePath),
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [dealer.id],
    name: "dealer_parent_id_fkey",
  }).onDelete("restrict"),
]);

export const styleAttribute = pgTable("style_attribute", {
  id: uuid("id").primaryKey().defaultRandom(),
  attrType: varchar("attr_type", { length: 20 }).notNull(),
  attrCode: varchar("attr_code", { length: 50 }).notNull(),
  attrName: varchar("attr_name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  parentCode: varchar("parent_code", { length: 50 }),
  remark: varchar("remark", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("uk_style_attr_type_code").on(table.attrType, table.attrCode),
  index("idx_style_attr_type").on(table.attrType),
  index("idx_style_attr_status").on(table.status),
  index("idx_style_attr_parent").on(table.parentCode),
]);

export const codeMappingConfig = pgTable("code_mapping_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  configKey: varchar("config_key", { length: 50 }).notNull().unique(),
  configData: jsonb("config_data").notNull().default('[]'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("code_mapping_config_config_key_key").on(table.configKey),
]);

export const codeRule = pgTable("code_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  /**
   * @type { import("@shared/api.interface").CodeRuleSegment[] }
   */
  segments: jsonb("segments").notNull().default('[]'),
  isDefault: boolean("is_default").notNull().default(false),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const payablePayment = pgTable("payable_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  payableId: uuid("payable_id").notNull(),
  paymentDate: date("payment_date").notNull(),
  amount: numeric("amount").notNull().default('0'),
  paymentMethod: varchar("payment_method", { length: 50 }),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.payableId],
    foreignColumns: [payable.id],
    name: "payable_payment_payable_id_fkey",
  }).onDelete("cascade"),
]);

export const payable = pgTable("payable", {
  id: uuid("id").primaryKey().defaultRandom(),
  payableNo: varchar("payable_no", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  bizType: varchar("biz_type", { length: 30 }).notNull(),
  bizNo: varchar("biz_no", { length: 50 }).notNull(),
  amount: numeric("amount").notNull().default('0'),
  paidAmount: numeric("paid_amount").notNull().default('0'),
  balance: numeric("balance").notNull().default('0'),
  dueDate: date("due_date"),
  status: varchar("status", { length: 20 }).notNull().default('unpaid'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("payable_payable_no_key").on(table.payableNo),
  foreignKey({
    columns: [table.supplierId],
    foreignColumns: [supplier.id],
    name: "payable_supplier_id_fkey",
  }),
]);

export const receivablePayment = pgTable("receivable_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  receivableId: uuid("receivable_id").notNull(),
  paymentDate: date("payment_date").notNull(),
  amount: numeric("amount").notNull().default('0'),
  paymentMethod: varchar("payment_method", { length: 50 }),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.receivableId],
    foreignColumns: [receivable.id],
    name: "receivable_payment_receivable_id_fkey",
  }).onDelete("cascade"),
]);

export const receivable = pgTable("receivable", {
  id: uuid("id").primaryKey().defaultRandom(),
  receivableNo: varchar("receivable_no", { length: 50 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 200 }),
  dealerId: uuid("dealer_id"),
  bizType: varchar("biz_type", { length: 30 }).notNull(),
  bizNo: varchar("biz_no", { length: 50 }).notNull(),
  amount: numeric("amount").notNull().default('0'),
  receivedAmount: numeric("received_amount").notNull().default('0'),
  balance: numeric("balance").notNull().default('0'),
  dueDate: date("due_date"),
  status: varchar("status", { length: 20 }).notNull().default('unpaid'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("receivable_receivable_no_key").on(table.receivableNo),
  index("idx_receivable_dealer_id").on(table.dealerId),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "receivable_dealer_id_fkey",
  }),
]);

export const inventoryStocktakeItem = pgTable("inventory_stocktake_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  stocktakeId: uuid("stocktake_id").notNull(),
  skuId: uuid("sku_id"),
  materialId: uuid("material_id"),
  itemCode: varchar("item_code", { length: 100 }).notNull(),
  itemName: varchar("item_name", { length: 200 }).notNull(),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  bookQty: numeric("book_qty").notNull().default('0'),
  actualQty: numeric("actual_qty").notNull().default('0'),
  diffQty: numeric("diff_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.stocktakeId],
    foreignColumns: [inventoryStocktake.id],
    name: "inventory_stocktake_item_stocktake_id_fkey",
  }).onDelete("cascade"),
]);

export const inventoryStocktake = pgTable("inventory_stocktake", {
  id: uuid("id").primaryKey().defaultRandom(),
  stocktakeNo: varchar("stocktake_no", { length: 50 }).notNull().unique(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  stocktakeDate: date("stocktake_date").notNull(),
  itemType: varchar("item_type", { length: 20 }).notNull().default('sku'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("inventory_stocktake_stocktake_no_key").on(table.stocktakeNo),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "inventory_stocktake_warehouse_id_fkey",
  }),
]);

export const inventoryTransferItem = pgTable("inventory_transfer_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferId: uuid("transfer_id").notNull(),
  skuId: uuid("sku_id"),
  materialId: uuid("material_id"),
  itemCode: varchar("item_code", { length: 100 }).notNull(),
  itemName: varchar("item_name", { length: 200 }).notNull(),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_inventory_transfer_item_transfer_id").on(table.transferId),
  foreignKey({
    columns: [table.transferId],
    foreignColumns: [inventoryTransfer.id],
    name: "inventory_transfer_item_transfer_id_fkey",
  }).onDelete("cascade"),
]);

export const inventoryTransfer = pgTable("inventory_transfer", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferNo: varchar("transfer_no", { length: 50 }).notNull().unique(),
  fromWarehouseId: uuid("from_warehouse_id").notNull(),
  fromWarehouseName: varchar("from_warehouse_name", { length: 200 }).notNull(),
  toWarehouseId: uuid("to_warehouse_id").notNull(),
  toWarehouseName: varchar("to_warehouse_name", { length: 200 }).notNull(),
  transferDate: date("transfer_date").notNull(),
  itemType: varchar("item_type", { length: 20 }).notNull().default('sku'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("inventory_transfer_transfer_no_key").on(table.transferNo),
  foreignKey({
    columns: [table.fromWarehouseId],
    foreignColumns: [warehouse.id],
    name: "inventory_transfer_from_warehouse_id_fkey",
  }),
  foreignKey({
    columns: [table.toWarehouseId],
    foreignColumns: [warehouse.id],
    name: "inventory_transfer_to_warehouse_id_fkey",
  }),
]);

/**
 * 补货管理（下游渠道铺货）— 补货计划头。
 * 记录一次"计算 + 生成单据"的动作快照；生成的目标单据类型为销售单/调拨单（均草稿）。
 * 与现有 inventory_replenish（上游采购补货）解耦，独立建表，避免方向混淆。
 */
export const replenishPlan = pgTable("replenish_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  planNo: varchar("plan_no", { length: 50 }).notNull().unique(),
  templateId: uuid("template_id"),
  storeId: uuid("store_id").notNull(),
  storeType: varchar("store_type", { length: 20 }).notNull(),
  storeName: varchar("store_name", { length: 200 }),
  docType: varchar("doc_type", { length: 20 }).notNull(), // 'sales_order' | 'transfer'
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  calcSnapshot: jsonb("calc_snapshot"), // 计算参数与结果快照
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  index("idx_replenish_plan_store").on(table.storeId),
  index("idx_replenish_plan_doc_type").on(table.docType),
]);

/** 补货计划明细：每 SKU 的计算过程与建议量，以及生成后回填的单据引用。 */
export const replenishPlanItem = pgTable("replenish_plan_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 64 }),
  styleNo: varchar("style_no", { length: 32 }),
  color: varchar("color", { length: 32 }),
  size: varchar("size", { length: 32 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  recentSalesQty: numeric("recent_sales_qty"),
  dailyAvg: numeric("daily_avg"),
  currentStock: numeric("current_stock"),
  inTransitQty: numeric("in_transit_qty"),
  safetyStock: numeric("safety_stock"),
  suggestedRaw: numeric("suggested_raw"),
  suggestedQty: numeric("suggested_qty").notNull(),
  generatedDocId: varchar("generated_doc_id", { length: 64 }),
  generatedDocNo: varchar("generated_doc_no", { length: 64 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_replenish_plan_item_plan").on(table.planId),
  foreignKey({
    columns: [table.planId],
    foreignColumns: [replenishPlan.id],
    name: "replenish_plan_item_plan_id_fkey",
  }).onDelete("cascade"),
]);

/**
 * 补货模板 / 规则（Phase 2 自动生成用）。Phase 1 仅建表，模板 CRUD 与调度器后续落地。
 */
export const replenishTemplate = pgTable("replenish_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  scopeType: varchar("scope_type", { length: 20 }).notNull().default('all'),
  storeFilter: jsonb("store_filter"),
  skuFilter: jsonb("sku_filter"),
  paramN: integer("param_n").notNull().default(30),
  expectedDays: integer("expected_days").notNull().default(14),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  safetyDays: integer("safety_days").notNull().default(0),
  caseQty: numeric("case_qty").notNull().default('1'),
  sourceWarehouseRule: varchar("source_warehouse_rule", { length: 20 }).notNull().default('fixed'),
  fixedWarehouseId: uuid("fixed_warehouse_id"),
  enabled: boolean("enabled").notNull().default(false),
  cron: varchar("cron", { length: 100 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  index("idx_replenish_template_enabled").on(table.enabled),
]);

export const materialStock = pgTable("material_stock", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("idx_material_stock_mat_wh").on(table.materialId, table.warehouseId),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "material_stock_material_id_fkey",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "material_stock_warehouse_id_fkey",
  }),
]);

export const inventoryStock = pgTable("inventory_stock", {
  id: uuid("id").primaryKey().defaultRandom(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  inTransitQty: numeric("in_transit_qty").notNull().default('0'),
  // 库存成本价（盘盈/盘亏金额计算基准，由盘点记账回填；历史默认 0）
  unitPrice: numeric("unit_price").notNull().default('0'),
  // 库存金额 = quantity * unitPrice（盘点记账后维护，其余出入库暂不维护）
  amount: numeric("amount").notNull().default('0'),
  // 库存类型（服装零售核心维度，迁移 0048）：
  //   normal 正常品 / defective 残次品 / sample 样品 / leftover 尾货 / clearance 清仓
  //   使同一 SKU 在同一仓库可并存多种类型（如 正常品 50 件 + 残次品 2 件），
  //   解决此前「瑕疵款只能当正品回库、样品占用正品库存、尾货无法单独清理」的问题。
  //   存量数据已回填为 'normal'，业务行为与改造前完全一致。
  stockType: varchar("stock_type", { length: 20 }).notNull().default('normal'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  // 唯一索引纳入 stock_type（迁移 0048）：原 (skuId, warehouseId) 唯一约束
  // 会锁死「一 SKU 一仓只有一行数量」，导致多类型库存无法并存。
  uniqueIndex("idx_inventory_stock_sku_wh_type").on(table.skuId, table.warehouseId, table.stockType),
  uniqueIndex("uk_inventory_stock_warehouse_sku_type").on(table.warehouseId, table.skuId, table.stockType),
  index("idx_inventory_stock_type").on(table.stockType),
  foreignKey({
    columns: [table.skuId],
    foreignColumns: [sku.id],
    name: "inventory_stock_sku_id_fkey",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "inventory_stock_warehouse_id_fkey",
  }),
]);

export const inventoryFlow = pgTable("inventory_flow", {
  id: uuid("id").primaryKey().defaultRandom(),
  flowType: varchar("flow_type", { length: 30 }).notNull(),
  bizNo: varchar("biz_no", { length: 50 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  itemType: varchar("item_type", { length: 20 }).notNull().default('sku'),
  skuId: uuid("sku_id"),
  materialId: uuid("material_id"),
  styleNo: varchar("style_no", { length: 50 }),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  materialCode: varchar("material_code", { length: 50 }),
  materialName: varchar("material_name", { length: 200 }),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  unitPrice: numeric("unit_price"),
  operator: varchar("operator", { length: 100 }),
  remark: text("remark"),
  // 单据业务日期（独立于 _created_at 的过账日期）：出库单筛"单据日期"，入库单筛"单据日期"
  bizDate: date("biz_date").default(sql`CURRENT_DATE`),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_inventory_flow_sku").on(table.skuId, table.warehouseId),
  index("idx_inventory_flow_material").on(table.materialId, table.warehouseId),
  index("idx_inventory_flow_biz").on(table.bizNo),
  index("idx_inventory_flow_type_wh_created").on(table.flowType, table.warehouseId, table.createdAt),
  index("idx_inventory_flow_created_at").on(table.createdAt),
]);

export const salesReturnItem = pgTable("sales_return_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [salesReturn.id],
    name: "sales_return_item_return_id_fkey",
  }).onDelete("cascade"),
]);

export const salesReturn = pgTable("sales_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  outboundId: uuid("outbound_id").notNull(),
  outboundNo: varchar("outbound_no", { length: 50 }).notNull(),
  customerName: varchar("customer_name", { length: 200 }),
  dealerId: uuid("dealer_id"),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  returnDate: date("return_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // 分销镜像可观测性：销售退货记账后向下游生成采购退货单的结果反馈
  mirrorStatus: varchar("mirror_status", { length: 10 }),
  mirrorError: text("mirror_error"),
  mirrorReturnId: uuid("mirror_return_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（与 BaseCrudService 软删逻辑对齐）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("sales_return_return_no_key").on(table.returnNo),
  index("idx_sales_return_dealer_id").on(table.dealerId),
  index("idx_sales_return_mirror_status").on(table.mirrorStatus),
  foreignKey({
    columns: [table.outboundId],
    foreignColumns: [salesOutbound.id],
    name: "sales_return_outbound_id_fkey",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "sales_return_warehouse_id_fkey",
  }),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "sales_return_dealer_id_fkey",
  }),
]);

export const salesOutboundItem = pgTable("sales_outbound_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  outboundId: uuid("outbound_id").notNull(),
  orderItemId: uuid("order_item_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  costPrice: numeric("cost_price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  costAmount: numeric("cost_amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_sales_outbound_item_outbound_id").on(table.outboundId),
  foreignKey({
    columns: [table.outboundId],
    foreignColumns: [salesOutbound.id],
    name: "sales_outbound_item_outbound_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.orderItemId],
    foreignColumns: [salesOrderItem.id],
    name: "sales_outbound_item_order_item_id_fkey",
  }),
]);

export const salesOutbound = pgTable("sales_outbound", {
  id: uuid("id").primaryKey().defaultRandom(),
  outboundNo: varchar("outbound_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  customerName: varchar("customer_name", { length: 200 }),
  dealerId: uuid("dealer_id"),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  outboundDate: date("outbound_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  costAmount: numeric("cost_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（与 BaseCrudService 软删逻辑对齐）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("sales_outbound_outbound_no_key").on(table.outboundNo),
  index("idx_sales_outbound_dealer_id").on(table.dealerId),
  index("idx_sales_outbound_outbound_date").on(table.outboundDate),
  index("idx_sales_outbound_status").on(table.status),
  index("idx_sales_outbound_order_id").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [salesOrder.id],
    name: "sales_outbound_order_id_fkey",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "sales_outbound_warehouse_id_fkey",
  }),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "sales_outbound_dealer_id_fkey",
  }),
]);

export const salesOrderItem = pgTable("sales_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  deliveredQty: numeric("delivered_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_sales_order_item_order_id").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [salesOrder.id],
    name: "sales_order_item_order_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.skuId],
    foreignColumns: [sku.id],
    name: "sales_order_item_sku_id_fkey",
  }),
]);

export const salesOrder = pgTable("sales_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 软删除标记：非空表示已删除（BaseCrudService 软删逻辑据此过滤/置位）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 200 }),
  dealerId: uuid("dealer_id"),
  orderDate: date("order_date").notNull(),
  deliveryDate: date("delivery_date"),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  // 来源：手动新增(manual) / 订货会(trade_show) / 补货计划(replenish_plan)。
  // 与订货会产生的订单除来源不同外逻辑一致；默认 manual 即本功能新增的手动单。
  sourceType: varchar("source_type", { length: 20 }).notNull().default('manual'),
  sourceNo: varchar("source_no", { length: 50 }),
  remark: text("remark"),
  // 分销镜像可观测性：销售单记账后向下游生成采购单的结果反馈
  mirrorStatus: varchar("mirror_status", { length: 10 }),
  mirrorError: text("mirror_error"),
  mirrorOrderId: uuid("mirror_order_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sales_order_order_no_key").on(table.orderNo),
  index("idx_sales_order_dealer_id").on(table.dealerId),
  index("idx_sales_order_mirror_status").on(table.mirrorStatus),
  index("idx_sales_order_order_date").on(table.orderDate),
  index("idx_sales_order_status").on(table.status),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "sales_order_dealer_id_fkey",
  }),
]);

export const purchaseReturnItem = pgTable("purchase_return_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [purchaseReturn.id],
    name: "purchase_return_item_return_id_fkey",
  }).onDelete("cascade"),
]);

export const purchaseReturn = pgTable("purchase_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  // 关联采购入库单：解耦后可为空（支持批量/无单退货），历史单据仍保留原值
  inboundId: uuid("inbound_id"),
  inboundNo: varchar("inbound_no", { length: 50 }),
  // 供应商（收货方为供应商时填充；经销商账户退货无供应商，可为空）
  supplierId: uuid("supplier_id"),
  supplierName: varchar("supplier_name", { length: 200 }),
  // 业务归属经销商：HQ 退货为 NULL，经销商退货=本经销商，用于行级数据隔离
  dealerId: uuid("dealer_id"),
  // 退货店仓（货物来源）
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  // 收货方（多态）：supplier=供应商（总部退货）；store=上级经销商店仓（经销商退货）
  receiverType: varchar("receiver_type", { length: 20 }).notNull().default('supplier'),
  receiverId: uuid("receiver_id"),
  receiverName: varchar("receiver_name", { length: 200 }),
  returnDate: date("return_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("purchase_return_return_no_key").on(table.returnNo),
  index("idx_purchase_return_inbound").on(table.inboundId),
  index("idx_purchase_return_dealer").on(table.dealerId),
  index("idx_purchase_return_receiver").on(table.receiverId),
  foreignKey({
    columns: [table.inboundId],
    foreignColumns: [purchaseInbound.id],
    name: "purchase_return_inbound_id_fkey",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "purchase_return_warehouse_id_fkey",
  }),
  foreignKey({
    columns: [table.dealerId],
    foreignColumns: [dealer.id],
    name: "purchase_return_dealer_id_fkey",
  }).onDelete("restrict"),
]);

export const purchaseInboundItem = pgTable("purchase_inbound_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  inboundId: uuid("inbound_id").notNull(),
  orderItemId: uuid("order_item_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_purchase_inbound_item_inbound_id").on(table.inboundId),
  foreignKey({
    columns: [table.inboundId],
    foreignColumns: [purchaseInbound.id],
    name: "purchase_inbound_item_inbound_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.orderItemId],
    foreignColumns: [purchaseOrderItem.id],
    name: "purchase_inbound_item_order_item_id_fkey",
  }),
]);

export const purchaseInbound = pgTable("purchase_inbound", {
  id: uuid("id").primaryKey().defaultRandom(),
  inboundNo: varchar("inbound_no", { length: 50 }).notNull().unique(),
  orderId: uuid("order_id").notNull(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  inboundDate: date("inbound_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（与 BaseCrudService 软删逻辑对齐）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("purchase_inbound_inbound_no_key").on(table.inboundNo),
  index("idx_purchase_inbound_inbound_date").on(table.inboundDate),
  index("idx_purchase_inbound_supplier_id").on(table.supplierId),
  index("idx_purchase_inbound_status").on(table.status),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [purchaseOrder.id],
    name: "purchase_inbound_order_id_fkey",
  }),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "purchase_inbound_warehouse_id_fkey",
  }),
]);

export const purchaseOrderItem = pgTable("purchase_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  receivedQty: numeric("received_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [purchaseOrder.id],
    name: "purchase_order_item_order_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "purchase_order_item_material_id_fkey",
  }),
]);

export const purchaseOrder = pgTable("purchase_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 软删除标记：非空表示已删除（BaseCrudService 软删逻辑据此过滤/置位）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id").notNull(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  orderDate: date("order_date").notNull(),
  expectDate: date("expect_date"),
  totalAmount: numeric("total_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("purchase_order_order_no_key").on(table.orderNo),
  index("idx_purchase_order_order_date").on(table.orderDate),
  index("idx_purchase_order_supplier_id").on(table.supplierId),
  index("idx_purchase_order_status").on(table.status),
  foreignKey({
    columns: [table.supplierId],
    foreignColumns: [supplier.id],
    name: "purchase_order_supplier_id_fkey",
  }),
]);

export const bomItem = pgTable("bom_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  bomId: uuid("bom_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 50 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  usagePerPiece: numeric("usage_per_piece").notNull().default('0'),
  lossRate: numeric("loss_rate").notNull().default('0'),
  bomType: varchar("bom_type", { length: 20 }).notNull().default('main'),
  // 多级 BOM 层级（迁移 0049）：
  //   parentItemId 指向父级明细行；NULL = 一级部件（直接挂成衣）
  //   level 层级深度，1 = 一级部件。有父级时由触发器强制为「父级 level + 1」，
  //   并保证父级与本行同属一个 BOM（跨 BOM 挂父会被 trg_bom_item_parent_guard 拒绝）。
  //   存量 7 条明细已回填 level=1 / parentItemId=NULL，行为与改造前完全一致。
  parentItemId: uuid("parent_item_id"),
  level: integer("level").notNull().default(1),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  // 多级 BOM 递归展开索引（迁移 0049）：
  //   自关联外键与触发器（父级同 BOM、level=父级+1）由迁移脚本管理，
  //   此处仅声明查询索引，与库内 idx_bom_item_bom_parent / _parent / _level 对齐。
  index("idx_bom_item_bom_parent").on(table.bomId, table.parentItemId),
  index("idx_bom_item_parent").on(table.parentItemId),
  index("idx_bom_item_level").on(table.level),
  foreignKey({
    columns: [table.bomId],
    foreignColumns: [bom.id],
    name: "bom_item_bom_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "bom_item_material_id_fkey",
  }),
]);

export const bom = pgTable("bom", {
  id: uuid("id").primaryKey().defaultRandom(),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  version: varchar("version", { length: 50 }).default('V1'),
  remark: text("remark"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("idx_bom_style_version").on(table.styleId, table.version),
  foreignKey({
    columns: [table.styleId],
    foreignColumns: [style.id],
    name: "bom_style_id_fkey",
  }),
]);

export const warehouse = pgTable("warehouse", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  address: text("address"),
  remark: text("remark"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  dealerId: uuid("dealer_id"),
  storeType: varchar("store_type", { length: 20 }),
  storeCode: varchar("store_code", { length: 50 }),
  storeName: varchar("store_name", { length: 200 }),
  storeAddress: text("store_address"),
  storeManager: varchar("store_manager", { length: 100 }),
  storePhone: varchar("store_phone", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（BaseCrudService 软删逻辑据此过滤/置位）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("warehouse_code_key").on(table.code),
  index("idx_warehouse_dealer").on(table.dealerId),
  index("idx_warehouse_store_type").on(table.storeType),
]);

export const supplier = pgTable("supplier", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  contactPerson: varchar("contact_person", { length: 100 }),
  phone: varchar("phone", { length: 255 }),
  phoneHmac: varchar("phone_hmac", { length: 64 }),
  address: text("address"),
  supplyCategory: varchar("supply_category", { length: 200 }),
  remark: text("remark"),
  partnerId: uuid("partner_id"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（BaseCrudService 软删逻辑据此过滤/置位）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("supplier_code_key").on(table.code),
  index("idx_supplier_phone_hmac").on(table.phoneHmac),
  index("idx_supplier_partner_id").on(table.partnerId),
  foreignKey({
    columns: [table.partnerId],
    foreignColumns: [dealer.id],
    name: "supplier_partner_id_fkey",
  }).onDelete("set null"),
]);

export const material = pgTable("material", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }).notNull(),
  defaultSupplierId: uuid("default_supplier_id"),
  stdPrice: numeric("std_price").default('0'),
  category: varchar("category", { length: 50 }),
  remark: text("remark"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // 物料级安全库存比例（占毛需求的百分比，0~1）：MRP 未显式传入 safetyStockPct 时回退到此默认值
  safetyStockPct: numeric("safety_stock_pct").notNull().default('0'),
  // 物料级最小订货量 MOQ：MRP 未显式传入 moq 时回退到此默认值（0 表示不向上取整）
  moq: numeric("moq").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("material_code_key").on(table.code),
  index("idx_material_safety_stock_pct").on(table.safetyStockPct),
  index("idx_material_moq").on(table.moq),
]);

export const sku = pgTable("sku", {
  id: uuid("id").primaryKey().defaultRandom(),
  skuCode: varchar("sku_code", { length: 100 }).notNull().unique(),
  styleId: uuid("style_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  barcode: varchar("barcode", { length: 100 }),
  costPrice: numeric("cost_price").default('0'),
  tagPrice: numeric("tag_price").default('0'),
  supplyPrice: numeric("supply_price").default('0'),
  safetyStockMin: numeric("safety_stock_min").default('0'),
  safetyStockMax: numeric("safety_stock_max").default('0'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sku_sku_code_key").on(table.skuCode),
  uniqueIndex("idx_sku_style_color_id_size_id").on(table.styleId, table.colorId, table.sizeId),
  index("idx_sku_color").on(table.color),
  index("idx_sku_size").on(table.size),
  index("idx_sku_status").on(table.status),
  foreignKey({
    columns: [table.styleId],
    foreignColumns: [style.id],
    name: "sku_style_id_fkey",
  }),
]);

export const style = pgTable("style", {
  id: uuid("id").primaryKey().defaultRandom(),
  styleNo: varchar("style_no", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }),
  season: varchar("season", { length: 50 }),
  wave: varchar("wave", { length: 50 }),
  // 上市日期与季末清货阈值（迁移 0050，服装零售核心指标）：
  //   launchDate 用于计算「上市天数 / 上市首周售罄率」，支撑新品与老品判定、
  //   订货会上新节奏复盘；存量已由 wave（如 2026AW → 当年 09-01）回填 10 款。
  //   clearanceDays 为季末清货阈值（默认 90 天，服装春夏/秋冬两季常见周期），
  //   超过「上市日期 + clearanceDays」即视为过季，可触发清货折扣建议。
  //   置 0 表示不做自动清货判定。CHECK 约束限定 0-365。
  launchDate: date("launch_date"),
  clearanceDays: integer("clearance_days").notNull().default(90),
  tagPrice: numeric("tag_price").default('0'),
  costPrice: numeric("cost_price").default('0'),
  supplyPrice: numeric("supply_price").default('0'),
  colorGroupId: uuid("color_group_id").notNull(),
  sizeGroupId: uuid("size_group_id").notNull(),
  // 四大改造 C：款号关联的编码规则（可为空，删除规则时 SET NULL）
  codeRuleId: uuid("code_rule_id"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  year: varchar("year", { length: 10 }),
  fit: varchar("fit", { length: 50 }),
  subCategory: varchar("sub_category", { length: 50 }),
  brand: varchar("brand", { length: 50 }),
  /**
   * @type { Record<string, string> }
   */
  attributes: jsonb("attributes").notNull().default('{}'),
  lifecycleStatus: varchar("lifecycle_status", { length: 20 }).notNull().default('introduction'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // P0-3 泛化合并（3b/3c）：被合并款式指向存活方 style.id（绝不删除被合并款式，仅打标）
  mergedInto: uuid("merged_into"),
  // P0-3 泛化合并：合并时间（打标用，非软删）
  mergedAt: customTimestamptz("merged_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("style_style_no_key").on(table.styleNo),
  index("idx_style_status").on(table.status),
  index("idx_style_category").on(table.category),
  index("idx_style_brand").on(table.brand),
  index("idx_style_merged_into").on(table.mergedInto),
  // 上市日期索引（迁移 0050）：新品/老品筛选与季末清货扫描
  index("idx_style_launch_date").on(table.launchDate),
  index("idx_style_season_launch").on(table.season, table.launchDate),
  foreignKey({
    columns: [table.colorGroupId],
    foreignColumns: [colorGroup.id],
    name: "style_color_group_id_fkey",
  }),
  foreignKey({
    columns: [table.sizeGroupId],
    foreignColumns: [sizeGroup.id],
    name: "style_size_group_id_fkey",
  }),
  // 四大改造 C：款号 → 编码规则（删除规则时解除关联，不级联删款号）
  foreignKey({
    columns: [table.codeRuleId],
    foreignColumns: [codeRule.id],
    name: "style_code_rule_id_fkey",
  }).onDelete("set null"),
  // 自愈引用：删除/改指 survivor 时把 mergedInto 置空（被合并款式不会被级联删）
  foreignKey({
    columns: [table.mergedInto],
    foreignColumns: [table.id],
    name: "style_merged_into_fkey",
  }).onDelete("set null"),
]);

export const sizeGroup = pgTable("size_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  /**
   * @type string[]
   */
  sizes: jsonb("sizes").notNull().default('[]'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（BaseCrudService 软删逻辑据此过滤/置位）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("size_group_code_key").on(table.code),
]);

export const colorGroup = pgTable("color_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  /**
   * @type { name: string; value: string }[]
   */
  colors: jsonb("colors").notNull().default('[]'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
  // 软删除标记：非空表示已删除（BaseCrudService 软删逻辑据此过滤/置位）
  deletedAt: customTimestamptz("_deleted_at", { precision: 3 }),
}, (table) => [
  uniqueIndex("color_group_code_key").on(table.code),
]);



// table aliases
export const allocationItemTable = allocationItem;
export const allocationOrderTable = allocationOrder;
export const bomTable = bom;
export const bomItemTable = bomItem;
export const codeMappingConfigTable = codeMappingConfig;
export const codeRuleTable = codeRule;
export const colorGroupTable = colorGroup;
export const dealerTable = dealer;
export const financePaymentTable = financePayment;
export const financePaymentWriteoffTable = financePaymentWriteoff;
export const financeReceiptTable = financeReceipt;
export const financeReceiptWriteoffTable = financeReceiptWriteoff;
export const garmentPurchaseInboundTable = garmentPurchaseInbound;
export const garmentPurchaseInboundSkuTable = garmentPurchaseInboundSku;
export const garmentPurchaseOrderTable = garmentPurchaseOrder;
export const garmentPurchaseOrderSkuTable = garmentPurchaseOrderSku;
export const garmentPurchaseReturnTable = garmentPurchaseReturn;
export const garmentPurchaseReturnSkuTable = garmentPurchaseReturnSku;
export const inventoryBatchTable = inventoryBatch;
export const inventoryFlowTable = inventoryFlow;
export const inventoryStockTable = inventoryStock;
export const inventoryStocktakeTable = inventoryStocktake;
export const inventoryStocktakeItemTable = inventoryStocktakeItem;
export const inventoryTransferTable = inventoryTransfer;
export const inventoryTransferItemTable = inventoryTransferItem;
export const materialTable = material;
export const materialPurchaseInboundTable = materialPurchaseInbound;
export const materialPurchaseInboundItemTable = materialPurchaseInboundItem;
export const materialPurchaseOrderTable = materialPurchaseOrder;
export const materialPurchaseOrderItemTable = materialPurchaseOrderItem;
export const materialStockTable = materialStock;
export const memberTable = member;
export const memberPointTable = memberPoint;
export const memberTagTable = memberTag;
export const monthCloseTable = monthClose;
export const monthCloseDetailTable = monthCloseDetail;
export const monthCloseLogTable = monthCloseLog;
export const omniOrderTable = omniOrder;
export const omniOrderItemTable = omniOrderItem;
export const payableTable = payable;
export const payablePaymentTable = payablePayment;
export const preOrderTable = preOrder;
export const preOrderItemTable = preOrderItem;
export const productionFinishReceiptTable = productionFinishReceipt;
export const productionFinishReceiptItemTable = productionFinishReceiptItem;
export const productionMaterialIssueTable = productionMaterialIssue;
export const productionMaterialIssueItemTable = productionMaterialIssueItem;
export const productionWorkOrderTable = productionWorkOrder;
export const purchaseInboundTable = purchaseInbound;
export const purchaseInboundItemTable = purchaseInboundItem;
export const purchaseOrderTable = purchaseOrder;
export const purchaseOrderItemTable = purchaseOrderItem;
export const purchaseReconciliationTable = purchaseReconciliation;
export const purchaseReturnTable = purchaseReturn;
export const purchaseReturnItemTable = purchaseReturnItem;
export const rbacPermissionTable = rbacPermission;
export const rbacRoleTable = rbacRole;
export const rbacRolePermissionTable = rbacRolePermission;
export const rbacUserTable = rbacUser;
export const rbacUserRoleTable = rbacUserRole;
export const rbacUserTokenTable = rbacUserToken;
export const receivableTable = receivable;
export const receivablePaymentTable = receivablePayment;
export const retailOrderTable = retailOrder;
export const retailOrderItemTable = retailOrderItem;
export const retailReturnTable = retailReturn;
export const salesChannelTable = salesChannel;
export const salesOrderTable = salesOrder;
export const salesOrderItemTable = salesOrderItem;
export const salesOutboundTable = salesOutbound;
export const salesOutboundItemTable = salesOutboundItem;
export const salesReconciliationTable = salesReconciliation;
export const salesReturnTable = salesReturn;
export const salesReturnItemTable = salesReturnItem;
export const sizeGroupTable = sizeGroup;
export const skuTable = sku;
export const storeTable = store;
export const styleTable = style;
export const styleAttrDefTable = styleAttrDef;
export const styleAttrValueTable = styleAttrValue;
export const styleAttributeTable = styleAttribute;
export const subcontractFeeTable = subcontractFee;
export const subcontractIssueTable = subcontractIssue;
export const subcontractIssueItemTable = subcontractIssueItem;
export const subcontractOrderTable = subcontractOrder;
export const subcontractOrderItemTable = subcontractOrderItem;
export const subcontractReceiptTable = subcontractReceipt;
export const subcontractReceiptItemTable = subcontractReceiptItem;
export const supplierTable = supplier;
export const systemConfigTable = systemConfig;
export const systemOperationLogTable = systemOperationLog;
export const tradeShowTable = tradeShow;
export const warehouseTable = warehouse;

/* =========================================================================
 * 价格 / 促销引擎 (Pricing Engine)
 * =======================================================================*/

export const priceList = pgTable("price_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // store | channel | member | customer
  type: varchar("type", { length: 20 }).notNull().default('store'),
  // 适用对象ID：门店ID / 渠道ID / 会员等级ID，按 type 解释
  scopeId: uuid("scope_id"),
  // 优先级，数值越大优先级越高
  priority: integer("priority").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  remark: varchar("remark", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_price_list_type").on(table.type),
  index("idx_price_list_scope").on(table.scopeId),
  index("idx_price_list_status").on(table.status),
  // 状态 + 有效期复合索引，加速“当前生效价格表”查询
  index("idx_price_list_active_range").on(table.status, table.effectiveFrom, table.effectiveTo),
]);

export const priceListItem = pgTable("price_list_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  priceListId: uuid("price_list_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }),
  // 为空表示适用该价格表下整款；否则精确到 SKU
  skuId: uuid("sku_id"),
  skuCode: varchar("sku_code", { length: 100 }),
  // 吊牌价（基准）
  tagPrice: numeric("tag_price").notNull().default('0'),
  // 该价格表售价
  price: numeric("price").notNull().default('0'),
  // 折扣率（0~1，price 与 tagPrice 不一致时由调用方维护）
  discountRate: numeric("discount_rate").notNull().default('1'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_pli_price_list").on(table.priceListId),
  index("idx_pli_sku").on(table.skuId),
  index("idx_pli_style").on(table.styleNo),
  foreignKey({
    columns: [table.priceListId],
    foreignColumns: [priceList.id],
    name: "price_list_item_price_list_id_fkey",
  }).onDelete("cascade"),
  // SKU 外键：删除 SKU 时价格表明细置空（保留价格表明细行，仅断开 SKU 关联）
  foreignKey({
    columns: [table.skuId],
    foreignColumns: [sku.id],
    name: "price_list_item_sku_id_fkey",
  }).onDelete("set null"),
  // 唯一约束：同一价格表下同一 SKU 仅一条；整款（skuId 为空）按 styleNo 唯一
  uniqueIndex("uniq_pli_list_sku").on(table.priceListId, table.skuId).where(isNotNull(table.skuId)),
  uniqueIndex("uniq_pli_list_style").on(table.priceListId, table.styleNo).where(isNull(table.skuId)),
]);

export const promotion = pgTable("promotion", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // full_reduction(满减) | percentage(折扣) | fixed_price(特价)
  type: varchar("type", { length: 20 }).notNull().default('full_reduction'),
  // 满减门槛金额
  threshold: numeric("threshold").notNull().default('0'),
  // 减免金额（满减/特价使用）
  reduceAmount: numeric("reduce_amount").notNull().default('0'),
  // 折扣率（0~1，percentage 使用）
  discountRate: numeric("discount_rate").notNull().default('1'),
  beginDate: date("begin_date"),
  endDate: date("end_date"),
  // 适用门店ID列表；为空表示全部门店
  storeIds: jsonb("store_ids").notNull().default('[]'),
  priority: integer("priority").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: varchar("remark", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_promotion_status").on(table.status),
  index("idx_promotion_type").on(table.type),
  // 状态 + 有效期复合索引，加速“当前生效促销”查询
  index("idx_promotion_active_range").on(table.status, table.beginDate, table.endDate),
  // store_ids 为 jsonb 数组，GIN 索引便于按门店命中过滤
  index("idx_promotion_store_ids").using('gin', table.storeIds),
]);

export const coupon = pgTable("coupon", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // full_reduction(满减) | discount(折扣)
  type: varchar("type", { length: 20 }).notNull().default('full_reduction'),
  // 减免金额（满减）
  value: numeric("value").notNull().default('0'),
  // 折扣率（0~1，折扣券）
  discountRate: numeric("discount_rate").notNull().default('1'),
  // 最低消费门槛
  minSpend: numeric("min_spend").notNull().default('0'),
  beginDate: date("begin_date"),
  endDate: date("end_date"),
  totalQty: integer("total_qty").notNull().default(0),
  usedQty: integer("used_qty").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: varchar("remark", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_coupon_status").on(table.status),
  index("idx_coupon_code").on(table.code),
]);

/* =========================================================================
 * 门店 POS 收银班次 (POS Session)
 * =======================================================================*/

export const posSession = pgTable("pos_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),
  storeName: varchar("store_name", { length: 100 }).notNull(),
  cashierId: uuid("cashier_id"),
  cashierName: varchar("cashier_name", { length: 50 }),
  openTime: customTimestamptz("open_time", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  closeTime: customTimestamptz("close_time", { precision: 3 }),
  // 开班备用金
  openAmount: numeric("open_amount").notNull().default('0'),
  // 闭班实点现金
  closeAmount: numeric("close_amount").notNull().default('0'),
  // 应收金额（销售流水合计）
  expectedAmount: numeric("expected_amount").notNull().default('0'),
  // 差异（实点 - 应收 - 备用金）
  difference: numeric("difference").notNull().default('0'),
  // open | closed
  status: varchar("status", { length: 20 }).notNull().default('open'),
  remark: varchar("remark", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_pos_session_store").on(table.storeId),
  index("idx_pos_session_status").on(table.status),
  index("idx_pos_session_open_time").on(table.openTime),
  index("idx_pos_session_store_status").on(table.storeId, table.status),
  // 门店外键：门店被删除时拒绝（避免遗留指向不存在门店的班次，保护引用完整性）
  foreignKey({
    columns: [table.storeId],
    foreignColumns: [store.id],
    name: "pos_session_store_id_fkey",
  }).onDelete("restrict"),
  // 收银员外键：用户被删除时置空（班次记录保留）
  foreignKey({
    columns: [table.cashierId],
    foreignColumns: [rbacUser.id],
    name: "pos_session_cashier_id_fkey",
  }).onDelete("set null"),
]);

/* =========================================================================
 * POS 收银幂等表（防网络重试造成的重复零售单 + 重复扣库存）
 * key 通常为前端/客户端生成的 UUID；bizType 区分业务（如 pos_checkout）。
 * 唯一约束 (key, bizType) 保证同一笔请求不会被并发执行两次。
 * =======================================================================*/
export const posIdempotency = pgTable("pos_idempotency", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 120 }).notNull(),
  bizType: varchar("biz_type", { length: 40 }).notNull(),
  // processing | done | error
  status: varchar("status", { length: 20 }).notNull().default('processing'),
  // 业务结果（done 时回填），供重试直接返回，避免重复执行
  result: jsonb("result"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pos_idempotency_key_uniq").on(table.key, table.bizType),
  index("idx_pos_idempotency_status").on(table.status),
]);

/* =========================================================================
 * 行级数据权限：用户-门店映射 (Row-level data scope)
 * =======================================================================*/

export const rbacUserStore = pgTable("rbac_user_store", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  storeId: uuid("store_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("rbac_user_store_uniq").on(table.userId, table.storeId),
  index("idx_rbac_user_store_user").on(table.userId),
  index("idx_rbac_user_store_store").on(table.storeId),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [rbacUser.id],
    name: "rbac_user_store_user_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.storeId],
    foreignColumns: [store.id],
    name: "rbac_user_store_store_id_fkey",
  }).onDelete("cascade"),
]);

export const priceListTable = priceList;
export const priceListItemTable = priceListItem;
export const promotionTable = promotion;
export const couponTable = coupon;
export const posSessionTable = posSession;
export const rbacUserPartner = pgTable("rbac_user_partner", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  partnerId: uuid("partner_id").notNull(),
  role: varchar("role", { length: 20 }).notNull().default('viewer'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("rbac_user_partner_uniq").on(table.userId, table.partnerId),
  index("idx_rbac_user_partner_user").on(table.userId),
  index("idx_rbac_user_partner_partner").on(table.partnerId),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [rbacUser.id],
    name: "rbac_user_partner_user_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.partnerId],
    foreignColumns: [dealer.id],
    name: "rbac_user_partner_partner_id_fkey",
  }).onDelete("cascade"),
]);

export const rbacUserStoreTable = rbacUserStore;
export const rbacUserPartnerTable = rbacUserPartner;

/* ===================== 吊牌打印模块 (Hangtag) ===================== */

/**
 * 吊牌模板：定义每张吊牌打印的「内容项」与「样式」。
 * - contentConfig：控制显示哪些字段及标签文案（款号/品名/吊牌价/成分/执行标准…）。
 * - styleConfig：纸张尺寸、字体、布局方向、每行列数等。
 */
export const hangtagTemplate = pgTable("hangtag_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  /**
   * @type {{
   *   title?: string;
   *   subtitle?: string;
   *   footer?: string;
   *   fields: { key: string; label: string; show: boolean }[];
   * }}
   */
  contentConfig: jsonb("content_config").notNull().default('{}'),
  /**
   * @type {{ paper?: string; fontSize?: number; layout?: 'vertical' | 'horizontal'; columns?: number }}
   */
  styleConfig: jsonb("style_config").notNull().default('{}'),
  isDefault: boolean("is_default").notNull().default(false),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_hangtag_template_status").on(table.status),
]);

/**
 * 吊牌打印任务 / 打印日志（主表）。
 * 一次「批量打印」生成一条任务，记录打印日期、内容、数量、唯一码区间。
 */
export const hangtagPrintTask = pgTable("hangtag_print_task", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskNo: varchar("task_no", { length: 50 }).notNull().unique(),
  templateId: uuid("template_id").notNull(),
  templateName: varchar("template_name", { length: 200 }).notNull(),
  /** 'purchase_order' = 来自采购单；'manual' = 手工录入款号 */
  sourceType: varchar("source_type", { length: 20 }).notNull(),
  /** 采购单号 或 款号 */
  sourceRef: varchar("source_ref", { length: 100 }).notNull(),
  includeUniqueCode: boolean("include_unique_code").notNull().default(false),
  printDate: date("print_date").notNull(),
  totalQty: numeric("total_qty").notNull().default('0'),
  /** 本次打印分配的唯一码起始值（含），未打印唯一码则为 null */
  uniqueCodeStart: bigint("unique_code_start", { mode: "number" }),
  /** 本次打印分配的唯一码结束值（含），未打印唯一码则为 null */
  uniqueCodeEnd: bigint("unique_code_end", { mode: "number" }),
  /**
   * 打印内容快照：日志展示用（模板名称、展示字段、款号/颜色/尺码/数量清单）。
   * @type {{
   *   templateName: string;
   *   fields: { key: string; label: string }[];
   *   items: { styleNo: string; color: string; size: string; qty: number }[];
   * }}
   */
  contentSnapshot: jsonb("content_snapshot").notNull().default('{}'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_hangtag_task_date").on(table.printDate),
  index("idx_hangtag_task_source").on(table.sourceType, table.sourceRef),
]);

/**
 * 吊牌打印明细：颜色 × 尺码二维表中的每一格（一个 SKU 的打印数量）。
 */
export const hangtagPrintItem = pgTable("hangtag_print_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  styleName: varchar("style_name", { length: 200 }),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  /** 强绑定 SKU：打印时按 款号/颜色/尺码 反查落定，即使后续 SKU 资源变动，打印记录仍可溯源 */
  skuId: uuid("sku_id"),
  quantity: numeric("quantity").notNull().default('0'),
  /** 本明细行分配的唯一码起始值（含），未打印唯一码则为 null */
  uniqueCodeStart: bigint("unique_code_start", { mode: "number" }),
  /** 本明细行分配的唯一码结束值（含），未打印唯一码则为 null */
  uniqueCodeEnd: bigint("unique_code_end", { mode: "number" }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_hangtag_item_task").on(table.taskId),
  foreignKey({
    columns: [table.taskId],
    foreignColumns: [hangtagPrintTask.id],
    name: "hangtag_print_item_task_id_fkey",
  }).onDelete("cascade"),
]);

/* ===================== 唯一码库存 / 单据扫码 (Unique Code) ===================== */

/**
 * 唯一码库存状态表（件级库存权威源）。
 *
 * 设计要点：
 *  - 每个唯一码(吊牌码)一条记录，记录它当前归属的 SKU、所在仓库、状态。
 *  - 这是「扫码出库校验」的权威数据源：出库时只查此表，而不是去翻采购单。
 *  - status 状态机：in_stock(在库) → out(已出库,尚未核销) / sold(已售核销) → returned(退回在库)。
 *  - 通过采购入库(registerInbound)写入；通过出库/零售扫码(scanOutbound)变更状态。
 *
 * 与 hangtag_print_item 的区别：
 *  hangtag_print_item 只是「打印时分配了哪些码」的日志；
 *  unique_code_stock 是「这些码现在真实的库存归属」，二者通过唯一码字符串关联。
 */
export const uniqueCodeStock = pgTable("unique_code_stock", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 完整唯一码字符串（含长度补零/可选前缀），全局唯一 */
  uniqueCode: varchar("unique_code", { length: 64 }).notNull().unique(),
  /** 唯一码的数值部分（用于区间/排序/续增校验），带前缀时可为 null */
  numericValue: bigint("numeric_value", { mode: "number" }),
  /** 绑定的 SKU（解析款色码后落定） */
  skuId: uuid("sku_id").notNull(),
  styleNo: varchar("style_no", { length: 50 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  size: varchar("size", { length: 50 }).notNull(),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  /** 当前所在仓库（校验「是否本仓」的权威字段） */
  warehouseId: uuid("warehouse_id").notNull(),
  /**
   * 状态机：
   *  in_stock = 在库可用；out = 已出库未核销；sold = 已售核销；returned = 退回在库。
   */
  status: varchar("status", { length: 20 }).notNull().default("in_stock"),
  /** 入库来源单据类型（如 purchase_inbound） */
  inboundDocType: varchar("inbound_doc_type", { length: 40 }),
  inboundDocId: varchar("inbound_doc_id", { length: 64 }),
  inboundAt: customTimestamptz("inbound_at", { precision: 3 }),
  /** 出库/核销来源单据类型（如 sales_outbound / retail） */
  outboundDocType: varchar("outbound_doc_type", { length: 40 }),
  outboundDocId: varchar("outbound_doc_id", { length: 64 }),
  outboundAt: customTimestamptz("outbound_at", { precision: 3 }),
  remark: text("remark"),
  // System fields
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_ucs_status_wh").on(table.status, table.warehouseId),
  index("idx_ucs_sku").on(table.skuId),
  foreignKey({
    columns: [table.skuId],
    foreignColumns: [sku.id],
    name: "unique_code_stock_sku_id_fkey",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "unique_code_stock_warehouse_id_fkey",
  }).onDelete("set null"),
]);

/**
 * 单据唯一码子表（聚合明细的「件级」展开）。
 *
 * 设计要点：
 *  - 不采用「双明细」方案（正常明细 + 唯一码明细），而是「聚合明细 1 份 + 本子表一对多」，
 *    保证「唯一码条数 = 该行 quantity」在结构上不可能漂移。
 *  - 一笔单据(如销售出库/零售)扫码 N 个唯一码，则本表增加 N 行，scan_type=outbound。
 *  - 采购入库扫码登记时 scan_type=inbound，同时写入 unique_code_stock。
 *  - 同一单据 + 同一唯一码 唯一，实现「已扫去重」。
 */
export const docUniqueCode = pgTable("doc_unique_code", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 单据类型：purchase_inbound | sales_outbound | retail | sales_return | transfer | stocktake */
  docType: varchar("doc_type", { length: 40 }).notNull(),
  docId: varchar("doc_id", { length: 64 }).notNull(),
  /** 关联单据明细 id（可选） */
  docItemId: varchar("doc_item_id", { length: 64 }),
  uniqueCode: varchar("unique_code", { length: 64 }).notNull(),
  skuId: uuid("sku_id"),
  styleNo: varchar("style_no", { length: 50 }),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  /** 扫码时操作的仓库（用于本仓校验） */
  warehouseId: uuid("warehouse_id"),
  /**
   * 扫码动作：inbound = 入库登记；outbound = 出库；sold = 结算核销；returned = 退货回库。
   * 同一单据的同一唯一码可有多条不同动作（outbound → sold → returned），构成件级生命周期流水。
   */
  scanType: varchar("scan_type", { length: 20 }).notNull(),
  /**
   * 操作人（扫码/登记执行者）。用于溯源追责与取证；历史流水无此字段时为 null。
   * 由调用方（单据服务/前端）传入，引擎不做强制。
   */
  operatorId: varchar("operator_id", { length: 64 }),
  scanAt: customTimestamptz("scan_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System fields
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  // 唯一性含 scan_type：同一单据同一唯一码可记录多个生命周期动作(outbound/sold/returned)，
  // 但同一动作不可重复（用于"本单已扫过"去重与幂等）
  uniqueIndex("uniq_doc_uc").on(table.docType, table.docId, table.uniqueCode, table.scanType),
  index("idx_doc_uc_code").on(table.uniqueCode),
  index("idx_doc_uc_code_time").on(table.uniqueCode, table.scanAt),
  index("idx_doc_uc_doc").on(table.docType, table.docId),
  // 跨区间批量溯源加速：按 SKU × 时间 过滤高频
  index("idx_doc_uc_sku_time").on(table.skuId, table.scanAt),
]);

/**
 * 单据唯一码流水【归档/冷数据】表。
 *
 * 设计目的（P2 留存/归档策略）：热表 doc_unique_code 只保留近期活跃流水，
 * 超过留存期的历史事件通过 archiveOldEvents 搬移到本表，实现冷热分离：
 *  - 查询层（getTrace / getTraceBySku / getTraceByRange）同时读取热表 + 本表，
 *    保证溯源完整性不受归档影响；
 *  - 本表与主表列完全一致（额外 archived_at 记录搬移时间），便于回查与回灌。
 *  - 不建立唯一索引（归档后不再承担"本单去重/幂等"职责），仅建查询索引。
 */
export const docUniqueCodeArchive = pgTable("doc_unique_code_archive", {
  id: uuid("id").primaryKey().defaultRandom(),
  docType: varchar("doc_type", { length: 40 }).notNull(),
  docId: varchar("doc_id", { length: 64 }).notNull(),
  docItemId: varchar("doc_item_id", { length: 64 }),
  uniqueCode: varchar("unique_code", { length: 64 }).notNull(),
  skuId: uuid("sku_id"),
  styleNo: varchar("style_no", { length: 50 }),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  warehouseId: uuid("warehouse_id"),
  scanType: varchar("scan_type", { length: 20 }).notNull(),
  operatorId: varchar("operator_id", { length: 64 }),
  scanAt: customTimestamptz("scan_at", { precision: 3 }).notNull(),
  /** 搬移至归档表的時間；用于留存治理与回灌追溯 */
  archivedAt: customTimestamptz("archived_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System fields
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_duca_code").on(table.uniqueCode),
  index("idx_duca_code_time").on(table.uniqueCode, table.scanAt),
  index("idx_duca_sku_time").on(table.skuId, table.scanAt),
  index("idx_duca_doc").on(table.docType, table.docId),
]);

/* =========================================================================
 * POS 上行接收「落地区」(landing zone)
 * 云裁POS 通过 ERP 接收端推送的 5 类单据（销售/退货/盘点/要货/日结）中，
 * 退货/要货/日结在 ERP 既有分销域无对应解耦表，故在此建立独立的 POS 落地表，
 * 与 wholesale 域（sales_return/outbound 等强外键表）隔离，避免污染主数据。
 * 销售→ retail_order、盘点→ inventory_stocktake 复用既有 ERP 表。
 * 创建脚本见 migrations/0014_pos_receiver.sql（幂等）。
 * ========================================================================= */

/** 门店编码映射：POS 侧 storeCode ↔ ERP store.id（含 warehouseId 解析链在 store 表） */
export const posStoreMap = pgTable("pos_store_map", {
  storeCode: varchar("store_code", { length: 50 }).primaryKey(),
  storeId: uuid("store_id").notNull(),
  storeName: varchar("store_name", { length: 200 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_pos_store_map_store_id").on(table.storeId),
]);

/** 上行幂等日志：(biz_type, pos_doc_no) 唯一，保证 POS 重试不产生重复 ERP 单据 */
export const posReceiveLog = pgTable("pos_receive_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  bizType: varchar("biz_type", { length: 20 }).notNull(),
  posDocNo: varchar("pos_doc_no", { length: 50 }).notNull(),
  erpNo: varchar("erp_no", { length: 50 }),
  status: varchar("status", { length: 20 }).notNull().default('success'),
  payload: jsonb("payload"),
  errorMessage: text("error_message"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pos_receive_log_uniq").on(table.bizType, table.posDocNo),
  index("idx_pos_receive_log_erp_no").on(table.erpNo),
  index("idx_pos_receive_log_status").on(table.status),
]);

/** POS 零售退货（解耦于 wholesale sales_return） */
export const posReturn = pgTable("pos_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  posOrderNo: varchar("pos_order_no", { length: 50 }),
  storeCode: varchar("store_code", { length: 50 }).notNull(),
  storeId: uuid("store_id"),
  storeName: varchar("store_name", { length: 200 }),
  returnDate: date("return_date").notNull(),
  totalAmount: numeric("total_amount").notNull().default('0'),
  reason: varchar("reason", { length: 200 }),
  status: varchar("status", { length: 20 }).notNull().default('received'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pos_return_return_no_key").on(table.returnNo),
  index("idx_pos_return_store").on(table.storeCode, table.returnDate),
]);

export const posReturnItem = pgTable("pos_return_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  quantity: numeric("quantity").notNull().default('0'),
  price: numeric("price").notNull().default('0'),
  amount: numeric("amount").notNull().default('0'),
  batchNo: varchar("batch_no", { length: 50 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [posReturn.id],
    name: "pos_return_item_return_id_fkey",
  }).onDelete("cascade"),
  index("idx_pos_return_item_ret").on(table.returnId),
]);

/** POS 门店要货申请（解耦于订货会 allocation_order） */
export const posRequisition = pgTable("pos_requisition", {
  id: uuid("id").primaryKey().defaultRandom(),
  reqNo: varchar("req_no", { length: 50 }).notNull().unique(),
  storeCode: varchar("store_code", { length: 50 }).notNull(),
  storeId: uuid("store_id"),
  storeName: varchar("store_name", { length: 200 }),
  reqDate: date("req_date").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('submitted'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pos_requisition_req_no_key").on(table.reqNo),
  index("idx_pos_requisition_store").on(table.storeCode, table.reqDate),
]);

export const posRequisitionItem = pgTable("pos_requisition_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id").notNull(),
  skuCode: varchar("sku_code", { length: 100 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }),
  color: varchar("color", { length: 50 }),
  size: varchar("size", { length: 50 }),
  colorId: uuid("color_id").references(() => color.id, { onDelete: 'set null' }),
  sizeId: uuid("size_id").references(() => size.id, { onDelete: 'set null' }),
  qty: numeric("qty").notNull().default('0'),
  remark: varchar("remark", { length: 200 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.requisitionId],
    foreignColumns: [posRequisition.id],
    name: "pos_requisition_item_requisition_id_fkey",
  }).onDelete("cascade"),
  index("idx_pos_requisition_item_req").on(table.requisitionId),
]);

/** POS 门店日结（解耦于 ERP 既有 pos_session 班次） */
export const posDailySettle = pgTable("pos_daily_settle", {
  id: uuid("id").primaryKey().defaultRandom(),
  settleNo: varchar("settle_no", { length: 50 }).notNull().unique(),
  storeCode: varchar("store_code", { length: 50 }).notNull(),
  storeId: uuid("store_id"),
  storeName: varchar("store_name", { length: 200 }),
  settleDate: date("settle_date").notNull(),
  sessionId: varchar("session_id", { length: 50 }),
  cashierName: varchar("cashier_name", { length: 50 }),
  cashAmount: numeric("cash_amount").notNull().default('0'),
  cardAmount: numeric("card_amount").notNull().default('0'),
  wechatAmount: numeric("wechat_amount").notNull().default('0'),
  alipayAmount: numeric("alipay_amount").notNull().default('0'),
  otherAmount: numeric("other_amount").notNull().default('0'),
  totalAmount: numeric("total_amount").notNull().default('0'),
  depositAmount: numeric("deposit_amount").notNull().default('0'),
  diffAmount: numeric("diff_amount").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('settled'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pos_daily_settle_settle_no_key").on(table.settleNo),
  index("idx_pos_daily_settle_store").on(table.storeCode, table.settleDate),
]);

/* =========================================================================
 * P0-c 主数据治理：颜色主数据（含 hex）
 * ERP 原有 color_group.colors 为 {name,value}[] jsonb，缺乏标准 hex 与统一编码；
 * POS 端已建立 posColor(id,name,hex) 主数据，ERP 此处补齐对等的 color 主数据，
 * 作为两系统颜色对齐的权威源（下行同步至 POS posColor）。
 * 创建脚本见 migrations/0015_p0c_masterdata.sql（幂等）。
 * ========================================================================= */

/** 颜色主数据：标准编码 + 名称 + hex（与 POS posColor 对齐，供两系统配色一致） */
export const color = pgTable("color", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  hex: varchar("hex", { length: 20 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("color_code_key").on(table.code),
  index("idx_color_status").on(table.status),
]);

// ---------------------------------------------------------------------------
// 尺码主数据（基础档案-商品资料拆分：尺码独立实体，对应 size 表）
// ---------------------------------------------------------------------------
export const size = pgTable("size", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("size_code_key").on(table.code),
  index("idx_size_status").on(table.status),
]);

// ---------------------------------------------------------------------------
// 尺码组与尺码关系（基础档案-商品资料拆分：尺码组与尺码关系，对应 size_group_size 关联表）
// ---------------------------------------------------------------------------
export const sizeGroupSize = pgTable("size_group_size", {
  sizeGroupId: uuid("size_group_id").notNull().references(() => sizeGroup.id, { onDelete: 'cascade' }),
  sizeId: uuid("size_id").notNull().references(() => size.id, { onDelete: 'cascade' }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.sizeGroupId, table.sizeId] }),
  index("idx_size_group_size_size").on(table.sizeId),
]);

// ---------------------------------------------------------------------------
// 颜色组与颜色关系（P1-1：颜色组关系化，对齐已有的 size_group_size）
// 组关系（哪些颜色属于某颜色组）以关联表为单一真相；color_group.colors jsonb 作为派生镜像。
// ---------------------------------------------------------------------------
export const colorGroupColor = pgTable("color_group_color", {
  colorGroupId: uuid("color_group_id").notNull().references(() => colorGroup.id, { onDelete: 'cascade' }),
  colorId: uuid("color_id").notNull().references(() => color.id, { onDelete: 'cascade' }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.colorGroupId, table.colorId] }),
  index("idx_color_group_color_color").on(table.colorId),
]);

// ---------------------------------------------------------------------------
// 主数据一致性校验日志（P2-3）
// 每次 run 落一行/检查，供 latest / history 审计与跨运行指纹漂移比对。
// ---------------------------------------------------------------------------
export const consistencyCheckLog = pgTable(
  "consistency_check_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 系统字段：运行 ID（同一次运行的所有检查共享）
    runId: text("run_id").notNull(),
    // 系统字段：运行时间
    runAt: customTimestamptz("_run_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    domain: text("domain").notNull(),
    checkKey: text("check_key").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull(),
    sourceCount: integer("source_count").notNull().default(0),
    dependentCount: integer("dependent_count").notNull().default(0),
    mismatchCount: integer("mismatch_count").notNull().default(0),
    samples: jsonb("samples").notNull().default(sql`'[]'::jsonb`),
    sourceHash: text("source_hash"),
    consumerHash: text("consumer_hash"),
    detail: text("detail"),
  },
  (table) => ({
    runIdx: index("idx_consistency_log_run").on(table.runId),
    domainIdx: index("idx_consistency_log_domain").on(table.domain),
    statusIdx: index("idx_consistency_log_status").on(table.status),
  }),
);
export const consistencyCheckLogTable = consistencyCheckLog;

/* ============ Wave 2-1 纯 PG 事件总线：domain_event 发件箱表 ============
 * 与迁移 0037_domain_event_outbox.sql 三处同步（schema.ts ↔ 迁移 ↔ erp_test 重克隆）。
 * status: pending → processing → dispatched（失败达上限转 failed 死信）。
 */
export const domainEvent = pgTable(
  "domain_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: varchar("aggregate_type", { length: 40 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    processingSince: customTimestamptz("processing_since", { precision: 3 }),
    createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
    dispatchedAt: customTimestamptz("dispatched_at", { precision: 3 }),
  },
  (table) => [
    index("idx_domain_event_status_created").on(table.status, table.createdAt),
    index("idx_domain_event_agg").on(table.aggregateType, table.aggregateId),
    index("idx_domain_event_type").on(table.eventType),
  ],
);

/* ============ 商品资料批量导入任务（款号 / SKU） ============
 * 与迁移 0041_product_import_task.sql 三处同步（schema.ts ↔ 迁移 ↔ erp_test 重克隆）。
 *
 * 业务规则（用户确认）：
 *   1) 导入任务记录每次上传的 Excel 原文件（file_url）+ 解析后的全量数据内容（rows）。
 *   2) 状态机：draft（草稿，可反复重导覆盖）→ approved（审核通过，已批量写入商品库）；
 *      重导时把同 type 的旧 draft 置为 superseded，实现「后一次导入覆盖前一次」。
 *   3) summary / rows 均为 jsonb：summary 承载 { total, ok, existed, unsupported,
 *      missingMasterData, inserted, skipped }；rows 承载逐行 { rowIndex, raw, status,
 *      reason }，status ∈ { ok | existed | unsupported | missing_master }。
 *   4) 审核写入商品库时「仅新增、跳过已存在」：款号调 StyleService.bulkImportStyle，
 *      SKU 调 SkuService.bulkImport，二者均按唯一键跳过已存在记录。
 */
export const productImportTask = pgTable(
  "product_import_task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 导入类型：'style' = 款号批量导入；'sku' = SKU 批量导入
    importType: varchar("import_type", { length: 16 }).notNull(),
    // 状态：'draft' 草稿 / 'approved' 已审核入库 / 'superseded' 被后续重导覆盖
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    // 上传的 Excel 原文件信息（留档）
    fileName: varchar("file_name", { length: 255 }),
    fileUrl: text("file_url"),
    filePath: text("file_path"),
    bucketId: varchar("bucket_id", { length: 100 }),
    // 解析出的有效数据行数
    totalRows: integer("total_rows").notNull().default(0),
    // 校验汇总：{ total, ok, existed, unsupported, missingMasterData, inserted, skipped }
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    // 逐行明细：[{ rowIndex, raw, status, reason }]
    rows: jsonb("rows").notNull().default(sql`'[]'::jsonb`),
    // System field: Creation time (auto-filled, do not modify)
    createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
    // System field: Creator（导入人，业务写入 RequestContext.getUserId()）
    createdBy: userProfile("_created_by"),
    // System field: Update time (auto-filled, do not modify)
    updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
    // System field: Updater (auto-filled, do not modify)
    updatedBy: userProfile("_updated_by"),
  },
  (table) => [
    index("idx_product_import_type_status").on(table.importType, table.status),
    index("idx_product_import_created").on(table.createdAt),
  ],
);
export const productImportTaskTable = productImportTask;
export const domainEventTable = domainEvent;
