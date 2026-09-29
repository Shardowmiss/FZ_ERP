/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, bigint, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

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

export const posOfflineQueue = pgTable("pos_offline_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  clientId: varchar("client_id", { length: 100 }).notNull().unique(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  /**
   * @type { order?: any; return?: any; member?: any; stockAdjust?: any; stocktake?: any; transferRequest?: any; suspendedOrder?: any }
   */
  entityData: jsonb("entity_data").notNull(),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
  retryCount: integer("retry_count").notNull().default(0),
  errorMessage: text("error_message"),
  /** P1-6：原为 uuid，但库存调整离线同步回写的是 adjustNo（如 `ADJ-<clientId>`），
   * 非 uuid → 写入 uuid 列直接失败、该类型离线单永远同步不上。放宽到 varchar(64)
   * 以同时容纳 uuid 主键（订单/退货/会员/挂单）与 adjustNo 单据号。 */
  serverEntityId: varchar("server_entity_id", { length: 64 }),
  syncedAt: customTimestamptz("synced_at", { precision: 3 }),
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
  uniqueIndex("pos_offline_queue_client_id_key").on(table.clientId),
  index("idx_offline_queue_store").on(table.storeId),
  index("idx_offline_queue_status").on(table.syncStatus),
  index("idx_offline_queue_entity").on(table.entityType),
]);

export const posStore = pgTable("pos_store", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  address: varchar("address", { length: 500 }),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  phone: varchar("phone", { length: 50 }),
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
  uniqueIndex("pos_store_code_key").on(table.code),
]);

export const posOperationLog = pgTable("pos_operation_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: varchar("store_id", { length: 50 }),
  employeeId: uuid("employee_id"),
  module: varchar("module", { length: 50 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  targetNo: varchar("target_no", { length: 100 }),
  content: text("content"),
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
  index("idx_pos_oplog_time").on(table.createdAt),
]);

export const posPreorderItem = pgTable("pos_preorder_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  preorderId: uuid("preorder_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  styleName: varchar("style_name", { length: 200 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  qty: integer("qty").notNull(),
  price: bigint("price", { mode: 'number' }).notNull(),
  fromLocation: varchar("from_location", { length: 100 }),
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
  index("idx_pos_preorder_item_pid").on(table.preorderId),
  foreignKey({
    columns: [table.preorderId],
    foreignColumns: [posPreorder.id],
    name: "pos_preorder_item_preorder_id_fkey",
  }).onDelete("cascade"),
]);

export const posPreorder = pgTable("pos_preorder", {
  id: uuid("id").primaryKey().defaultRandom(),
  preorderNo: varchar("preorder_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  memberId: uuid("member_id"),
  employeeId: uuid("employee_id"),
  totalQty: integer("total_qty").notNull().default(0),
  totalAmount: bigint("total_amount", { mode: 'number' }).notNull().default(0),
  deliveryType: varchar("delivery_type", { length: 20 }).notNull().default('mail'),
  address: text("address"),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  syncedToErp: boolean("synced_to_erp").notNull().default(false),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
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
  uniqueIndex("pos_preorder_preorder_no_key").on(table.preorderNo),
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [posEmployee.id],
    name: "pos_preorder_employee_id_fkey",
  }),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [posMember.id],
    name: "pos_preorder_member_id_fkey",
  }),
]);

export const posSyncLog = pgTable("pos_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  direction: varchar("direction", { length: 10 }).notNull(),
  dataType: varchar("data_type", { length: 50 }).notNull(),
  docNo: varchar("doc_no", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull(),
  response: text("response"),
  // P1-1c：上行重试需完整单据 payload 才能重建请求（仅存 docNo 无法重发），
  // 故在同步日志中暂存原始报文。nullable，加列无损。
  payload: jsonb("payload"),
  retryCount: integer("retry_count").notNull().default(0),
  durationMs: integer("duration_ms"),
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
  index("idx_pos_sync_log_time").on(table.createdAt),
  index("idx_pos_sync_log_status").on(table.status),
]);

export const posOmnichannelItem = pgTable("pos_omnichannel_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  styleName: varchar("style_name", { length: 200 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  qty: integer("qty").notNull(),
  price: bigint("price", { mode: 'number' }).notNull(),
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
  index("idx_pos_omni_item_order").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [posOmnichannelOrder.id],
    name: "pos_omnichannel_item_order_id_fkey",
  }).onDelete("cascade"),
]);

