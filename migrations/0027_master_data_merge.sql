-- 0027 通用主数据合并引擎（3b/3c）：style / customer 合并打标列 + master_data_merge_log 审计表
--
-- 背景：P0-3 会员合并（迁移 0025）已落地"被合并方绝不删除，仅打标 + 改指依赖 + 审计回滚"。
--   本迁移把同一范式**泛化**到"商品(style)"与"客户(customer)"主数据去重合并：
--     · 被合并方**绝不删除**（style/customer 的从表外键均为 RESTRICT/NO ACTION，删除被 FK 阻止；
--       且历史业务依赖这些主数据，删除破坏历史）—— 合并只改指依赖行到 survivor + 打标。
--     · 与 member 不同：style/customer **无资金/积分列**，合并不涉及资金迁移（更简单、更安全的子集）。
--     · 依赖改指范围 = 实时从属于该主数据的业务表（sku/bom/工单/采购明细/配货/预购 等；
--       客户侧 = 对账/收款/退货/出库/应收/订单）。历史交易行项目（retail_order_item 等仅存 style_no
--       字符串副本）**不改指**，因其是历史快照，且一致性校验域(product/member/price)不覆盖
--       style/customer，不会引起误报。
--     · 回滚 = 解除打标（不回指历史归属，与 member 一致：survivor 已拥有的依赖归属保持不变）。
--
-- 幂等：可重复执行（IF NOT EXISTS / 条件 ALTER / DO BLOCK 条件建约束 / 无害 GRANT）。

-- ============ 1) style 加合并打标列 + 自愈引用 FK + 索引 ============
ALTER TABLE style ADD COLUMN IF NOT EXISTS merged_into uuid;
ALTER TABLE style ADD COLUMN IF NOT EXISTS merged_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'style_merged_into_fkey'
  ) THEN
    ALTER TABLE style ADD CONSTRAINT style_merged_into_fkey
      FOREIGN KEY (merged_into) REFERENCES style(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_style_merged_into ON style (merged_into);

-- ============ 2) customer 加合并打标列 + 自愈引用 FK + 索引 ============
ALTER TABLE customer ADD COLUMN IF NOT EXISTS merged_into uuid;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS merged_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_merged_into_fkey'
  ) THEN
    ALTER TABLE customer ADD CONSTRAINT customer_merged_into_fkey
      FOREIGN KEY (merged_into) REFERENCES customer(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_merged_into ON customer (merged_into);

-- ============ 3) 通用合并审计/回滚日志表（按 entity_type 区分 style/customer；未来 store 复用） ============
CREATE TABLE IF NOT EXISTS master_data_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type varchar(20) NOT NULL,
  run_id varchar(40) NOT NULL,
  survivor_id uuid NOT NULL,
  merged_id uuid NOT NULL,
  merged_code varchar(50),
  merged_name varchar(200),
  reason text,
  operator varchar(64),
  reversed_at timestamptz,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);

-- ============ 4) 索引 + 唯一约束（run_id + merged_id 防同批重复记录） ============
CREATE INDEX IF NOT EXISTS idx_master_data_merge_log_entity ON master_data_merge_log (entity_type);
CREATE INDEX IF NOT EXISTS idx_master_data_merge_log_run ON master_data_merge_log (run_id);
CREATE INDEX IF NOT EXISTS idx_master_data_merge_log_survivor ON master_data_merge_log (survivor_id);
CREATE INDEX IF NOT EXISTS idx_master_data_merge_log_merged ON master_data_merge_log (merged_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_master_data_merge_log_run_merged
  ON master_data_merge_log (run_id, merged_id);

-- ============ 5) 平台权限：新 public 对象须补 GRANT 给 anon_ ============
GRANT SELECT, INSERT, UPDATE, DELETE ON master_data_merge_log TO anon_;

-- ============ 6) 数据字典注释 ============
COMMENT ON COLUMN style.merged_into IS 'P0-3 泛化合并（3b/3c）：被合并款式指向存活方 style.id（绝不删除被合并款式，仅打标）';
COMMENT ON COLUMN style.merged_at IS 'P0-3 泛化合并：合并时间';
COMMENT ON COLUMN customer.merged_into IS 'P0-3 泛化合并（3b/3c）：被合并客户指向存活方 customer.id（绝不删除被合并客户，仅打标）';
COMMENT ON COLUMN customer.merged_at IS 'P0-3 泛化合并：合并时间';
COMMENT ON TABLE master_data_merge_log IS '通用主数据合并审计/回滚日志：记录 entity_type(style|customer) 谁合并进谁、操作人、原因，供 reverse() 回滚';
COMMENT ON COLUMN master_data_merge_log.entity_type IS '主数据实体类型：style / customer（未来 store）';
COMMENT ON COLUMN master_data_merge_log.reversed_at IS 'reverse() 成功回滚后置位，避免重复回滚';
