-- 0004 POS 班次与零售单关联 + 交班对账优化
-- 目标：将零售单关联到具体收银班次，使交班时的现金对账精准（不再按门店+时间窗口粗略统计）。

-- 1. retail_order 增加 pos_session_id，关联收银班次
ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS pos_session_id uuid;

-- 2. 外键：班次被删除时置空（保留零售财务记录完整性）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retail_order_pos_session_id_fkey'
  ) THEN
    ALTER TABLE retail_order
      ADD CONSTRAINT retail_order_pos_session_id_fkey
      FOREIGN KEY (pos_session_id) REFERENCES pos_session (id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. 索引：按班次查零售单
CREATE INDEX IF NOT EXISTS idx_retail_order_session ON retail_order (pos_session_id);

-- 4. pos_session 复合索引：加速“按门店查未关班次”查询
CREATE INDEX IF NOT EXISTS idx_pos_session_store_status ON pos_session (store_id, status);
