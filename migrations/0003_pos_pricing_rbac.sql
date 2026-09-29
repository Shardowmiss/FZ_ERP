-- =============================================================================
-- 服装ERP 功能追加（Phase 4）：门店POS收银 / 价格促销引擎 / 行级数据权限
-- 新增 6 张表：价格表 / 价格表明细 / 促销活动 / 优惠券 / POS班次 / 用户-门店映射
-- 应用前请先在测试库执行并核对；建议在事务中执行或备份后执行。
-- 说明：
--   1. _created_at / _updated_at 使用 timestamptz(3)，由数据库默认填入。
--   2. _created_by / _updated_by 为自定义复合类型 user_profile（系统已存在），可空。
--   3. 外键依赖已存在表：price_list / rbac_user / store / sku。
-- =============================================================================

-- ---------- 1. 价格表 price_list ----------
CREATE TABLE IF NOT EXISTS price_list (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(32) NOT NULL UNIQUE,
  name           varchar(100) NOT NULL,
  type           varchar(20) NOT NULL DEFAULT 'store',   -- store | channel | member | customer
  scope_id       uuid,                                    -- 适用对象ID（门店/渠道/会员等级）
  priority       integer NOT NULL DEFAULT 0,              -- 优先级，越大越高
  status         varchar(20) NOT NULL DEFAULT 'active',
  effective_from date,
  effective_to   date,
  remark         varchar(500),
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile
);
CREATE INDEX IF NOT EXISTS idx_price_list_type ON price_list(type);
CREATE INDEX IF NOT EXISTS idx_price_list_scope ON price_list(scope_id);
CREATE INDEX IF NOT EXISTS idx_price_list_status ON price_list(status);

-- ---------- 2. 价格表明细 price_list_item ----------
CREATE TABLE IF NOT EXISTS price_list_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id  uuid NOT NULL,
  style_no       varchar(50),
  sku_id         uuid,                                     -- 为空表示适用整款
  sku_code       varchar(100),
  tag_price      numeric NOT NULL DEFAULT '0',             -- 吊牌价（基准）
  price          numeric NOT NULL DEFAULT '0',             -- 该价格表售价
  discount_rate  numeric NOT NULL DEFAULT '1',             -- 折扣率 0~1
  status         varchar(20) NOT NULL DEFAULT 'active',
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile,
  CONSTRAINT fk_pli_price_list FOREIGN KEY (price_list_id) REFERENCES price_list(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pli_price_list ON price_list_item(price_list_id);
CREATE INDEX IF NOT EXISTS idx_pli_sku ON price_list_item(sku_id);
CREATE INDEX IF NOT EXISTS idx_pli_style ON price_list_item(style_no);

-- ---------- 3. 促销活动 promotion ----------
CREATE TABLE IF NOT EXISTS promotion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(32) NOT NULL UNIQUE,
  name           varchar(100) NOT NULL,
  type           varchar(20) NOT NULL DEFAULT 'full_reduction', -- full_reduction | percentage | fixed_price
  threshold      numeric NOT NULL DEFAULT '0',            -- 满减门槛
  reduce_amount  numeric NOT NULL DEFAULT '0',            -- 减免金额
  discount_rate  numeric NOT NULL DEFAULT '1',            -- 折扣率 0~1
  begin_date     date,
  end_date       date,
  store_ids      jsonb NOT NULL DEFAULT '[]',             -- 适用门店；空=全部门店
  priority       integer NOT NULL DEFAULT 0,
  status         varchar(20) NOT NULL DEFAULT 'active',
  remark         varchar(500),
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile
);
CREATE INDEX IF NOT EXISTS idx_promotion_status ON promotion(status);
CREATE INDEX IF NOT EXISTS idx_promotion_type ON promotion(type);