export const posOmnichannelOrder = pgTable("pos_omnichannel_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  channel: varchar("channel", { length: 30 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  memberName: varchar("member_name", { length: 100 }),
  memberPhone: varchar("member_phone", { length: 20 }),
  totalAmount: bigint("total_amount", { mode: 'number' }).notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  address: text("address"),
  pickupCode: varchar("pickup_code", { length: 20 }),
  pickedAt: customTimestamptz("picked_at", { precision: 3 }),
  shippedAt: customTimestamptz("shipped_at", { precision: 3 }),
  sourceNo: varchar("source_no", { length: 50 }),
  // P1-2：财务闭环——门店履约后生成的 pos_sale_order 单号（幂等标记 + 全渠道订单↔销售单可追溯）
  saleOrderNo: varchar("sale_order_no", { length: 50 }),
  fulfilledAt: customTimestamptz("fulfilled_at", { precision: 3 }),
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
  uniqueIndex("pos_omnichannel_order_order_no_key").on(table.orderNo),
  index("idx_pos_omni_store").on(table.storeId),
  index("idx_pos_omni_status").on(table.status),
  index("idx_pos_omni_sale").on(table.saleOrderNo),
]);

export const posEodPayment = pgTable("pos_eod_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  eodId: uuid("eod_id").notNull(),
  payMethod: varchar("pay_method", { length: 20 }).notNull(),
  saleAmount: bigint("sale_amount", { mode: 'number' }).notNull().default(0),
  refundAmount: bigint("refund_amount", { mode: 'number' }).notNull().default(0),
  netAmount: bigint("net_amount", { mode: 'number' }).notNull().default(0),
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
  index("idx_pos_eod_pay_eod").on(table.eodId),
  foreignKey({
    columns: [table.eodId],
    foreignColumns: [posEod.id],
    name: "pos_eod_payment_eod_id_fkey",
  }).onDelete("cascade"),
]);

export const posEod = pgTable("pos_eod", {
  id: uuid("id").primaryKey().defaultRandom(),
  eodNo: varchar("eod_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  eodDate: date("eod_date").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  totalSales: bigint("total_sales", { mode: 'number' }).notNull().default(0),
  totalRefund: bigint("total_refund", { mode: 'number' }).notNull().default(0),
  totalDiscount: bigint("total_discount", { mode: 'number' }).notNull().default(0),
  netSales: bigint("net_sales", { mode: 'number' }).notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  itemCount: integer("item_count").notNull().default(0),
  customerCount: integer("customer_count").notNull().default(0),
  avgTicket: bigint("avg_ticket", { mode: 'number' }).notNull().default(0),
  attachRate: numeric("attach_rate").notNull().default('0'),
  memberSaleRatio: numeric("member_sale_ratio").notNull().default('0'),
  closedAt: customTimestamptz("closed_at", { precision: 3 }),
  syncedToErp: boolean("synced_to_erp").notNull().default(false),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
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
  uniqueIndex("pos_eod_eod_no_key").on(table.eodNo),
  index("idx_pos_eod_store").on(table.storeId),
  uniqueIndex("idx_pos_eod_date").on(table.storeId, table.eodDate),
]);

export const posShift = pgTable("pos_shift", {
  id: uuid("id").primaryKey().defaultRandom(),
  shiftNo: varchar("shift_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  cashierId: uuid("cashier_id"),
  startTime: customTimestamptz("start_time", { precision: 3 }).notNull(),
  endTime: customTimestamptz("end_time", { precision: 3 }),
  openingCash: bigint("opening_cash", { mode: 'number' }).notNull().default(0),
  closingCash: bigint("closing_cash", { mode: 'number' }),
  status: varchar("status", { length: 20 }).notNull().default('open'),
  saleCount: integer("sale_count").notNull().default(0),
  saleAmount: bigint("sale_amount", { mode: 'number' }).notNull().default(0),
  refundAmount: bigint("refund_amount", { mode: 'number' }).notNull().default(0),
  cashExpected: bigint("cash_expected", { mode: 'number' }),
  cashActual: bigint("cash_actual", { mode: 'number' }),
  cashDiff: bigint("cash_diff", { mode: 'number' }),
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
  uniqueIndex("pos_shift_shift_no_key").on(table.shiftNo),
  index("idx_pos_shift_store").on(table.storeId),
  index("idx_pos_shift_status").on(table.status),
  foreignKey({
    columns: [table.cashierId],
    foreignColumns: [posEmployee.id],
    name: "pos_shift_cashier_id_fkey",
  }),
]);

export const posStockAdjust = pgTable("pos_stock_adjust", {
  id: uuid("id").primaryKey().defaultRandom(),
  adjustNo: varchar("adjust_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  reason: varchar("reason", { length: 500 }),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  employeeId: uuid("employee_id"),
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
  uniqueIndex("pos_stock_adjust_adjust_no_key").on(table.adjustNo),
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [posEmployee.id],
    name: "pos_stock_adjust_employee_id_fkey",
  }),
]);

/**
 * P1-4 引用完整性：库存调整明细子表。
 * 历史实现中 `pos_stock_adjust` 仅有整单（无明细行），`adjustStock` 消费 `dto.items`
 * 改完库存后直接丢弃明细，导致无法追溯「调整了哪些 SKU、各调多少」。
 * 此处补齐与盘点/要货一致的明细子表，并级联删除（主单删则明细一并删）。
 */
export const posStockAdjustItem = pgTable("pos_stock_adjust_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  adjustId: uuid("adjust_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  // 录入的调整量（正数）。增减/盘点语义由主单 type 决定：
  // increase 表示 +qty，decrease 表示 -qty，check 表示置为 qty。
  qty: integer("qty").notNull(),
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
  index("idx_pos_stock_adj_item_adjust_id").on(table.adjustId),
  foreignKey({
    columns: [table.adjustId],
    foreignColumns: [posStockAdjust.id],
    name: "pos_stock_adjust_item_adjust_id_fkey",
  }).onDelete("cascade"),
]);

