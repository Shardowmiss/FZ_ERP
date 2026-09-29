-- 0011 软删除：为基础资料表增加 deletedAt 列，配合 BaseCrudService 软删逻辑（无该列的表仍走硬删）。
-- 启用软删除后，删除仅置位 _deleted_at，数据可恢复；查询自动过滤已删除行。
-- ALTER TABLE ADD COLUMN 幂等（IF NOT EXISTS），可重复执行。

ALTER TABLE warehouse ADD COLUMN IF NOT EXISTS _deleted_at timestamptz;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS _deleted_at timestamptz;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS _deleted_at timestamptz;
ALTER TABLE size_group ADD COLUMN IF NOT EXISTS _deleted_at timestamptz;
ALTER TABLE color_group ADD COLUMN IF NOT EXISTS _deleted_at timestamptz;

-- 建议（后续迁移）：将含唯一约束的列改为 PARTIAL 唯一索引（WHERE _deleted_at IS NULL），
-- 以允许软删除后用相同唯一键（如 code）重建。本迁移不做，避免影响线上唯一约束行为。
