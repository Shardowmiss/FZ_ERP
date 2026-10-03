-- 0030 会员表增强：新增 email + 软删除 _deleted_at
--
-- 背景：
--   1) #10 会员管理需要维护「邮箱」字段。
--   2) 会员删除必须走软删：member.status 的 CHECK 约束不含 'deleted'，
--      且 member_wallet_event / member_point 均 onDelete cascade，硬删会级联清空钱包流水（资金事故）。
--      因此新增 _deleted_at 列，删除仅置位时间戳，list 过滤 IS NULL。
--
-- 幂等：可重复执行（ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / 无害 GRANT）。

BEGIN;

-- ============ 1) 新增列 ============
ALTER TABLE member ADD COLUMN IF NOT EXISTS email        varchar(255);
ALTER TABLE member ADD COLUMN IF NOT EXISTS _deleted_at timestamptz(3);

-- ============ 2) 软删过滤索引（仅未删除行，加速 list） ============
CREATE INDEX IF NOT EXISTS idx_member_not_deleted
  ON member (_deleted_at) WHERE _deleted_at IS NULL;

-- ============ 3) 授权 anon_（列随表级特权自动覆盖；此处幂等补登，防历史遗漏） ============
GRANT USAGE ON SCHEMA public TO anon_;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE member TO anon_;
GRANT USAGE ON TYPE user_profile TO anon_;

COMMIT;