export const posStocktakeItem = pgTable("pos_stocktake_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  stocktakeId: uuid("stocktake_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  bookQty: integer("book_qty").notNull().default(0),
  actualQty: integer("actual_qty").notNull().default(0),
  diffQty: integer("diff_qty").notNull().default(0),
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
  index("idx_pos_st_item_stid").on(table.stocktakeId),
  foreignKey({
    columns: [table.stocktakeId],
    foreignColumns: [posStocktake.id],
    name: "pos_stocktake_item_stocktake_id_fkey",
  }).onDelete("cascade"),
]);

export const posStocktake = pgTable("pos_stocktake", {
  id: uuid("id").primaryKey().defaultRandom(),
  stocktakeNo: varchar("stocktake_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  type: varchar("type", { length: 20 }).notNull().default('full'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  totalQty: integer("total_qty").notNull().default(0),
  diffQty: integer("diff_qty").notNull().default(0),
  employeeId: uuid("employee_id"),
  auditedAt: customTimestamptz("audited_at", { precision: 3 }),
  syncedToErp: boolean("synced_to_erp").notNull().default(false),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
  syncAt: customTimestamptz("sync_at", { precision: 3 }),
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
  uniqueIndex("pos_stocktake_stocktake_no_key").on(table.stocktakeNo),
  index("idx_pos_stocktake_store").on(table.storeId),
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [posEmployee.id],
    name: "pos_stocktake_employee_id_fkey",
  }),
]);

export const posTransferRequestItem = pgTable("pos_transfer_request_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  reqId: uuid("req_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  reqQty: integer("req_qty").notNull(),
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
  index("idx_pos_treq_item_rid").on(table.reqId),
  foreignKey({
    columns: [table.reqId],
    foreignColumns: [posTransferRequest.id],
    name: "pos_transfer_request_item_req_id_fkey",
  }).onDelete("cascade"),
]);

export const posTransferRequest = pgTable("pos_transfer_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  reqNo: varchar("req_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  employeeId: uuid("employee_id"),
  totalQty: integer("total_qty").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('submitted'),
  remark: varchar("remark", { length: 500 }),
  syncedToErp: boolean("synced_to_erp").notNull().default(false),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
  syncAt: customTimestamptz("sync_at", { precision: 3 }),
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
  uniqueIndex("pos_transfer_request_req_no_key").on(table.reqNo),
  index("idx_pos_treq_store").on(table.storeId),
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [posEmployee.id],
    name: "pos_transfer_request_employee_id_fkey",
  }),
]);

export const posTransferItem = pgTable("pos_transfer_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferId: uuid("transfer_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  plannedQty: integer("planned_qty").notNull(),
  receivedQty: integer("received_qty").notNull().default(0),
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
  index("idx_pos_transfer_item_tid").on(table.transferId),
  foreignKey({
    columns: [table.transferId],
    foreignColumns: [posTransfer.id],
    name: "pos_transfer_item_transfer_id_fkey",
  }).onDelete("cascade"),
]);

