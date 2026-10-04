-- 0033 条形码管理（四大改造 D）
--
-- style_barcode_config：按款号配置「颜色列表 + 适用尺码组（size_group.id 数组）」。
-- style_barcode：根据上述配置生成「颜色 × 尺码」条码矩阵（每行一条条码）。
--
-- 幂等：可重复执行（CREATE TABLE IF NOT EXISTS / 索引 IF NOT EXISTS / ON CONFLICT 不适用此处）。

BEGIN;

-- ============ 1) 建表 ============
CREATE TABLE IF NOT EXISTS style_barcode_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id        uuid NOT NULL,
  -- [{ name: string; value: string }]
  colors          jsonb NOT NULL DEFAULT '[]',
  -- 适用尺码组（引用 size_group.id），可多个
  size_group_ids  uuid[] NOT NULL DEFAULT '{}',
  -- 条码前缀（可选，用于拼接生成条码）
  barcode_prefix  varchar(50),
  status          varchar(20) NOT NULL DEFAULT 'active',
  remark          text,
  -- System field: Creation time
  _created_at     timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Creator
  _created_by     user_profile,
  -- System field: Update time
  _updated_at     timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Updater
  _updated_by     user_profile,
  CONSTRAINT style_barcode_config_style_fkey
    FOREIGN KEY (style_id) REFERENCES style(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS style_barcode (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id     uuid NOT NULL,
  style_id      uuid NOT NULL,
  color_name    varchar(100) NOT NULL,
  color_value   varchar(50),
  size          varchar(50) NOT NULL,
  size_group_id uuid,
  barcode       varchar(50) NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  -- System field: Creation time
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Creator
  _created_by   user_profile,
  -- System field: Update time
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Updater
  _updated_by   user_profile,
  CONSTRAINT style_barcode_config_id_fkey
    FOREIGN KEY (config_id) REFERENCES style_barcode_config(id) ON DELETE CASCADE,
  CONSTRAINT style_barcode_style_fkey
    FOREIGN KEY (style_id) REFERENCES style(id) ON DELETE CASCADE,
  CONSTRAINT style_barcode_barcode_key UNIQUE (barcode)
);

-- ============ 2) 索引 ============
CREATE INDEX IF NOT EXISTS idx_style_barcode_config_style ON style_barcode_config(style_id);
CREATE INDEX IF NOT EXISTS idx_style_barcode_config       ON style_barcode(config_id);
CREATE INDEX IF NOT EXISTS idx_style_barcode_style        ON style_barcode(style_id);

-- ============ 3) 授权 anon_ ============
GRANT USAGE ON SCHEMA public TO anon_;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE style_barcode_config TO anon_;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE style_barcode TO anon_;
GRANT USAGE ON TYPE user_profile TO anon_;

COMMIT;
