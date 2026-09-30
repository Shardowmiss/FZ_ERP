-- P1-2 / M5 历史回填脚本 (B.1 颜色尺码双轨统一) — 幂等、可回滚
-- 策略：bootstrap 主数据（每不同原始串一条，hex 用占位 '#000000'，待 curation 补全真实色值）
--        再按精确匹配回填 color_id/size_id（仅更新 NULL 行）。回滚：SET color_id=NULL,size_id=NULL + truncate color/size。

-- 0) bootstrap 主数据
INSERT INTO color (id, code, name, hex)
SELECT gen_random_uuid(), raw, raw, '#000000' FROM (
  SELECT DISTINCT color AS raw FROM (
    SELECT color FROM omni_order_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM subcontract_receipt_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM subcontract_order_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM inventory_batch WHERE color IS NOT NULL
    UNION ALL SELECT color FROM production_finish_receipt_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM garment_purchase_return_sku WHERE color IS NOT NULL
    UNION ALL SELECT color FROM garment_purchase_inbound_sku WHERE color IS NOT NULL
    UNION ALL SELECT color FROM garment_purchase_order_sku WHERE color IS NOT NULL
    UNION ALL SELECT color FROM retail_order_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM allocation_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM pre_order_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM inventory_stocktake_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM inventory_transfer_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM replenish_plan_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM inventory_stock WHERE color IS NOT NULL
    UNION ALL SELECT color FROM inventory_flow WHERE color IS NOT NULL
    UNION ALL SELECT color FROM sales_return_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM sales_outbound_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM sales_order_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM sku WHERE color IS NOT NULL
    UNION ALL SELECT color FROM hangtag_print_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM unique_code_stock WHERE color IS NOT NULL
    UNION ALL SELECT color FROM doc_unique_code WHERE color IS NOT NULL
    UNION ALL SELECT color FROM doc_unique_code_archive WHERE color IS NOT NULL
    UNION ALL SELECT color FROM pos_return_item WHERE color IS NOT NULL
    UNION ALL SELECT color FROM pos_requisition_item WHERE color IS NOT NULL
  ) s WHERE color IS NOT NULL
) d WHERE NOT EXISTS (SELECT 1 FROM color c WHERE c.name = d.raw);

INSERT INTO size (id, code, name)
SELECT gen_random_uuid(), raw, raw FROM (
  SELECT DISTINCT size AS raw FROM (
    SELECT size FROM omni_order_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM subcontract_receipt_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM subcontract_order_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM inventory_batch WHERE size IS NOT NULL
    UNION ALL SELECT size FROM production_finish_receipt_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM garment_purchase_return_sku WHERE size IS NOT NULL
    UNION ALL SELECT size FROM garment_purchase_inbound_sku WHERE size IS NOT NULL
    UNION ALL SELECT size FROM garment_purchase_order_sku WHERE size IS NOT NULL
    UNION ALL SELECT size FROM retail_order_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM allocation_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM pre_order_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM inventory_stocktake_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM inventory_transfer_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM replenish_plan_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM inventory_stock WHERE size IS NOT NULL
    UNION ALL SELECT size FROM inventory_flow WHERE size IS NOT NULL
    UNION ALL SELECT size FROM sales_return_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM sales_outbound_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM sales_order_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM sku WHERE size IS NOT NULL
    UNION ALL SELECT size FROM hangtag_print_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM unique_code_stock WHERE size IS NOT NULL
    UNION ALL SELECT size FROM doc_unique_code WHERE size IS NOT NULL
    UNION ALL SELECT size FROM doc_unique_code_archive WHERE size IS NOT NULL
    UNION ALL SELECT size FROM pos_return_item WHERE size IS NOT NULL
    UNION ALL SELECT size FROM pos_requisition_item WHERE size IS NOT NULL
  ) s WHERE size IS NOT NULL
) d WHERE NOT EXISTS (SELECT 1 FROM size z WHERE z.name = d.raw);

