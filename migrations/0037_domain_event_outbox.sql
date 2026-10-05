-- 0037 纯 PG 事件总线：domain_event 发件箱（outbox）表 + 索引 + 平台权限
--
-- 背景（Wave 2-1 架构解耦，纯 PG 模式，零新基础设施）：
--   ERP 当前异步能力仅有一组 setInterval 调度器（consistency / replenish），没有事件总线 /
--   MQ / outbox。本报告 §七 Wave 2「缓存与异步化」要求引入解耦机制。鉴于平台锁定（lark-apaas
--   以 SET ROLE anon_ 执行）且 npm broker 拒装原生依赖（Redis / bullmq / kafka 均受阻），
--   采用「outbox 表 + 轮询 + LISTEN/NOTIFY」的纯 PG 方案，单实例与多实例部署均正确，
--   且后续若要接 Redis 仅需把 dispatcher 的派发目标换成 Redis Stream，表结构不变。
--
-- 设计要点：
--   1. uuid 主键（defaultRandom / gen_random_uuid），**不使用序列**，从而规避「新建 public 序列
--      须补 GRANT USAGE 给 anon_」的授权坑（铁律#5）。
--   2. status ∈ {pending, processing, dispatched, failed}：
--        pending     待派发（dispatcher 轮询/唤醒来源）
--        processing  已被某 dispatcher 锁定并认领（FOR UPDATE SKIP LOCKED + 行锁事务内置位），
--                    防止多实例重复派发；崩溃卡住超过 10 分钟由 recoverStuck 复位回 pending。
--        dispatched  处理成功（终态）
--        failed      超过最大重试次数进入死信（终态，需人工/对账处理）
--   3. payload 用 jsonb，写路径传 JSON 字符串 + ::jsonb 强转，读路径由驱动解析为对象。
--   4. 轮询索引 (status, _created_at) 命中「WHERE status='pending' ORDER BY _created_at」；
--      (aggregate_type, aggregate_id) 便于按聚合根查事件；(event_type) 便于排查。
--
-- 幂等：可重复执行（IF NOT EXISTS / 条件 GRANT 无害）。
-- 三处同步（ERP 侧）：本迁移 → schema.ts 声明 domainEvent → scripts/setup-test-db.sh 重克隆 erp_test。

CREATE TABLE IF NOT EXISTS domain_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(40) NOT NULL,
  aggregate_id varchar(64) NOT NULL,
  event_type varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'dispatched', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processing_since timestamptz(3),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at timestamptz(3)
);

-- ============ 索引 ============
CREATE INDEX IF NOT EXISTS idx_domain_event_status_created
  ON domain_event (status, _created_at);
CREATE INDEX IF NOT EXISTS idx_domain_event_agg
  ON domain_event (aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_domain_event_type
  ON domain_event (event_type);

-- ============ 平台权限：新建 public 对象须补 GRANT 给 anon_（铁律#5） ============
-- 仅授权 DML + 表级（无序列，故无需 GRANT USAGE ON SEQUENCE）；schema public 的 USAGE
-- 默认对 PUBLIC 角色开放，anon_ 继承，无需单独授予。
GRANT SELECT, INSERT, UPDATE, DELETE ON domain_event TO anon_;

-- ============ 数据字典注释 ============
COMMENT ON TABLE domain_event IS 'Wave 2-1 纯 PG 事件总线发件箱：业务写路径同步落事件，dispatcher 异步派发，解耦缓存失效/下游通知等';
COMMENT ON COLUMN domain_event.aggregate_type IS '聚合根类型，如 pricing / member / order';
COMMENT ON COLUMN domain_event.aggregate_id IS '聚合根 ID（或业务维度键，如 active 表示全局主数据）';
COMMENT ON COLUMN domain_event.event_type IS '事件类型，如 cache.invalidate / member.merged';
COMMENT ON COLUMN domain_event.payload IS '事件载荷（jsonb），由 handler 自行解释';
COMMENT ON COLUMN domain_event.status IS 'pending→processing→dispatched；失败达上限转 failed(死信)';
COMMENT ON COLUMN domain_event.attempts IS '派发重试次数';
COMMENT ON COLUMN domain_event.processing_since IS '认领时间，用于崩溃恢复（卡住>10min 复位 pending）';
COMMENT ON COLUMN domain_event.dispatched_at IS '成功派发时间';