-- ---------- 4. 优惠券 coupon ----------
CREATE TABLE IF NOT EXISTS coupon (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(32) NOT NULL UNIQUE,
  name           varchar(100) NOT NULL,
  type           varchar(20) NOT NULL DEFAULT 'full_reduction', -- full_reduction | discount
  value          numeric NOT NULL DEFAULT '0',            -- 减免金额（满减券）
  discount_rate  numeric NOT NULL DEFAULT '1',            -- 折扣率 0~1（折扣券）
  min_spend      numeric NOT NULL DEFAULT '0',            -- 最低消费门槛
  begin_date     date,
  end_date       date,
  total_qty      integer NOT NULL DEFAULT 0,             -- 发行总量
  used_qty       integer NOT NULL DEFAULT 0,             -- 已用数量
  status         varchar(20) NOT NULL DEFAULT 'active',
  remark         varchar(500),
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile
);
CREATE INDEX IF NOT EXISTS idx_coupon_status ON coupon(status);
CREATE INDEX IF NOT EXISTS idx_coupon_code ON coupon(code);

-- ---------- 5. POS 收银班次 pos_session ----------
CREATE TABLE IF NOT EXISTS pos_session (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL,
  store_name     varchar(100) NOT NULL,
  cashier_id     uuid,
  cashier_name   varchar(50),
  open_time      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  close_time     timestamptz(3),
  open_amount    numeric NOT NULL DEFAULT '0',            -- 开班备用金
  close_amount   numeric NOT NULL DEFAULT '0',            -- 闭班实点现金
  expected_amount numeric NOT NULL DEFAULT '0',           -- 应收（备用金+销售）
  difference     numeric NOT NULL DEFAULT '0',            -- 差异
  status         varchar(20) NOT NULL DEFAULT 'open',     -- open | closed
  remark         varchar(500),
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile
);
CREATE INDEX IF NOT EXISTS idx_pos_session_store ON pos_session(store_id);
CREATE INDEX IF NOT EXISTS idx_pos_session_status ON pos_session(status);
CREATE INDEX IF NOT EXISTS idx_pos_session_open_time ON pos_session(open_time);

-- ---------- 6. 行级数据权限：用户-门店映射 rbac_user_store ----------
CREATE TABLE IF NOT EXISTS rbac_user_store (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  store_id       uuid NOT NULL,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  CONSTRAINT uq_rbac_user_store UNIQUE (user_id, store_id),
  CONSTRAINT fk_rbac_user_store_user FOREIGN KEY (user_id) REFERENCES rbac_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_rbac_user_store_store FOREIGN KEY (store_id) REFERENCES store(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rbac_user_store_user ON rbac_user_store(user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_store_store ON rbac_user_store(store_id);

-- ===================== 补充约束与索引（复盘加固） =====================
-- 以下语句均幂等（IF NOT EXISTS），无论 0003 是否已执行都可安全重复运行。

-- price_list：状态 + 有效期复合索引，加速“当前生效价格表”查询
CREATE INDEX IF NOT EXISTS idx_price_list_active_range ON price_list(status, effective_from, effective_to);

-- price_list_item：SKU 外键（删除 SKU 时置空）+ 唯一约束（避免同一价格表下重复价）
ALTER TABLE price_list_item
  ADD CONSTRAINT fk_pli_sku FOREIGN KEY (sku_id) REFERENCES sku(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pli_list_sku
  ON price_list_item(price_list_id, sku_id) WHERE sku_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pli_list_style
  ON price_list_item(price_list_id, style_no) WHERE sku_id IS NULL;

-- promotion：状态 + 有效期复合索引 + store_ids GIN 索引（按门店命中过滤）
CREATE INDEX IF NOT EXISTS idx_promotion_active_range ON promotion(status, begin_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotion_store_ids ON promotion USING gin (store_ids);

-- pos_session：门店外键（拒绝误删门店）、收银员外键（误删用户时置空）
ALTER TABLE pos_session
  ADD CONSTRAINT fk_pos_session_store FOREIGN KEY (store_id) REFERENCES store(id) ON DELETE RESTRICT;
ALTER TABLE pos_session
  ADD CONSTRAINT fk_pos_session_cashier FOREIGN KEY (cashier_id) REFERENCES rbac_user(id) ON DELETE SET NULL;

-- rbac_user_store：补齐更新时间系统字段，与全库一致
ALTER TABLE rbac_user_store ADD COLUMN IF NOT EXISTS _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE rbac_user_store ADD COLUMN IF NOT EXISTS _updated_by user_profile;
