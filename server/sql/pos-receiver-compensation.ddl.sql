-- P1-4 上行失败补偿机制：pos_receive_log 扩展 + 权限码注册
-- 注意：本仓库 DB 无法从迁移重建，所有变更直接对 erp_db 增量执行。

-- 1) 扩展 pos_receive_log：存储原始 payload（用于重放）+ 失败原因
ALTER TABLE pos_receive_log
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS error_message text;
CREATE INDEX IF NOT EXISTS idx_pos_receive_log_status ON pos_receive_log (status);

-- 2) 注册补偿管理权限码，并授予 super_admin（id 固定 11111111-1111-1111-1111-111111111111）
--    与既有 rbac_permission 主键风格一致：id 用 uuid（此处用固定前缀占位，ensureRbacCatalog 也会幂等补登）
INSERT INTO rbac_permission (code, name, type, _created_at)
VALUES ('pos:receiver:manage', 'POS接收-补偿管理', 'api', now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac_role_permission (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111111', id
FROM rbac_permission WHERE code = 'pos:receiver:manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
