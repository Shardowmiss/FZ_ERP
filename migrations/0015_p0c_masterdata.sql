-- ============================================================================
-- 迁移 0015：P0-c 主数据治理（ERP 向 POS 对齐补齐）
--
-- 背景（见《ERP与POS一体化系统评估报告》P0-c）：
--   * POS 端已领先建立 posColor(id,name,hex) 标准颜色主数据与 posMember.storedValue；
--   * ERP 缺颜色 hex 主数据（color_group.colors 仅 {name,value}[] 且无 hex），
--     且 member 表无储值字段，导致 POS→ERP 会员储值上行回写无落点。
-- 本迁移补齐这两项，使两系统主数据对齐：
--   1) 新增 color 主数据表（含 hex），作两系统颜色权威源（下行同步至 POS posColor）。
--   2) member 表新增 stored_value（会员储值余额，单位=分），供上行回写落点。
--
-- 幂等约定：表用 CREATE TABLE IF NOT EXISTS；加列用 DO $$ 判存在；可重复执行。
-- 数据填充：颜色种子/hex 不在此迁移自动执行——ERP 现有 color_group.colors 无 hex，
--   需结合 POS posColor 已有 hex 对齐后，由运维脚本（见报告附录）幂等填充，避免脏数据。
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) 颜色主数据表（对齐 POS posColor 的 name/hex 字段契约）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS color (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(50)  NOT NULL,
  name        varchar(100) NOT NULL,
  hex         varchar(20)  NOT NULL,
  sort_order  integer      NOT NULL DEFAULT 0,
  status      varchar(20)  NOT NULL DEFAULT 'active',
  remark      text,
  -- System fields（与 ERP schema.ts customTimestamptz/userProfile 约定一致）
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by varchar(255),
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by varchar(255),
  CONSTRAINT color_code_key UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_color_status ON color (status);

-- ---------------------------------------------------------------------------
-- 2) member 表新增会员储值余额字段（对齐 POS posMember.storedValue，单位=分）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'member'
      AND column_name = 'stored_value'
  ) THEN
    ALTER TABLE member
      ADD COLUMN stored_value numeric NOT NULL DEFAULT '0';
  END IF;
END $$;

COMMIT;
