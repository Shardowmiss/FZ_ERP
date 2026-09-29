-- 0007 分销门户：用户 ↔ 分销伙伴（经销商）映射
-- 用途：将登录用户绑定到一个或多个分销节点（dealer），
--       门户据此按节点子树过滤“我的采购单 / 我的采购退货单”。
-- 全部使用 IF NOT EXISTS / DO $$ 幂等写法，可重复执行。

CREATE TABLE IF NOT EXISTS rbac_user_partner (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  partner_id  uuid NOT NULL,                 -- 指向 dealer.id（分销节点）
  role        varchar(20) NOT NULL DEFAULT 'viewer',  -- owner / viewer
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by varchar(100),
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by varchar(100),
  CONSTRAINT uk_rbac_user_partner UNIQUE (user_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_partner_user
  ON rbac_user_partner (user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_partner_partner
  ON rbac_user_partner (partner_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rbac_user_partner_user_id_fkey'
  ) THEN
    ALTER TABLE rbac_user_partner
      ADD CONSTRAINT rbac_user_partner_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES rbac_user (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rbac_user_partner_partner_id_fkey'
  ) THEN
    ALTER TABLE rbac_user_partner
      ADD CONSTRAINT rbac_user_partner_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES dealer (id) ON DELETE CASCADE;
  END IF;
END $$;
