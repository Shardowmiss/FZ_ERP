-- 0035 库存模块增强支撑：SKU库存金额列 / 流水业务日期 / sku 成本价补列
-- 配套 schema.ts 变更：
--   1) inventory_stock 增加 unit_price / amount（盘点记账时按成本价修正金额）
--   2) inventory_flow 增加 biz_date（单据业务日期，独立于 _created_at 的过账日期）
--   3) sku.cost_price 已在 schema 声明但历史从未迁移到 erp_db（schema/DB 漂移），此处补齐

-- 1) SKU 库存金额列（默认 0；金额由盘点记账按成本价回填，其他出入库暂不维护，符合本期范围）
ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT 0;
ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT 0;

-- 2) 流水业务日期：新流水默认取过账日期；历史行回填为原创建日期
ALTER TABLE inventory_flow ADD COLUMN IF NOT EXISTS biz_date date DEFAULT CURRENT_DATE;
UPDATE inventory_flow SET biz_date = DATE(_created_at) WHERE biz_date IS NULL;

-- 3) sku 成本价补列（历史行默认 0，需业务侧维护真实成本）
ALTER TABLE sku ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0;