export const posTransfer = pgTable("pos_transfer", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferNo: varchar("transfer_no", { length: 50 }).notNull().unique(),
  type: varchar("type", { length: 20 }).notNull().default('in'),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  fromLocation: varchar("from_location", { length: 100 }),
  toLocation: varchar("to_location", { length: 100 }),
  totalQty: integer("total_qty").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  source: varchar("source", { length: 20 }).notNull().default('erp'),
  erpNo: varchar("erp_no", { length: 50 }),
  receivedAt: customTimestamptz("received_at", { precision: 3 }),
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
  uniqueIndex("pos_transfer_transfer_no_key").on(table.transferNo),
  index("idx_pos_transfer_store").on(table.storeId),
  index("idx_pos_transfer_status").on(table.status),
]);

export const posSuspendedOrder = pgTable("pos_suspended_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  memberId: uuid("member_id"),
  employeeId: uuid("employee_id"),
  /**
   * @type { skuId: string; styleId: string; styleName: string; colorId: string; sizeId: string; qty: number; tagPrice: number; unitPrice: number; lineAmount: number }[]
   */
  items: jsonb("items").notNull(),
  totalAmount: bigint("total_amount", { mode: 'number' }).notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // P1-3：挂单 clientId 唯一，保证离线重试幂等（DB 层兜底，与应用层 pre-check 双保险）
  clientId: varchar("client_id", { length: 100 }).unique(),
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
  // P1-6：挂单列表热路径 —— getSuspendedList 按 (store_id, status='active') 过滤并按
  // _created_at 倒序，此为唯一可用索引，此前为全表扫。
  index("idx_pos_suspended_store_status").on(table.storeId, table.status, table.createdAt),
]);

export const posReturnItem = pgTable("pos_return_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull(),
  originalItemId: uuid("original_item_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  styleName: varchar("style_name", { length: 200 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  qty: integer("qty").notNull(),
  refundPrice: bigint("refund_price", { mode: 'number' }).notNull(),
  lineAmount: bigint("line_amount", { mode: 'number' }).notNull(),
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
  index("idx_pos_return_item_return").on(table.returnId),
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [posReturnOrder.id],
    name: "pos_return_item_return_id_fkey",
  }).onDelete("cascade"),
]);

export const posReturnOrder = pgTable("pos_return_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  originalOrderNo: varchar("original_order_no", { length: 50 }).notNull(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  memberId: uuid("member_id"),
  employeeId: uuid("employee_id"),
  totalQty: integer("total_qty").notNull().default(0),
  refundAmount: bigint("refund_amount", { mode: 'number' }).notNull().default(0),
  refundMethod: varchar("refund_method", { length: 20 }).notNull().default('original'),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  shiftId: uuid("shift_id"),
  remark: varchar("remark", { length: 500 }),
  syncedToErp: boolean("synced_to_erp").notNull().default(false),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
  syncAt: customTimestamptz("sync_at", { precision: 3 }),
  clientId: varchar("client_id", { length: 100 }).unique(),
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
  uniqueIndex("pos_return_order_return_no_key").on(table.returnNo),
  index("idx_pos_return_store").on(table.storeId),
  index("idx_pos_return_original").on(table.originalOrderNo),
  uniqueIndex("idx_return_order_client").on(table.clientId),
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [posEmployee.id],
    name: "pos_return_order_employee_id_fkey",
  }),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [posMember.id],
    name: "pos_return_order_member_id_fkey",
  }),
]);

export const posSalePayment = pgTable("pos_sale_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  payMethod: varchar("pay_method", { length: 20 }).notNull(),
  amount: bigint("amount", { mode: 'number' }).notNull(),
  changeAmount: bigint("change_amount", { mode: 'number' }).notNull().default(0),
  transactionId: varchar("transaction_id", { length: 100 }),
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
  index("idx_pos_sale_pay_order").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [posSaleOrder.id],
    name: "pos_sale_payment_order_id_fkey",
  }).onDelete("cascade"),
]);

export const posSaleDiscount = pgTable("pos_sale_discount", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  promotionId: uuid("promotion_id"),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 30 }).notNull(),
  amount: bigint("amount", { mode: 'number' }).notNull(),
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
  index("idx_pos_sale_disc_order").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [posSaleOrder.id],
    name: "pos_sale_discount_order_id_fkey",
  }).onDelete("cascade"),
]);

