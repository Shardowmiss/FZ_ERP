-- 0032 款号新增「编码规则」字段（四大改造 C）
--
-- 在 style 表新增 code_rule_id，关联 code_rule(id)。
-- 允许为空（ON DELETE SET NULL）：删除编码规则时款号不被级联删除，仅解除关联。
--
-- 幂等：可重复执行（ADD COLUMN IF NOT EXISTS + 约束存在性判断）。

BEGIN;

-- ============ 1) 新增列 ============
ALTER TABLE style ADD COLUMN IF NOT EXISTS code_rule_id uuid;

-- ============ 2) 外键（存在性判断，避免重复执行报错） ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'style_code_rule_id_fkey'
  ) THEN
    ALTER TABLE style
      ADD CONSTRAINT style_code_rule_id_fkey
      FOREIGN KEY (code_rule_id) REFERENCES code_rule(id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;
