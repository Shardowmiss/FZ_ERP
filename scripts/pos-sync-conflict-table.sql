-- W2-3：离线冲突收件箱建表脚本（幂等，本地真库验证用）
-- ---------------------------------------------------------------------------
-- 此脚本仅为「本地快速在真实 PostgreSQL 上建出 pos_sync_conflict 表」提供便利，
-- 生产环境的权威建表由平台 db-schema-sync（读 server/database/schema.ts）完成，
-- 单测底座由 server/test-utils/pglite.ts 完成。三处必须保持一致（改 schema 三处同步铁律）。
--
-- 用法：
--   psql "$DATABASE_URL" -f scripts/pos-sync-conflict-table.sql
--   # 或
--   node scripts/apply-pos-indexes.cjs   # 该脚本已含本表的两个查询索引
--
-- 注意：_created_by / _updated_by / _resolved_by 使用平台复合类型 user_profile，
-- 与 schema.ts 的 userProfile 自定义类型一一对应；本地库须已存在该类型
--（平台库默认具备，纯空库需先 CREATE TYPE user_profile AS (user_id text)）。

CREATE TABLE IF NOT EXISTS pos_sync_conflict (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar(50),
  entity_type varchar(20) NOT NULL DEFAULT 'member',
  entity_id uuid NOT NULL,
  field varchar(50) NOT NULL,
  pos_value jsonb,
  erp_value jsonb,
  pos_ts timestamptz,
  erp_ts timestamptz,
  status varchar(20) NOT NULL DEFAULT 'pending',
  resolution varchar(10),
  _resolved_by user_profile DEFAULT NULL,
  resolved_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- 仲裁台列表热路径：按状态取待办 + 时间序
CREATE INDEX IF NOT EXISTS idx_pos_sync_conflict_status ON pos_sync_conflict (status, _created_at);
-- 按实体聚合冲突（某会员的全部字段冲突）
CREATE INDEX IF NOT EXISTS idx_pos_sync_conflict_entity ON pos_sync_conflict (entity_type, entity_id);

-- 平台以 SET ROLE anon_ 执行查询：新建 public 对象须补授权，否则 42501。
-- （重复执行 GRANT 幂等，无副作用；若本地库无 anon_ 角色，可忽略这两行。）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon_') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pos_sync_conflict TO anon_';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE pos_sync_conflict_id_seq TO anon_';
  END IF;
END $$;
