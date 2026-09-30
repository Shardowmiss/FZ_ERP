-- 0019: 业务表加 color_id / size_id 可空外键列 (B.1 / P1-2 M3)
-- 列先可空 + FK 指向 color/size 主表；历史回填(M5)后 P1-4 再收紧 NOT NULL。
-- 生产大表加索引请用 CREATE INDEX CONCURRENTLY（本迁移在 dev/小库直接建）。

ALTER TABLE omni_order_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE omni_order_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_omni_order_item_color_id ON omni_order_item (color_id);
CREATE INDEX IF NOT EXISTS idx_omni_order_item_size_id ON omni_order_item (size_id);

ALTER TABLE subcontract_receipt_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE subcontract_receipt_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_subcontract_receipt_item_color_id ON subcontract_receipt_item (color_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_receipt_item_size_id ON subcontract_receipt_item (size_id);

ALTER TABLE subcontract_order_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE subcontract_order_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_subcontract_order_item_color_id ON subcontract_order_item (color_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_order_item_size_id ON subcontract_order_item (size_id);

ALTER TABLE inventory_batch ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE inventory_batch ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_batch_color_id ON inventory_batch (color_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batch_size_id ON inventory_batch (size_id);

ALTER TABLE production_finish_receipt_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE production_finish_receipt_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_production_finish_receipt_item_color_id ON production_finish_receipt_item (color_id);
CREATE INDEX IF NOT EXISTS idx_production_finish_receipt_item_size_id ON production_finish_receipt_item (size_id);

ALTER TABLE garment_purchase_return_sku ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE garment_purchase_return_sku ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_garment_purchase_return_sku_color_id ON garment_purchase_return_sku (color_id);
CREATE INDEX IF NOT EXISTS idx_garment_purchase_return_sku_size_id ON garment_purchase_return_sku (size_id);

ALTER TABLE garment_purchase_inbound_sku ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE garment_purchase_inbound_sku ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_garment_purchase_inbound_sku_color_id ON garment_purchase_inbound_sku (color_id);
CREATE INDEX IF NOT EXISTS idx_garment_purchase_inbound_sku_size_id ON garment_purchase_inbound_sku (size_id);

ALTER TABLE garment_purchase_order_sku ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE garment_purchase_order_sku ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_garment_purchase_order_sku_color_id ON garment_purchase_order_sku (color_id);
CREATE INDEX IF NOT EXISTS idx_garment_purchase_order_sku_size_id ON garment_purchase_order_sku (size_id);

ALTER TABLE retail_order_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE retail_order_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_retail_order_item_color_id ON retail_order_item (color_id);
CREATE INDEX IF NOT EXISTS idx_retail_order_item_size_id ON retail_order_item (size_id);

ALTER TABLE allocation_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE allocation_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_allocation_item_color_id ON allocation_item (color_id);
CREATE INDEX IF NOT EXISTS idx_allocation_item_size_id ON allocation_item (size_id);

ALTER TABLE pre_order_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE pre_order_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pre_order_item_color_id ON pre_order_item (color_id);
CREATE INDEX IF NOT EXISTS idx_pre_order_item_size_id ON pre_order_item (size_id);

ALTER TABLE inventory_stocktake_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE inventory_stocktake_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_stocktake_item_color_id ON inventory_stocktake_item (color_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stocktake_item_size_id ON inventory_stocktake_item (size_id);

ALTER TABLE inventory_transfer_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE inventory_transfer_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_item_color_id ON inventory_transfer_item (color_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_item_size_id ON inventory_transfer_item (size_id);

ALTER TABLE replenish_plan_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE replenish_plan_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_replenish_plan_item_color_id ON replenish_plan_item (color_id);
CREATE INDEX IF NOT EXISTS idx_replenish_plan_item_size_id ON replenish_plan_item (size_id);

ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_stock_color_id ON inventory_stock (color_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_size_id ON inventory_stock (size_id);

ALTER TABLE inventory_flow ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE inventory_flow ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_flow_color_id ON inventory_flow (color_id);
CREATE INDEX IF NOT EXISTS idx_inventory_flow_size_id ON inventory_flow (size_id);

ALTER TABLE sales_return_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE sales_return_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_return_item_color_id ON sales_return_item (color_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_item_size_id ON sales_return_item (size_id);

ALTER TABLE sales_outbound_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE sales_outbound_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_outbound_item_color_id ON sales_outbound_item (color_id);
CREATE INDEX IF NOT EXISTS idx_sales_outbound_item_size_id ON sales_outbound_item (size_id);

ALTER TABLE sales_order_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE sales_order_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_order_item_color_id ON sales_order_item (color_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_item_size_id ON sales_order_item (size_id);

ALTER TABLE sku ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE sku ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sku_color_id ON sku (color_id);
CREATE INDEX IF NOT EXISTS idx_sku_size_id ON sku (size_id);

ALTER TABLE hangtag_print_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE hangtag_print_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hangtag_print_item_color_id ON hangtag_print_item (color_id);
CREATE INDEX IF NOT EXISTS idx_hangtag_print_item_size_id ON hangtag_print_item (size_id);

ALTER TABLE unique_code_stock ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE unique_code_stock ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_unique_code_stock_color_id ON unique_code_stock (color_id);
CREATE INDEX IF NOT EXISTS idx_unique_code_stock_size_id ON unique_code_stock (size_id);

ALTER TABLE doc_unique_code ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE doc_unique_code ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_doc_unique_code_color_id ON doc_unique_code (color_id);
CREATE INDEX IF NOT EXISTS idx_doc_unique_code_size_id ON doc_unique_code (size_id);

ALTER TABLE doc_unique_code_archive ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE doc_unique_code_archive ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_doc_unique_code_archive_color_id ON doc_unique_code_archive (color_id);
CREATE INDEX IF NOT EXISTS idx_doc_unique_code_archive_size_id ON doc_unique_code_archive (size_id);

ALTER TABLE pos_return_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE pos_return_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pos_return_item_color_id ON pos_return_item (color_id);
CREATE INDEX IF NOT EXISTS idx_pos_return_item_size_id ON pos_return_item (size_id);

ALTER TABLE pos_requisition_item ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES color (id) ON DELETE SET NULL;
ALTER TABLE pos_requisition_item ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES size (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pos_requisition_item_color_id ON pos_requisition_item (color_id);
CREATE INDEX IF NOT EXISTS idx_pos_requisition_item_size_id ON pos_requisition_item (size_id);
