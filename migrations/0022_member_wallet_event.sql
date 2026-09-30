-- 0022 会员钱包事件账本（S3 积分/储值单轨）
--
-- 背景：POS 门店消费在本地累加 pos_member.points / stored_value（sales/returns/omnichannel
--       三处各自写），而 ERP 侧只在「零售单结算」时加积分（retail.service.ts:556），
--       且 POS 上行销售单走的是 pos-receiver.receiveSales，建 status='completed' 的
--       retail_order，**不经过 settleRetailOrder** → ERP 侧根本不会为 POS 上行单加积分。
--       结果：两端各记一套、互不打通，ERP 会员积分对门店消费完全失真。
--
-- 设计：ERP 作为会员钱包的唯一账本方（与 S2「erp_member_id 身份锚点」一致），
--       POS 侧每次积分/储值变动产出一条**幂等事件**上行，ERP 用本表做幂等去重后入账：
--         · 重放/重试/离线补传同一事件 → 命中 event_key 唯一键，直接返回原结果，不重复加。
--         · 幂等键约定：{sourceType}:{sourceNo}:{kind}（如 sale:SO20261001-0001:points）
--       本表同时是「对账凭证」：可按 member_id / source_no 追溯每一次变动的来源。
--
-- ⚠ 幂等：全脚本可重复执行（CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS）。

CREATE TABLE IF NOT EXISTS member_wallet_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 幂等键：同一业务事实（同一单、同一币种类型）永远只有一个键
  event_key varchar(160) NOT NULL,
  member_id uuid NOT NULL,
  -- points（积分，整数）| stored_value（储值，单位=分，与 member.stored_value 对齐）
  kind varchar(20) NOT NULL,
  -- 增量，可为负（退货回冲为负）
  change_value bigint NOT NULL,
  -- 入账后的余额快照，用于对账
  balance_after bigint NOT NULL,
  -- sale | return | omnichannel | adjust
  source_type varchar(30) NOT NULL,
  source_no varchar(100),
  store_code varchar(50),
  -- applied（已入账）| rejected（被拒，如会员不存在/余额不足）
  status varchar(20) NOT NULL DEFAULT 'applied',
  message text,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- 幂等的唯一依赖：applyEvent 的 ON CONFLICT 目标。缺失则「不重复加积分」无法保证。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_member_wallet_event_key
  ON member_wallet_event (event_key);

CREATE INDEX IF NOT EXISTS idx_member_wallet_event_member
  ON member_wallet_event (member_id, _created_at DESC);

-- 按来源单据追溯（对账：这张单到底加了几次分）
CREATE INDEX IF NOT EXISTS idx_member_wallet_event_source
  ON member_wallet_event (source_type, source_no);

COMMENT ON TABLE member_wallet_event IS 'S3 会员钱包事件账本：POS 上行积分/储值变动的幂等入账凭证';
COMMENT ON COLUMN member_wallet_event.event_key IS '幂等键 {sourceType}:{sourceNo}:{kind}，唯一索引保证同一业务事实只入账一次';
COMMENT ON COLUMN member_wallet_event.kind IS 'points=积分(整数) | stored_value=储值(单位分)';
COMMENT ON COLUMN member_wallet_event.change_value IS '增量，退货回冲为负';
COMMENT ON COLUMN member_wallet_event.balance_after IS '入账后余额快照，用于对账';
