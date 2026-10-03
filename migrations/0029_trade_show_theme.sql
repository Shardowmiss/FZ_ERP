-- 0029 订货会主题主数据
--
-- 背景：订货会管理需要一个独立的「主题」主数据（年份 / 季节 / 主题名称），
--   供订货会主单及其它下游引用。本表是主题的唯一权威来源（single source of truth）。
--   当前 trade_show 表为 0 行，无既有主题引用可初始化；本迁移仅建表 + 授权，
--   由种子脚本 / 运营在界面维护具体主题。
--
-- 幂等：可重复执行（CREATE TABLE IF NOT EXISTS / 无害 GRANT）。

BEGIN;

-- ============ 1) 建表 ============
CREATE TABLE IF NOT EXISTS trade_show_theme (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_code   varchar(50)  NOT NULL UNIQUE,
  theme_name   varchar(200) NOT NULL,
  year         varchar(10),
  season       varchar(20),
  sort_order   integer NOT NULL DEFAULT 0,
  status       varchar(20) NOT NULL DEFAULT 'active',
  remark       text,
  -- System field: Creation time
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Creator
  _created_by  user_profile,
  -- System field: Update time
  _updated_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Updater
  _updated_by  user_profile
);

-- ============ 2) 索引（与 schema.ts 同名） ============
CREATE INDEX IF NOT EXISTS idx_trade_show_theme_status    ON trade_show_theme(status);
CREATE INDEX IF NOT EXISTS idx_trade_show_theme_year      ON trade_show_theme(year);
CREATE INDEX IF NOT EXISTS idx_trade_show_theme_sort      ON trade_show_theme(sort_order);

-- ============ 3) 授权 anon_（平台以 SET ROLE anon_ 执行查询，否则 42501） ============
GRANT USAGE ON SCHEMA public TO anon_;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE trade_show_theme TO anon_;
-- user_profile 为自定义类型，新建对象引用它时必须显式授权（否则 42501）
GRANT USAGE ON TYPE user_profile TO anon_;

COMMIT;
