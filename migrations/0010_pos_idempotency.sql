-- 0010 POS 收银幂等表
-- 用途：拦截收银结算（pos_checkout）的并发重复提交与网络重试造成的重复零售单 + 重复扣库存。
--       复合唯一约束 (key, biz_type) 在并发占位时由数据库拦截（23505），串行化同一 key 的多次请求。
-- 全部使用 IF NOT EXISTS / DO $$ 幂等写法，可重复执行。

CREATE TABLE IF NOT EXISTS pos_idempotency (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         varchar(120) NOT NULL,
  biz_type    varchar(40)  NOT NULL,
  status      varchar(20)  NOT NULL DEFAULT 'processing',  -- processing | done | error
  result      jsonb,                                   -- done 时回填业务结果，供重试直接返回
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_idempotency_key_uniq
  ON pos_idempotency (key, biz_type);

CREATE INDEX IF NOT EXISTS idx_pos_idempotency_status
  ON pos_idempotency (status);
