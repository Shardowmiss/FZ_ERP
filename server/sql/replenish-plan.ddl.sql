-- 补货管理（下游渠道铺货）新增表 DDL
-- 执行：psql -h localhost -p 5434 -U erp -d erp_db -f server/sql/replenish-plan.ddl.sql
-- 与 schema.ts 中 replenishPlan / replenishPlanItem / replenishTemplate 定义保持一致。

CREATE TABLE IF NOT EXISTS replenish_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_no varchar(50) NOT NULL UNIQUE,
  template_id uuid,
  store_id uuid NOT NULL,
  store_type varchar(20) NOT NULL,
  store_name varchar(200),
  doc_type varchar(20) NOT NULL,            -- 'sales_order' | 'transfer'
  status varchar(20) NOT NULL DEFAULT 'draft',
  calc_snapshot jsonb,
  remark text,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  _deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_replenish_plan_store ON replenish_plan (store_id);
CREATE INDEX IF NOT EXISTS idx_replenish_plan_doc_type ON replenish_plan (doc_type);

CREATE TABLE IF NOT EXISTS replenish_plan_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES replenish_plan (id) ON DELETE CASCADE,
  sku_id uuid NOT NULL,
  sku_code varchar(64),
  style_no varchar(32),
  color varchar(32),
  size varchar(32),
  recent_sales_qty numeric,
  daily_avg numeric,
  current_stock numeric,
  in_transit_qty numeric,
  safety_stock numeric,
  suggested_raw numeric,
  suggested_qty numeric NOT NULL,
  generated_doc_id varchar(64),
  generated_doc_no varchar(64),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_replenish_plan_item_plan ON replenish_plan_item (plan_id);

CREATE TABLE IF NOT EXISTS replenish_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  code varchar(50) NOT NULL UNIQUE,
  scope_type varchar(20) NOT NULL DEFAULT 'all',
  store_filter jsonb,
  sku_filter jsonb,
  param_n integer NOT NULL DEFAULT 30,
  expected_days integer NOT NULL DEFAULT 14,
  lead_time_days integer NOT NULL DEFAULT 0,
  safety_days integer NOT NULL DEFAULT 0,
  case_qty numeric NOT NULL DEFAULT 1,
  source_warehouse_rule varchar(20) NOT NULL DEFAULT 'fixed',
  fixed_warehouse_id uuid,
  enabled boolean NOT NULL DEFAULT false,
  cron varchar(100),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  _deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_replenish_template_enabled ON replenish_template (enabled);