-- 1) 逐表回填（精确匹配 name）
UPDATE omni_order_item SET color_id = (SELECT c.id FROM color c WHERE c.name = omni_order_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE omni_order_item SET size_id = (SELECT z.id FROM size z WHERE z.name = omni_order_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE subcontract_receipt_item SET color_id = (SELECT c.id FROM color c WHERE c.name = subcontract_receipt_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE subcontract_receipt_item SET size_id = (SELECT z.id FROM size z WHERE z.name = subcontract_receipt_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE subcontract_order_item SET color_id = (SELECT c.id FROM color c WHERE c.name = subcontract_order_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE subcontract_order_item SET size_id = (SELECT z.id FROM size z WHERE z.name = subcontract_order_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE inventory_batch SET color_id = (SELECT c.id FROM color c WHERE c.name = inventory_batch.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE inventory_batch SET size_id = (SELECT z.id FROM size z WHERE z.name = inventory_batch.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE production_finish_receipt_item SET color_id = (SELECT c.id FROM color c WHERE c.name = production_finish_receipt_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE production_finish_receipt_item SET size_id = (SELECT z.id FROM size z WHERE z.name = production_finish_receipt_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE garment_purchase_return_sku SET color_id = (SELECT c.id FROM color c WHERE c.name = garment_purchase_return_sku.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE garment_purchase_return_sku SET size_id = (SELECT z.id FROM size z WHERE z.name = garment_purchase_return_sku.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE garment_purchase_inbound_sku SET color_id = (SELECT c.id FROM color c WHERE c.name = garment_purchase_inbound_sku.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE garment_purchase_inbound_sku SET size_id = (SELECT z.id FROM size z WHERE z.name = garment_purchase_inbound_sku.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE garment_purchase_order_sku SET color_id = (SELECT c.id FROM color c WHERE c.name = garment_purchase_order_sku.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE garment_purchase_order_sku SET size_id = (SELECT z.id FROM size z WHERE z.name = garment_purchase_order_sku.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE retail_order_item SET color_id = (SELECT c.id FROM color c WHERE c.name = retail_order_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE retail_order_item SET size_id = (SELECT z.id FROM size z WHERE z.name = retail_order_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE allocation_item SET color_id = (SELECT c.id FROM color c WHERE c.name = allocation_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE allocation_item SET size_id = (SELECT z.id FROM size z WHERE z.name = allocation_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE pre_order_item SET color_id = (SELECT c.id FROM color c WHERE c.name = pre_order_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE pre_order_item SET size_id = (SELECT z.id FROM size z WHERE z.name = pre_order_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE inventory_stocktake_item SET color_id = (SELECT c.id FROM color c WHERE c.name = inventory_stocktake_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE inventory_stocktake_item SET size_id = (SELECT z.id FROM size z WHERE z.name = inventory_stocktake_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE inventory_transfer_item SET color_id = (SELECT c.id FROM color c WHERE c.name = inventory_transfer_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE inventory_transfer_item SET size_id = (SELECT z.id FROM size z WHERE z.name = inventory_transfer_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE replenish_plan_item SET color_id = (SELECT c.id FROM color c WHERE c.name = replenish_plan_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE replenish_plan_item SET size_id = (SELECT z.id FROM size z WHERE z.name = replenish_plan_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE inventory_stock SET color_id = (SELECT c.id FROM color c WHERE c.name = inventory_stock.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE inventory_stock SET size_id = (SELECT z.id FROM size z WHERE z.name = inventory_stock.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE inventory_flow SET color_id = (SELECT c.id FROM color c WHERE c.name = inventory_flow.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE inventory_flow SET size_id = (SELECT z.id FROM size z WHERE z.name = inventory_flow.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE sales_return_item SET color_id = (SELECT c.id FROM color c WHERE c.name = sales_return_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE sales_return_item SET size_id = (SELECT z.id FROM size z WHERE z.name = sales_return_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE sales_outbound_item SET color_id = (SELECT c.id FROM color c WHERE c.name = sales_outbound_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE sales_outbound_item SET size_id = (SELECT z.id FROM size z WHERE z.name = sales_outbound_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE sales_order_item SET color_id = (SELECT c.id FROM color c WHERE c.name = sales_order_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE sales_order_item SET size_id = (SELECT z.id FROM size z WHERE z.name = sales_order_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE sku SET color_id = (SELECT c.id FROM color c WHERE c.name = sku.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE sku SET size_id = (SELECT z.id FROM size z WHERE z.name = sku.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE hangtag_print_item SET color_id = (SELECT c.id FROM color c WHERE c.name = hangtag_print_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE hangtag_print_item SET size_id = (SELECT z.id FROM size z WHERE z.name = hangtag_print_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE unique_code_stock SET color_id = (SELECT c.id FROM color c WHERE c.name = unique_code_stock.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE unique_code_stock SET size_id = (SELECT z.id FROM size z WHERE z.name = unique_code_stock.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE doc_unique_code SET color_id = (SELECT c.id FROM color c WHERE c.name = doc_unique_code.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE doc_unique_code SET size_id = (SELECT z.id FROM size z WHERE z.name = doc_unique_code.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE doc_unique_code_archive SET color_id = (SELECT c.id FROM color c WHERE c.name = doc_unique_code_archive.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE doc_unique_code_archive SET size_id = (SELECT z.id FROM size z WHERE z.name = doc_unique_code_archive.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE pos_return_item SET color_id = (SELECT c.id FROM color c WHERE c.name = pos_return_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE pos_return_item SET size_id = (SELECT z.id FROM size z WHERE z.name = pos_return_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

UPDATE pos_requisition_item SET color_id = (SELECT c.id FROM color c WHERE c.name = pos_requisition_item.color LIMIT 1) WHERE color_id IS NULL AND color IS NOT NULL;
UPDATE pos_requisition_item SET size_id = (SELECT z.id FROM size z WHERE z.name = pos_requisition_item.size LIMIT 1) WHERE size_id IS NULL AND size IS NOT NULL;

-- 2) 回填后校验 SQL（应全 0）：有值却没映射的脏行
-- SELECT count(*) FROM omni_order_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM subcontract_receipt_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM subcontract_order_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM inventory_batch WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM production_finish_receipt_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM garment_purchase_return_sku WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM garment_purchase_inbound_sku WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM garment_purchase_order_sku WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM retail_order_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM allocation_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM pre_order_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM inventory_stocktake_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM inventory_transfer_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM replenish_plan_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM inventory_stock WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM inventory_flow WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM sales_return_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM sales_outbound_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM sales_order_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM sku WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM hangtag_print_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM unique_code_stock WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM doc_unique_code WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM doc_unique_code_archive WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM pos_return_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);
-- SELECT count(*) FROM pos_requisition_item WHERE (color IS NOT NULL AND color_id IS NULL) OR (size IS NOT NULL AND size_id IS NULL);