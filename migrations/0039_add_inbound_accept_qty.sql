-- 0039 采购入库单明细增加「验收数量」与「SKU 货号」列，支撑审核前编辑与扫码验收。
-- 背景：
--   1) 采购入库单需支持仓库扫码录入实际到货数量（验收数量 accepted_qty），
--      验收环节按该值真正增减库存、生成应付、回写订单已收数量；
--   2) 明细需要冗余 sku_code，供扫码识别款式/颜色/尺码与明细展示。
-- garment_purchase_inbound_sku 当前可能已有数据，两列均带默认值，可安全加列。
-- 权限：anon_ 已对该表持有表级 SELECT（建表迁移已授权），新增列自动继承，无需重复 GRANT。
BEGIN;

ALTER TABLE garment_purchase_inbound_sku ADD COLUMN IF NOT EXISTS accepted_qty numeric NOT NULL DEFAULT 0;
ALTER TABLE garment_purchase_inbound_sku ADD COLUMN IF NOT EXISTS sku_code varchar(100);

COMMIT;
