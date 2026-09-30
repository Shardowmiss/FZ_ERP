/**
 * P1-8 业务单测 + CI：in-memory Postgres 集成测试基座。
 *
 * 采用 `@electric-sql/pglite`（WASM 原生 Postgres，无需外部数据库服务），
 * 在内存中拉起一个与平台 schema 结构一致的测试库，供业务 service 做「真 SQL」
 * 集成测试（覆盖本次已修复的财务闭环 / 库存明细 / 多租户 / 离线分片等关键路径）。
 *
 * 说明：
 * - 平台自定义复合类型 `user_profile` / `file_attachment` 在 PostgreSQL 中并不存在，
 *   此处仅按 `fromDriver` 的解析约定重建最小复合类型（首字段为 user_id），使表可建、
 *   列默认值 NULL 可用；测试数据不写这些列，由 DB 默认值接管。
 * - 仅创建业务集成测试所需的 17 张表（含最小父表），不覆盖全量 schema。
 * - DDL 全部 `IF NOT EXISTS`，对全新 pglite 实例天然幂等。
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@server/database/schema';

// 注：pglite 0.2.x 不支持 `CREATE TYPE IF NOT EXISTS`（报 syntax error at or near "NOT"，
// 且会让整段 DDL 失败、所有集成测试无法启动）。此处每个实例都是全新内存库，
// 直接 CREATE TYPE 即可；若将来升级 pglite 可恢复 IF NOT EXISTS。
/**
 * pos_promotion 的最小 DDL（单表）。
 *
 * 单表 + IF NOT EXISTS 是为了能被「真库 E2E」复用：server/modules/erp-integration/
 * promotion-e2e.spec.ts 要在真实 PostgreSQL 服务上建同一张表跑全链路，若那里再抄一份
 * 定义，将来 schema 一改就会和这里漂移（E2E 通过但测试库还是旧结构，或反之）。
 *
 * ⚠ 本常量必须定义在下面的 DDL 主模板**之前**：模板字面量里没有注释的概念，
 * 若把它写进主模板内部，那一行会直接把主模板提前闭合，整个文件解析失败。
 */
export const POS_PROMOTION_DDL = `CREATE TABLE IF NOT EXISTS pos_promotion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  type varchar(30) NOT NULL,
  threshold bigint,
  discount_value bigint,
  discount_type varchar(20),
  apply_scope varchar(20) NOT NULL DEFAULT 'all',
  scope_ids varchar(50)[] NOT NULL DEFAULT '{}',
  valid_from timestamptz,
  valid_to timestamptz,
  status varchar(20) NOT NULL DEFAULT 'active',
  priority integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  is_member_only boolean NOT NULL DEFAULT false,
  source varchar(20) NOT NULL DEFAULT 'erp',
  erp_sync_at timestamptz,
  -- Wave 4-C：ERP 促销幂等键 / ERP 侧更新时间（见 server/database/schema.ts 同名列注释）
  erp_promotion_id varchar(40),
  erp_updated_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);
-- 不带 schema 前缀：跟随 search_path。写死 public. 会让真库 E2E 建在隔离 schema
-- 之外的同名表上（幂等 upsert 直接报 "no unique or exclusion constraint matching"）。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pos_promotion_erp_id ON pos_promotion (erp_promotion_id);`;

