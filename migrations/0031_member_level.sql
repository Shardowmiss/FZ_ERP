-- 0031 会员等级主数据（#11）
--
-- 背景：在「会员私域」下维护会员等级主数据，可增删改；初始化为四档：
--   会员卡 / 银卡 / 金卡 / 钻石卡。
--   每档可配置「达成条件」：累计 / 月 / 季 消费金额（condition_type + threshold_amount），
--   以及权益：正常折扣（discount，0.85 = 8.5 折）与「是否支持折上折」（discount_on_promo）。
--   会员表 member.level 持有本表 code，作为等级唯一权威来源。
--
-- 幂等：可重复执行（CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING 种子）。

BEGIN;

-- ============ 1) 建表 ============
CREATE TABLE IF NOT EXISTS member_level (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(30)  NOT NULL UNIQUE,
  name            varchar(100) NOT NULL,
  condition_type  varchar(20)  NOT NULL DEFAULT 'cumulative'
                    CHECK (condition_type IN ('cumulative', 'monthly', 'quarterly')),
  threshold_amount numeric     NOT NULL DEFAULT 0,
  discount        numeric      NOT NULL DEFAULT 1,
  discount_on_promo boolean    NOT NULL DEFAULT false,
  sort_order      integer      NOT NULL DEFAULT 0,
  status          varchar(20)  NOT NULL DEFAULT 'active',
  remark          text,
  -- System field: Creation time
  _created_at     timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Creator
  _created_by     user_profile,
  -- System field: Update time
  _updated_at     timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Updater
  _updated_by     user_profile
);

-- ============ 2) 索引 ============
CREATE INDEX IF NOT EXISTS idx_member_level_status ON member_level(status);
CREATE INDEX IF NOT EXISTS idx_member_level_sort   ON member_level(sort_order);

-- ============ 3) 种子：四档初始会员等级（幂等，code 冲突则跳过） ============
INSERT INTO member_level (code, name, condition_type, threshold_amount, discount, discount_on_promo, sort_order, status, remark)
VALUES
  ('normal',  '会员卡', 'cumulative', 0,     1.00, false, 10, 'active', '默认等级，注册即享，无折扣'),
  ('silver',  '银卡',   'cumulative', 5000,  0.95, false, 20, 'active', '累计消费满 5000 元'),
  ('gold',    '金卡',   'cumulative', 20000, 0.90, true,  30, 'active', '累计消费满 20000 元，支持折上折'),
  ('diamond', '钻石卡', 'cumulative', 50000, 0.85, true,  40, 'active', '累计消费满 50000 元，支持折上折')
ON CONFLICT (code) DO NOTHING;

-- ============ 4) 授权 anon_ ============
GRANT USAGE ON SCHEMA public TO anon_;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE member_level TO anon_;
GRANT USAGE ON TYPE user_profile TO anon_;

COMMIT;
