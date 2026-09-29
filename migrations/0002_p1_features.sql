-- P1 功能迁移脚本：全渠道OMS(3表) + 会员私域(3表) + 商品生命周期列
-- 在已应用 0001_p0_features.sql 的基础上执行。
-- 说明：系统字段 created_at/created_by/updated_at/updated_by 由应用会话自动填充，DDL 中保持与现有表一致即可。

-- ============ 商品生命周期：style 增加生命周期状态列 ============
ALTER TABLE style ADD COLUMN IF NOT EXISTS lifecycle_status varchar(20) NOT NULL DEFAULT 'introduction';

-- ============ P1-3 全渠道 OMS ============
CREATE TABLE IF NOT EXISTS sales_channel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_code varchar(50) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  platform varchar(50) NOT NULL DEFAULT 'other',
  api_config jsonb NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL DEFAULT 'active',
  remark text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by user_profile,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by user_profile
);

CREATE TABLE IF NOT EXISTS omni_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no varchar(50) NOT NULL UNIQUE,
  channel_id uuid NOT NULL REFERENCES sales_channel(id),
  channel_name varchar(200) NOT NULL,
  external_no varchar(100),
  customer_name varchar(200) NOT NULL,
  contact_phone varchar(50),
  address text,
  total_amount numeric NOT NULL DEFAULT '0',
  item_count integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  ship_status varchar(20) NOT NULL DEFAULT 'unshipped',
  remark text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by user_profile,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_omni_order_channel ON omni_order(channel_id);
CREATE INDEX IF NOT EXISTS idx_omni_order_status ON omni_order(status);

CREATE TABLE IF NOT EXISTS omni_order_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  omni_order_id uuid NOT NULL REFERENCES omni_order(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES sku(id),
  sku_code varchar(100) NOT NULL,
  style_no varchar(50) NOT NULL,
  color varchar(50) NOT NULL,
  size varchar(50) NOT NULL,
  quantity numeric NOT NULL DEFAULT '0',
  price numeric NOT NULL DEFAULT '0',
  amount numeric NOT NULL DEFAULT '0',
  allocated_qty numeric NOT NULL DEFAULT '0',
  shortage_qty numeric NOT NULL DEFAULT '0',
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by user_profile,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_omni_order_item_order ON omni_order_item(omni_order_id);

-- ============ P1-4 会员私域 ============
CREATE TABLE IF NOT EXISTS member_tag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  remark text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by user_profile,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by user_profile
);

CREATE TABLE IF NOT EXISTS member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_no varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  phone varchar(50),
  gender varchar(10) DEFAULT 'unknown',
  birthday date,
  level varchar(20) NOT NULL DEFAULT 'normal',
  tag_ids jsonb NOT NULL DEFAULT '[]',
  total_spent numeric NOT NULL DEFAULT '0',
  order_count integer NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  last_purchase_date date,
  status varchar(20) NOT NULL DEFAULT 'active',
  remark text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by user_profile,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_member_phone ON member(phone);
CREATE INDEX IF NOT EXISTS idx_member_level ON member(level);
CREATE INDEX IF NOT EXISTS idx_member_status ON member(status);

CREATE TABLE IF NOT EXISTS member_point (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  change_type varchar(30) NOT NULL,
  change_value integer NOT NULL DEFAULT 0,
  balance integer NOT NULL DEFAULT 0,
  remark text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by user_profile,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_member_point_member ON member_point(member_id);

-- 注：retail_order 已存在 member_id 字段，会员消费画像通过 member_id 关联 retail_order / retail_order_item。
