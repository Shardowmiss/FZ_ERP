-- 0012 物料安全库存比例 / 最小订货量持久化列
-- 支撑"逐仓 MRP + 物料级安全库存/MOQ"增强：MRP 在未显式传入 safetyStockPct / moq 时，
-- 回退到物料主数据上的默认值（每物料可单独配置），避免每次调用都靠参数透传。
-- ALTER TABLE ADD COLUMN 幂等（IF NOT EXISTS），可重复执行。

ALTER TABLE material ADD COLUMN IF NOT EXISTS safety_stock_pct numeric(9,4) NOT NULL DEFAULT 0;
ALTER TABLE material ADD COLUMN IF NOT EXISTS moq numeric(18,4) NOT NULL DEFAULT 0;

-- 索引：按安全库存/MOQ 筛选（如"需要备货且未设安全库存的物料"），可选但低成本。
CREATE INDEX IF NOT EXISTS idx_material_safety_stock_pct ON material (safety_stock_pct);
CREATE INDEX IF NOT EXISTS idx_material_moq ON material (moq);