const DDL = `
CREATE TYPE user_profile AS (user_id text);
CREATE TYPE file_attachment AS (bucket_id text, file_path text);

CREATE TABLE IF NOT EXISTS pos_store (
  id varchar(50) PRIMARY KEY,
  name varchar(200) NOT NULL,
  code varchar(50) NOT NULL UNIQUE,
  address varchar(500),
  deleted_at timestamptz,
  phone varchar(50),
  status varchar(20) NOT NULL DEFAULT 'active',
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pos_employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL,
  deleted_at timestamptz,
  code varchar(50) NOT NULL UNIQUE,
  role varchar(20) NOT NULL DEFAULT 'sales',
  store_id varchar(50),
  status varchar(20) NOT NULL DEFAULT 'active',
  password_hash varchar(200),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pos_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_no varchar(50) NOT NULL UNIQUE,
  name varchar(100),
  phone varchar(20) NOT NULL UNIQUE,
  deleted_at timestamptz,
  gender varchar(10),
  birthday date,
  level varchar(20) NOT NULL DEFAULT 'normal',
  points integer NOT NULL DEFAULT 0,
  stored_value bigint NOT NULL DEFAULT 0,
  prefer_size varchar(10),
  prefer_style varchar(50),
  total_spent bigint NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  last_purchase_at timestamptz,
  erp_sync_at timestamptz,
  client_id varchar(100) UNIQUE,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pos_style (
  id varchar(50) PRIMARY KEY,
  name varchar(200) NOT NULL,
  category varchar(50) NOT NULL,
  color_ids varchar(50)[] NOT NULL DEFAULT '{}',
  size_ids varchar(50)[] NOT NULL DEFAULT '{}',
  tag_price bigint NOT NULL DEFAULT 0,
  cost_price bigint NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'on_sale',
  deleted_at timestamptz,
  erp_sync_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pos_color (
  id varchar(10) PRIMARY KEY,
  deleted_at timestamptz,
  name varchar(50) NOT NULL,
  hex varchar(20) NOT NULL,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pos_size (
  id varchar(10) PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

${POS_PROMOTION_DDL}

CREATE TABLE IF NOT EXISTS pos_sku (
  id varchar(100) PRIMARY KEY,
  deleted_at timestamptz,
  style_id varchar(50) NOT NULL,
  color_id varchar(10) NOT NULL,
  size_id varchar(10) NOT NULL,
  barcode varchar(100),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_sku_style_id_fkey FOREIGN KEY (style_id) REFERENCES pos_style(id)
);

CREATE TABLE IF NOT EXISTS pos_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar(50) NOT NULL,
  sku_id varchar(100) NOT NULL,
  style_id varchar(50) NOT NULL,
  color_id varchar(10) NOT NULL,
  size_id varchar(10) NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  in_transit_qty integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_stock_store_id_sku_id_key UNIQUE (store_id, sku_id)
);

CREATE TABLE IF NOT EXISTS pos_stock_adjust (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjust_no varchar(50) NOT NULL UNIQUE,
  store_id varchar(50) NOT NULL,
  type varchar(20) NOT NULL,
  reason varchar(500),
  status varchar(20) NOT NULL DEFAULT 'completed',
  employee_id uuid,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_stock_adjust_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES pos_employee(id)
);

CREATE TABLE IF NOT EXISTS pos_stock_adjust_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjust_id uuid NOT NULL,
  sku_id varchar(100) NOT NULL,
  style_id varchar(50) NOT NULL,
  color_id varchar(10) NOT NULL,
  size_id varchar(10) NOT NULL,
  qty integer NOT NULL,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_stock_adjust_item_adjust_id_fkey FOREIGN KEY (adjust_id) REFERENCES pos_stock_adjust(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pos_omnichannel_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no varchar(50) NOT NULL UNIQUE,
  channel varchar(30) NOT NULL,
  type varchar(20) NOT NULL,
  store_id varchar(50) NOT NULL,
  member_name varchar(100),
  member_phone varchar(20),
  total_amount bigint NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  address text,
  pickup_code varchar(20),
  picked_at timestamptz,
  shipped_at timestamptz,
  source_no varchar(50),
  sale_order_no varchar(50),
  fulfilled_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pos_omnichannel_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  sku_id varchar(100) NOT NULL,
  style_id varchar(50) NOT NULL,
  style_name varchar(200) NOT NULL,
  color_id varchar(10) NOT NULL,
  size_id varchar(10) NOT NULL,
  qty integer NOT NULL,
  price bigint NOT NULL,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_omnichannel_item_order_id_fkey FOREIGN KEY (order_id) REFERENCES pos_omnichannel_order(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pos_sale_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no varchar(50) NOT NULL UNIQUE,
  store_id varchar(50) NOT NULL,
  member_id uuid,
  employee_id uuid,
  -- 业务成交日期，需与 server/database/schema.ts 的 posSaleOrder.saleDate 保持一致
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  total_qty integer NOT NULL DEFAULT 0,
  total_amount bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  pay_amount bigint NOT NULL DEFAULT 0,
  points_used integer NOT NULL DEFAULT 0,
  points_earned integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'completed',
  channel varchar(20) NOT NULL DEFAULT 'store',
  shift_id uuid,
  remark varchar(500),
  synced_to_erp boolean NOT NULL DEFAULT false,
  sync_status varchar(20) NOT NULL DEFAULT 'pending',
  sync_at timestamptz,
  client_id varchar(100) UNIQUE,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_sale_order_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES pos_employee(id),
  CONSTRAINT pos_sale_order_member_id_fkey FOREIGN KEY (member_id) REFERENCES pos_member(id)
);

CREATE TABLE IF NOT EXISTS pos_sale_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  sku_id varchar(100) NOT NULL,
  style_id varchar(50) NOT NULL,
  style_name varchar(200) NOT NULL,
  color_id varchar(10) NOT NULL,
  size_id varchar(10) NOT NULL,
  qty integer NOT NULL,
  tag_price bigint NOT NULL,
  unit_price bigint NOT NULL,
  discount_amount bigint NOT NULL DEFAULT 0,
  line_amount bigint NOT NULL,
  refunded_qty integer NOT NULL DEFAULT 0,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_sale_item_order_id_fkey FOREIGN KEY (order_id) REFERENCES pos_sale_order(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pos_sale_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  pay_method varchar(20) NOT NULL,
  amount bigint NOT NULL,
  change_amount bigint NOT NULL DEFAULT 0,
  transaction_id varchar(100),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_sale_payment_order_id_fkey FOREIGN KEY (order_id) REFERENCES pos_sale_order(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pos_points_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  change integer NOT NULL,
  balance integer NOT NULL,
  type varchar(20) NOT NULL,
  source_no varchar(100),
  remark varchar(200),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL,
  CONSTRAINT pos_points_log_member_id_fkey FOREIGN KEY (member_id) REFERENCES pos_member(id)
);

CREATE TABLE IF NOT EXISTS pos_operation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar(50),
  employee_id uuid,
  module varchar(50) NOT NULL,
  action varchar(50) NOT NULL,
  target_no varchar(100),
  content text,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- S1 资金护栏测试所需：ErpIntegrationService.syncDownstream() 收尾会写同步日志
-- （erp-integration.service.ts:390），缺表会让会员下行的回归用例直接报 relation missing。
CREATE TABLE IF NOT EXISTS pos_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction varchar(10) NOT NULL,
  data_type varchar(50) NOT NULL,
  doc_no varchar(100),
  status varchar(20) NOT NULL,
  response text,
  payload jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);
`;

export interface TestDb {
  /** pglite 驱动的 drizzle 实例（已在构造处被 scopeDatabase 包裹） */
  db: any;
  /** 原始 pglite 实例，用于关闭 */
  pg: any;
}

/**
 * 拉起一个内存 Postgres，建表并返回 drizzle 实例。
 * 每个集成测试文件应在 beforeAll 调用一次，afterAll 调用 `pg.close()`。
 */
export async function setupTestDb(): Promise<TestDb> {
  const pg = await PGlite.create();
  await pg.exec(DDL);
  const db = drizzle(pg, { schema });
  return { db, pg };
}