export const posSaleItem = pgTable("pos_sale_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  styleName: varchar("style_name", { length: 200 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  qty: integer("qty").notNull(),
  tagPrice: bigint("tag_price", { mode: 'number' }).notNull(),
  unitPrice: bigint("unit_price", { mode: 'number' }).notNull(),
  discountAmount: bigint("discount_amount", { mode: 'number' }).notNull().default(0),
  lineAmount: bigint("line_amount", { mode: 'number' }).notNull(),
  refundedQty: integer("refunded_qty").notNull().default(0),
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
  index("idx_pos_sale_item_order").on(table.orderId),
  index("idx_pos_sale_item_sku").on(table.skuId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [posSaleOrder.id],
    name: "pos_sale_item_order_id_fkey",
  }).onDelete("cascade"),
]);

export const posSaleOrder = pgTable("pos_sale_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  memberId: uuid("member_id"),
  employeeId: uuid("employee_id"),
  /**
   * 业务成交日期（YYYY-MM-DD）。
   *
   * 离线优先场景下这是**唯一可信的成交时间**：订单可能在断网几天后才上行同步，
   * 若以 `createdAt`/同步时刻代替成交日，ERP 侧零售单日期会被写成"同步当天"，
   * 直接污染按时间窗聚合的报表（见 Wave 3 的 P1-c④）。
   *
   * 用 `mode:'string'` 而非默认的 Date：业务日期是日历概念，
   * 走 JS Date 会引入 UTC/时区漂移，反而制造新的日期错误。
   */
  saleDate: date("sale_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  totalQty: integer("total_qty").notNull().default(0),
  totalAmount: bigint("total_amount", { mode: 'number' }).notNull().default(0),
  discountAmount: bigint("discount_amount", { mode: 'number' }).notNull().default(0),
  payAmount: bigint("pay_amount", { mode: 'number' }).notNull().default(0),
  pointsUsed: integer("points_used").notNull().default(0),
  pointsEarned: integer("points_earned").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  channel: varchar("channel", { length: 20 }).notNull().default('store'),
  shiftId: uuid("shift_id"),
  remark: varchar("remark", { length: 500 }),
  syncedToErp: boolean("synced_to_erp").notNull().default(false),
  syncStatus: varchar("sync_status", { length: 20 }).notNull().default('pending'),
  syncAt: customTimestamptz("sync_at", { precision: 3 }),
  clientId: varchar("client_id", { length: 100 }).unique(),
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
  uniqueIndex("pos_sale_order_order_no_key").on(table.orderNo),
  index("idx_pos_sale_store").on(table.storeId),
  index("idx_pos_sale_member").on(table.memberId),
  index("idx_pos_sale_created").on(table.createdAt),
  index("idx_pos_sale_sync").on(table.syncStatus),
  uniqueIndex("idx_sale_order_client").on(table.clientId),
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [posEmployee.id],
    name: "pos_sale_order_employee_id_fkey",
  }),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [posMember.id],
    name: "pos_sale_order_member_id_fkey",
  }),
]);

