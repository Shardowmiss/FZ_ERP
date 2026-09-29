-- =============================================================================
-- 服装ERP 系统 P0 增强功能：数据库迁移脚本
-- 新增 8 张表：批次库存 + 委外加工（订单/发料/回收/加工费）
-- 应用前请先在测试库执行并核对；建议在事务中执行或备份后执行。
-- 说明：
--   1. _created_at / _updated_at 使用 timestamptz(3)，由数据库默认填入。
--   2. _created_by / _updated_by 为自定义复合类型 user_profile（系统已存在），可空。
--   3. 外键依赖已存在表：sku / material / supplier / warehouse / subcontract_order 等。
-- =============================================================================

-- ---------- 1. 批次库存 inventory_batch ----------
CREATE TABLE IF NOT EXISTS inventory_batch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id        uuid NOT NULL,
  sku_code      varchar(100) NOT NULL,
  style_no      varchar(50) NOT NULL,
  color         varchar(50) NOT NULL,
  size          varchar(50) NOT NULL,
  warehouse_id  uuid NOT NULL,
  warehouse_name varchar(200) NOT NULL,
  batch_no      varchar(50) NOT NULL,
  quantity      numeric NOT NULL DEFAULT 0,
  production_date date,
  expiry_date   date,
  status        varchar(20) NOT NULL DEFAULT 'active',
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by   user_profile,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by   user_profile,
  CONSTRAINT uq_inventory_batch_sk_wh_batch UNIQUE (sku_id, warehouse_id, batch_no),
  CONSTRAINT fk_inventory_batch_sku FOREIGN KEY (sku_id) REFERENCES sku(id),
  CONSTRAINT fk_inventory_batch_wh FOREIGN KEY (warehouse_id) REFERENCES warehouse(id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_batch_sku ON inventory_batch(sku_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batch_wh ON inventory_batch(warehouse_id);

-- ---------- 2. 委外订单 subcontract_order ----------
CREATE TABLE IF NOT EXISTS subcontract_order (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      varchar(50) NOT NULL UNIQUE,
  supplier_id   uuid NOT NULL,
  supplier_name varchar(200) NOT NULL,
  order_date    date NOT NULL,
  delivery_date date,
  total_quantity numeric NOT NULL DEFAULT 0,
  total_amount  numeric NOT NULL DEFAULT 0,
  status        varchar(20) NOT NULL DEFAULT 'draft',
  remark        text,
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by   user_profile,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by   user_profile,
  CONSTRAINT fk_subcontract_order_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_order_order_no_key ON subcontract_order(order_no);

-- ---------- 3. 委外订单明细 subcontract_order_item ----------
CREATE TABLE IF NOT EXISTS subcontract_order_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL,
  sku_id       uuid NOT NULL,
  sku_code     varchar(100) NOT NULL,
  style_no     varchar(50) NOT NULL,
  color        varchar(50) NOT NULL,
  size         varchar(50) NOT NULL,
  quantity     numeric NOT NULL DEFAULT 0,
  unit_price   numeric NOT NULL DEFAULT 0,
  amount       numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0,
  remark       text,
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by  user_profile,
  _updated_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by  user_profile,
  CONSTRAINT fk_subcontract_order_item_order FOREIGN KEY (order_id) REFERENCES subcontract_order(id) ON DELETE CASCADE,
  CONSTRAINT fk_subcontract_order_item_sku FOREIGN KEY (sku_id) REFERENCES sku(id)
);

-- ---------- 4. 委外发料单 subcontract_issue ----------
CREATE TABLE IF NOT EXISTS subcontract_issue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_no      varchar(50) NOT NULL UNIQUE,
  order_id      uuid NOT NULL,
  supplier_id   uuid NOT NULL,
  supplier_name varchar(200) NOT NULL,
  warehouse_id  uuid NOT NULL,
  warehouse_name varchar(200) NOT NULL,
  issue_date    date NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'draft',
  remark        text,
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by   user_profile,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by   user_profile,
  CONSTRAINT fk_subcontract_issue_order FOREIGN KEY (order_id) REFERENCES subcontract_order(id),
  CONSTRAINT fk_subcontract_issue_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id),
  CONSTRAINT fk_subcontract_issue_wh FOREIGN KEY (warehouse_id) REFERENCES warehouse(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_issue_issue_no_key ON subcontract_issue(issue_no);

-- ---------- 5. 委外发料明细 subcontract_issue_item ----------
CREATE TABLE IF NOT EXISTS subcontract_issue_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id     uuid NOT NULL,
  material_id  uuid NOT NULL,
  material_code varchar(50) NOT NULL,
  material_name varchar(200) NOT NULL,
  unit         varchar(20) NOT NULL,
  quantity     numeric NOT NULL DEFAULT 0,
  remark       text,
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by  user_profile,
  _updated_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by  user_profile,
  CONSTRAINT fk_subcontract_issue_item_issue FOREIGN KEY (issue_id) REFERENCES subcontract_issue(id) ON DELETE CASCADE,
  CONSTRAINT fk_subcontract_issue_item_material FOREIGN KEY (material_id) REFERENCES material(id)
);

-- ---------- 6. 委外回收单 subcontract_receipt ----------
CREATE TABLE IF NOT EXISTS subcontract_receipt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no    varchar(50) NOT NULL UNIQUE,
  order_id      uuid NOT NULL,
  supplier_id   uuid NOT NULL,
  supplier_name varchar(200) NOT NULL,
  warehouse_id  uuid NOT NULL,
  warehouse_name varchar(200) NOT NULL,
  receipt_date  date NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'draft',
  remark        text,
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by   user_profile,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by   user_profile,
  CONSTRAINT fk_subcontract_receipt_order FOREIGN KEY (order_id) REFERENCES subcontract_order(id),
  CONSTRAINT fk_subcontract_receipt_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id),
  CONSTRAINT fk_subcontract_receipt_wh FOREIGN KEY (warehouse_id) REFERENCES warehouse(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_receipt_receipt_no_key ON subcontract_receipt(receipt_no);

-- ---------- 7. 委外回收明细 subcontract_receipt_item ----------
CREATE TABLE IF NOT EXISTS subcontract_receipt_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id    uuid NOT NULL,
  sku_id        uuid NOT NULL,
  sku_code      varchar(100) NOT NULL,
  style_no      varchar(50) NOT NULL,
  color         varchar(50) NOT NULL,
  size          varchar(50) NOT NULL,
  quantity      numeric NOT NULL DEFAULT 0,
  qualified_qty numeric NOT NULL DEFAULT 0,
  remark        text,
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by   user_profile,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by   user_profile,
  CONSTRAINT fk_subcontract_receipt_item_receipt FOREIGN KEY (receipt_id) REFERENCES subcontract_receipt(id) ON DELETE CASCADE,
  CONSTRAINT fk_subcontract_receipt_item_sku FOREIGN KEY (sku_id) REFERENCES sku(id)
);

-- ---------- 8. 委外加工费 subcontract_fee ----------
CREATE TABLE IF NOT EXISTS subcontract_fee (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL,
  supplier_id   uuid NOT NULL,
  supplier_name varchar(200) NOT NULL,
  fee_type      varchar(30) NOT NULL DEFAULT 'processing',
  quantity      numeric NOT NULL DEFAULT 0,
  unit_price    numeric NOT NULL DEFAULT 0,
  amount        numeric NOT NULL DEFAULT 0,
  status        varchar(20) NOT NULL DEFAULT 'draft',
  remark        text,
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by   user_profile,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by   user_profile,
  CONSTRAINT fk_subcontract_fee_order FOREIGN KEY (order_id) REFERENCES subcontract_order(id),
  CONSTRAINT fk_subcontract_fee_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id)
);

-- 注意：subcontract_fee.status 在应用层用于区分 pending / settled；
--       结算后会自动生成应付（payable）记录，biz_type = 'subcontract_fee'。