export const posPromotion = pgTable("pos_promotion", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 30 }).notNull(),
  threshold: bigint("threshold", { mode: 'number' }),
  discountValue: bigint("discount_value", { mode: 'number' }),
  discountType: varchar("discount_type", { length: 20 }),
  applyScope: varchar("apply_scope", { length: 20 }).notNull().default('all'),
  scopeIds: varchar("scope_ids", { length: 50 }).array().default([]),
  validFrom: customTimestamptz("valid_from", { precision: 3 }),
  validTo: customTimestamptz("valid_to", { precision: 3 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  priority: integer("priority").notNull().default(0),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  isMemberOnly: boolean("is_member_only").notNull().default(false),
  source: varchar("source", { length: 20 }).notNull().default('erp'),
  erpSyncAt: customTimestamptz("erp_sync_at", { precision: 3 }),
  // Wave 4-C：ERP 促销主键（下行幂等键）。
  // 原表只有随机 uuid 作主键，重复同步必然产生重复行 —— 促销被反复同步后
  // 「同一活动在收银台出现两次、满减叠加两次」是最典型的资损路径。
  // ERP 侧稳定主键落地后，这里作为 ON CONFLICT target 保证幂等。
  // 本地新建的促销为 NULL（PostgreSQL 唯一索引允许多个 NULL，不冲突）。
  erpPromotionId: varchar("erp_promotion_id", { length: 40 }),
  // ERP 侧最后更新时间；同步时用于跳过无实质变更的行，也便于人工对账。
  erpUpdatedAt: customTimestamptz("erp_updated_at", { precision: 3 }),
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
  // P1-6：促销两条热路径 —— ①getActivePromotions 每次开单计价都调用，过滤
  // status='active' 并按 priority 倒序；②listPromotions 同样按 priority/_created_at 倒序。
}, (table) => [
  index("idx_pos_promotion_active_priority").on(table.status, table.priority, table.createdAt),
  index("idx_pos_promotion_validity").on(table.status, table.validFrom, table.validTo),
  // Wave 4-C：ERP 促销幂等键。唯一索引让「同一次同步重复执行」「上游重推」
  // 都收敛到 update 而非 insert，杜绝重复促销。
  // 平台侧 db-schema-sync 只建表不建索引，落库由 scripts/apply-pos-indexes.cjs 幂等补建
  // （该脚本会先查重再建，见 INDEXES 里 unique: true 那条）。
  uniqueIndex("uniq_pos_promotion_erp_id").on(table.erpPromotionId),
]);

export const posCoupon = pgTable("pos_coupon", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull(),
  couponCode: varchar("coupon_code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  discountValue: bigint("discount_value", { mode: 'number' }).notNull(),
  minAmount: bigint("min_amount", { mode: 'number' }).notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('available'),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  usedAt: customTimestamptz("used_at", { precision: 3 }),
  usedOrderNo: varchar("used_order_no", { length: 100 }),
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
  uniqueIndex("pos_coupon_coupon_code_key").on(table.couponCode),
  index("idx_pos_coupon_member").on(table.memberId),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [posMember.id],
    name: "pos_coupon_member_id_fkey",
  }),
]);

export const posStoredLog = pgTable("pos_stored_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull(),
  change: bigint("change", { mode: 'number' }).notNull(),
  balance: bigint("balance", { mode: 'number' }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  sourceNo: varchar("source_no", { length: 100 }),
  remark: varchar("remark", { length: 200 }),
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
  index("idx_pos_stored_member").on(table.memberId),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [posMember.id],
    name: "pos_stored_log_member_id_fkey",
  }),
]);

export const posPointsLog = pgTable("pos_points_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull(),
  change: integer("change").notNull(),
  balance: integer("balance").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  sourceNo: varchar("source_no", { length: 100 }),
  remark: varchar("remark", { length: 200 }),
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
  index("idx_pos_points_member").on(table.memberId),
  foreignKey({
    columns: [table.memberId],
    foreignColumns: [posMember.id],
    name: "pos_points_log_member_id_fkey",
  }),
]);

export const posMember = pgTable("pos_member", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberNo: varchar("member_no", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  gender: varchar("gender", { length: 10 }),
  birthday: date("birthday"),
  level: varchar("level", { length: 20 }).notNull().default('normal'),
  points: integer("points").notNull().default(0),
  storedValue: bigint("stored_value", { mode: 'number' }).notNull().default(0),
  preferSize: varchar("prefer_size", { length: 10 }),
  preferStyle: varchar("prefer_style", { length: 50 }),
  totalSpent: bigint("total_spent", { mode: 'number' }).notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  lastPurchaseAt: customTimestamptz("last_purchase_at", { precision: 3 }),
  erpSyncAt: customTimestamptz("erp_sync_at", { precision: 3 }),
  clientId: varchar("client_id", { length: 100 }).unique(),
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
  uniqueIndex("pos_member_member_no_key").on(table.memberNo),
  uniqueIndex("pos_member_phone_key").on(table.phone),
  index("idx_pos_member_phone").on(table.phone),
  uniqueIndex("idx_member_client").on(table.clientId),
]);

export const posEmployee = pgTable("pos_employee", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull(),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  code: varchar("code", { length: 50 }).notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().default('sales'),
  storeId: varchar("store_id", { length: 50 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // A-4：登录凭证（scrypt 派生，格式 `scrypt$<saltHex>$<hashHex>`）。
  // 为空表示该员工尚未开通登录，鉴权会拒绝其登录但不会泄露该字段。
  passwordHash: varchar("password_hash", { length: 200 }),
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
  uniqueIndex("pos_employee_code_key").on(table.code),
]);

export const posStock = pgTable("pos_stock", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: varchar("store_id", { length: 50 }).notNull(),
  skuId: varchar("sku_id", { length: 100 }).notNull(),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  qty: integer("qty").notNull().default(0),
  inTransitQty: integer("in_transit_qty").notNull().default(0),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
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
  uniqueIndex("pos_stock_store_id_sku_id_key").on(table.storeId, table.skuId),
  index("idx_pos_stock_store").on(table.storeId),
  index("idx_pos_stock_style").on(table.styleId),
  // P1-6：独立 sku_id 索引。此前只有复合 (store_id, sku_id) 唯一索引，按【单】sku 维度
  // 查询（库存查询/盘点/P-5 批量预取前的补充）无法用其 sku_id 列做引导，退化为全表扫。
  index("idx_pos_stock_sku").on(table.skuId),
]);

export const posSku = pgTable("pos_sku", {
  id: varchar("id", { length: 100 }).primaryKey(),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  styleId: varchar("style_id", { length: 50 }).notNull(),
  colorId: varchar("color_id", { length: 10 }).notNull(),
  sizeId: varchar("size_id", { length: 10 }).notNull(),
  barcode: varchar("barcode", { length: 100 }),
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
  index("idx_pos_sku_style").on(table.styleId),
  index("idx_pos_sku_barcode").on(table.barcode),
  foreignKey({
    columns: [table.styleId],
    foreignColumns: [posStyle.id],
    name: "pos_sku_style_id_fkey",
  }),
]);

export const posStyle = pgTable("pos_style", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  colorIds: varchar("color_ids", { length: 50 }).array().notNull().default([]),
  sizeIds: varchar("size_ids", { length: 50 }).array().notNull().default([]),
  tagPrice: bigint("tag_price", { mode: 'number' }).notNull().default(0),
  costPrice: bigint("cost_price", { mode: 'number' }).notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('on_sale'),
  // P2-10：软删除时间戳。为 null 表示未删除；删除操作置位而非硬删，便于误删恢复与审计。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  erpSyncAt: customTimestamptz("erp_sync_at", { precision: 3 }),
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
  index("idx_pos_style_status").on(table.status),
  index("idx_pos_style_category").on(table.category),
]);

export const posSize = pgTable("pos_size", {
  id: varchar("id", { length: 10 }).primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
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

export const posColor = pgTable("pos_color", {
  id: varchar("id", { length: 10 }).primaryKey(),
  // P2-10：软删除时间戳（见 posStyle.deletedAt 注释）。
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  name: varchar("name", { length: 50 }).notNull(),
  hex: varchar("hex", { length: 20 }).notNull(),
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

// table aliases
export const posColorTable = posColor;
export const posCouponTable = posCoupon;
export const posEmployeeTable = posEmployee;
export const posEodTable = posEod;
export const posEodPaymentTable = posEodPayment;
export const posMemberTable = posMember;
export const posOfflineQueueTable = posOfflineQueue;
export const posOmnichannelItemTable = posOmnichannelItem;
export const posOmnichannelOrderTable = posOmnichannelOrder;
export const posOperationLogTable = posOperationLog;
export const posPointsLogTable = posPointsLog;
export const posPreorderTable = posPreorder;
export const posPreorderItemTable = posPreorderItem;
export const posPromotionTable = posPromotion;
export const posReturnItemTable = posReturnItem;
export const posReturnOrderTable = posReturnOrder;
export const posSaleDiscountTable = posSaleDiscount;
export const posSaleItemTable = posSaleItem;
export const posSaleOrderTable = posSaleOrder;
export const posSalePaymentTable = posSalePayment;
export const posShiftTable = posShift;
export const posSizeTable = posSize;
export const posSkuTable = posSku;
export const posStockTable = posStock;
export const posStockAdjustTable = posStockAdjust;
export const posStocktakeTable = posStocktake;
export const posStocktakeItemTable = posStocktakeItem;
export const posStoreTable = posStore;
export const posStoredLogTable = posStoredLog;
export const posStyleTable = posStyle;
export const posSuspendedOrderTable = posSuspendedOrder;
export const posSyncLogTable = posSyncLog;
export const posTransferTable = posTransfer;
export const posTransferItemTable = posTransferItem;
export const posTransferRequestTable = posTransferRequest;
export const posTransferRequestItemTable = posTransferRequestItem;
