-- =============================================================================
-- 服装ERP 数据质量治理（P1-④）：枚举约束
-- 目标：
--   Tier1 对枚举型列（flowType/direction/itemType/submitterType/bizType/docType/
--         type/source）按"代码候选值 ∪ dev 实测值"精确白名单加 CHECK 约束；
--   Tier2 对全部 58 个 status 列加共享联合白名单安全网（挡垃圾值/注入，含 ongoing）。
-- 全部幂等（DO $$ 判存在性后添加），可重复执行。
-- 数据兼容性：dev 库探针已确认现状数据全部合规，可安全 ALTER。
-- 注意：ALTER ADD CONSTRAINT 取 ACCESS EXCLUSIVE 锁并校验全表，建议在低峰期执行；
--       超大表可改为 NOT VALID + 后续 VALIDATE CONSTRAINT 以降低锁时长。
-- =============================================================================

BEGIN;

-- ---------- Tier1：枚举族逐表精确 CHECK ----------
-- inventory_flow.flow_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_flow_flow_type') THEN
    ALTER TABLE inventory_flow
      ADD CONSTRAINT ck_inventory_flow_flow_type
      CHECK (flow_type IN ('finish_in', 'garment_purchase_inbound', 'garment_purchase_return', 'out', 'production_inbound', 'production_issue', 'production_outbound', 'purchase_inbound', 'purchase_return', 'retail_outbound', 'retail_return_in', 'sales_outbound', 'sales_return', 'stocktake_adjust', 'subcontract_issue', 'subcontract_receipt', 'transfer_in', 'transfer_in_complete', 'transfer_in_transit', 'transfer_out'));
  END IF;
END $$;

-- month_close_detail.flow_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_month_close_detail_flow_type') THEN
    ALTER TABLE month_close_detail
      ADD CONSTRAINT ck_month_close_detail_flow_type
      CHECK (flow_type IN ('finish_in', 'garment_purchase_inbound', 'garment_purchase_return', 'out', 'production_inbound', 'production_issue', 'production_outbound', 'purchase_inbound', 'purchase_return', 'retail_outbound', 'retail_return_in', 'sales_outbound', 'sales_return', 'stocktake_adjust', 'subcontract_issue', 'subcontract_receipt', 'transfer_in', 'transfer_in_complete', 'transfer_in_transit', 'transfer_out'));
  END IF;
END $$;

-- inventory_flow.direction
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_flow_direction') THEN
    ALTER TABLE inventory_flow
      ADD CONSTRAINT ck_inventory_flow_direction
      CHECK (direction IN ('in', 'out', 'inbound'));
  END IF;
END $$;

-- inventory_stocktake.item_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_stocktake_item_type') THEN
    ALTER TABLE inventory_stocktake
      ADD CONSTRAINT ck_inventory_stocktake_item_type
      CHECK (item_type IN ('sku', 'material'));
  END IF;
END $$;

-- inventory_transfer.item_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_transfer_item_type') THEN
    ALTER TABLE inventory_transfer
      ADD CONSTRAINT ck_inventory_transfer_item_type
      CHECK (item_type IN ('sku', 'material'));
  END IF;
END $$;

-- inventory_flow.item_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_flow_item_type') THEN
    ALTER TABLE inventory_flow
      ADD CONSTRAINT ck_inventory_flow_item_type
      CHECK (item_type IN ('sku', 'material'));
  END IF;
END $$;

-- allocation_item.submitter_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_allocation_item_submitter_type') THEN
    ALTER TABLE allocation_item
      ADD CONSTRAINT ck_allocation_item_submitter_type
      CHECK (submitter_type IN ('dealer', 'direct'));
  END IF;
END $$;

-- pre_order.submitter_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pre_order_submitter_type') THEN
    ALTER TABLE pre_order
      ADD CONSTRAINT ck_pre_order_submitter_type
      CHECK (submitter_type IN ('dealer', 'direct'));
  END IF;
END $$;

-- payable.biz_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_payable_biz_type') THEN
    ALTER TABLE payable
      ADD CONSTRAINT ck_payable_biz_type
      CHECK (biz_type IN ('garment_purchase_inbound', 'material_purchase_inbound', 'purchase_inbound', 'sales_outbound', 'subcontract_fee', 'pos_checkout'));
  END IF;
END $$;

-- receivable.biz_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_receivable_biz_type') THEN
    ALTER TABLE receivable
      ADD CONSTRAINT ck_receivable_biz_type
      CHECK (biz_type IN ('garment_purchase_inbound', 'material_purchase_inbound', 'purchase_inbound', 'sales_outbound', 'subcontract_fee', 'pos_checkout'));
  END IF;
END $$;

-- pos_idempotency.biz_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pos_idempotency_biz_type') THEN
    ALTER TABLE pos_idempotency
      ADD CONSTRAINT ck_pos_idempotency_biz_type
      CHECK (biz_type IN ('garment_purchase_inbound', 'material_purchase_inbound', 'purchase_inbound', 'sales_outbound', 'subcontract_fee', 'pos_checkout'));
  END IF;
END $$;

-- doc_unique_code.doc_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_doc_unique_code_doc_type') THEN
    ALTER TABLE doc_unique_code
      ADD CONSTRAINT ck_doc_unique_code_doc_type
      CHECK (doc_type IN ('retail', 'sales', 'transfer'));
  END IF;
END $$;

-- doc_unique_code_archive.doc_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_doc_unique_code_archive_doc_type') THEN
    ALTER TABLE doc_unique_code_archive
      ADD CONSTRAINT ck_doc_unique_code_archive_doc_type
      CHECK (doc_type IN ('retail', 'sales', 'transfer'));
  END IF;
END $$;

-- rbac_permission.type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rbac_permission_type') THEN
    ALTER TABLE rbac_permission
      ADD CONSTRAINT ck_rbac_permission_type
      CHECK (type IN ('api', 'menu', 'button', 'data', 'group', 'catalog'));
  END IF;
END $$;

-- warehouse.type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_warehouse_type') THEN
    ALTER TABLE warehouse
      ADD CONSTRAINT ck_warehouse_type
      CHECK (type IN ('dealer', 'finished', 'main', 'self', 'store'));
  END IF;
END $$;

-- price_list.type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_price_list_type') THEN
    ALTER TABLE price_list
      ADD CONSTRAINT ck_price_list_type
      CHECK (type IN ('store', 'system', 'global', 'channel'));
  END IF;
END $$;

-- promotion.type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_promotion_type') THEN
    ALTER TABLE promotion
      ADD CONSTRAINT ck_promotion_type
      CHECK (type IN ('full_reduction', 'discount'));
  END IF;
END $$;

-- coupon.type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_coupon_type') THEN
    ALTER TABLE coupon
      ADD CONSTRAINT ck_coupon_type
      CHECK (type IN ('full_reduction', 'cash', 'discount'));
  END IF;
END $$;

-- retail_order.source
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_retail_order_source') THEN
    ALTER TABLE retail_order
      ADD CONSTRAINT ck_retail_order_source
      CHECK (source IN ('pos', 'store_pos', 'outbound', 'manual', 'system'));
  END IF;
END $$;

-- ---------- Tier2：status 共享联合白名单安全网（58 列）----------
-- member.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_member_status') THEN
    ALTER TABLE member
      ADD CONSTRAINT ck_member_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- omni_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_omni_order_status') THEN
    ALTER TABLE omni_order
      ADD CONSTRAINT ck_omni_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- sales_channel.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sales_channel_status') THEN
    ALTER TABLE sales_channel
      ADD CONSTRAINT ck_sales_channel_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- subcontract_fee.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_subcontract_fee_status') THEN
    ALTER TABLE subcontract_fee
      ADD CONSTRAINT ck_subcontract_fee_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- subcontract_receipt.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_subcontract_receipt_status') THEN
    ALTER TABLE subcontract_receipt
      ADD CONSTRAINT ck_subcontract_receipt_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- subcontract_issue.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_subcontract_issue_status') THEN
    ALTER TABLE subcontract_issue
      ADD CONSTRAINT ck_subcontract_issue_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- subcontract_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_subcontract_order_status') THEN
    ALTER TABLE subcontract_order
      ADD CONSTRAINT ck_subcontract_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- inventory_batch.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_batch_status') THEN
    ALTER TABLE inventory_batch
      ADD CONSTRAINT ck_inventory_batch_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- style_attr_value.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_style_attr_value_status') THEN
    ALTER TABLE style_attr_value
      ADD CONSTRAINT ck_style_attr_value_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- style_attr_def.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_style_attr_def_status') THEN
    ALTER TABLE style_attr_def
      ADD CONSTRAINT ck_style_attr_def_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- sales_reconciliation.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sales_reconciliation_status') THEN
    ALTER TABLE sales_reconciliation
      ADD CONSTRAINT ck_sales_reconciliation_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- purchase_reconciliation.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchase_reconciliation_status') THEN
    ALTER TABLE purchase_reconciliation
      ADD CONSTRAINT ck_purchase_reconciliation_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- finance_payment.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_payment_status') THEN
    ALTER TABLE finance_payment
      ADD CONSTRAINT ck_finance_payment_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- finance_receipt.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_receipt_status') THEN
    ALTER TABLE finance_receipt
      ADD CONSTRAINT ck_finance_receipt_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- production_finish_receipt.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_production_finish_receipt_status') THEN
    ALTER TABLE production_finish_receipt
      ADD CONSTRAINT ck_production_finish_receipt_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- production_material_issue.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_production_material_issue_status') THEN
    ALTER TABLE production_material_issue
      ADD CONSTRAINT ck_production_material_issue_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- production_work_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_production_work_order_status') THEN
    ALTER TABLE production_work_order
      ADD CONSTRAINT ck_production_work_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- material_purchase_inbound.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_material_purchase_inbound_status') THEN
    ALTER TABLE material_purchase_inbound
      ADD CONSTRAINT ck_material_purchase_inbound_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- material_purchase_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_material_purchase_order_status') THEN
    ALTER TABLE material_purchase_order
      ADD CONSTRAINT ck_material_purchase_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- garment_purchase_return.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_garment_purchase_return_status') THEN
    ALTER TABLE garment_purchase_return
      ADD CONSTRAINT ck_garment_purchase_return_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- garment_purchase_inbound.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_garment_purchase_inbound_status') THEN
    ALTER TABLE garment_purchase_inbound
      ADD CONSTRAINT ck_garment_purchase_inbound_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- garment_purchase_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_garment_purchase_order_status') THEN
    ALTER TABLE garment_purchase_order
      ADD CONSTRAINT ck_garment_purchase_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- rbac_role.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rbac_role_status') THEN
    ALTER TABLE rbac_role
      ADD CONSTRAINT ck_rbac_role_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- rbac_user.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rbac_user_status') THEN
    ALTER TABLE rbac_user
      ADD CONSTRAINT ck_rbac_user_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- month_close.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_month_close_status') THEN
    ALTER TABLE month_close
      ADD CONSTRAINT ck_month_close_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- retail_return.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_retail_return_status') THEN
    ALTER TABLE retail_return
      ADD CONSTRAINT ck_retail_return_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- retail_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_retail_order_status') THEN
    ALTER TABLE retail_order
      ADD CONSTRAINT ck_retail_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- allocation_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_allocation_order_status') THEN
    ALTER TABLE allocation_order
      ADD CONSTRAINT ck_allocation_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- pre_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pre_order_status') THEN
    ALTER TABLE pre_order
      ADD CONSTRAINT ck_pre_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- trade_show.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_trade_show_status') THEN
    ALTER TABLE trade_show
      ADD CONSTRAINT ck_trade_show_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- store.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_store_status') THEN
    ALTER TABLE store
      ADD CONSTRAINT ck_store_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- dealer.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dealer_status') THEN
    ALTER TABLE dealer
      ADD CONSTRAINT ck_dealer_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- style_attribute.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_style_attribute_status') THEN
    ALTER TABLE style_attribute
      ADD CONSTRAINT ck_style_attribute_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- payable.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_payable_status') THEN
    ALTER TABLE payable
      ADD CONSTRAINT ck_payable_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- receivable.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_receivable_status') THEN
    ALTER TABLE receivable
      ADD CONSTRAINT ck_receivable_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- inventory_stocktake.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_stocktake_status') THEN
    ALTER TABLE inventory_stocktake
      ADD CONSTRAINT ck_inventory_stocktake_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- inventory_transfer.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inventory_transfer_status') THEN
    ALTER TABLE inventory_transfer
      ADD CONSTRAINT ck_inventory_transfer_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- sales_return.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sales_return_status') THEN
    ALTER TABLE sales_return
      ADD CONSTRAINT ck_sales_return_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- sales_outbound.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sales_outbound_status') THEN
    ALTER TABLE sales_outbound
      ADD CONSTRAINT ck_sales_outbound_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- sales_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sales_order_status') THEN
    ALTER TABLE sales_order
      ADD CONSTRAINT ck_sales_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- purchase_return.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchase_return_status') THEN
    ALTER TABLE purchase_return
      ADD CONSTRAINT ck_purchase_return_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- purchase_inbound.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchase_inbound_status') THEN
    ALTER TABLE purchase_inbound
      ADD CONSTRAINT ck_purchase_inbound_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- purchase_order.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchase_order_status') THEN
    ALTER TABLE purchase_order
      ADD CONSTRAINT ck_purchase_order_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- bom.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bom_status') THEN
    ALTER TABLE bom
      ADD CONSTRAINT ck_bom_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- warehouse.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_warehouse_status') THEN
    ALTER TABLE warehouse
      ADD CONSTRAINT ck_warehouse_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- supplier.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_supplier_status') THEN
    ALTER TABLE supplier
      ADD CONSTRAINT ck_supplier_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- customer.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customer_status') THEN
    ALTER TABLE customer
      ADD CONSTRAINT ck_customer_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- material.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_material_status') THEN
    ALTER TABLE material
      ADD CONSTRAINT ck_material_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- sku.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sku_status') THEN
    ALTER TABLE sku
      ADD CONSTRAINT ck_sku_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- style.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_style_status') THEN
    ALTER TABLE style
      ADD CONSTRAINT ck_style_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- price_list.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_price_list_status') THEN
    ALTER TABLE price_list
      ADD CONSTRAINT ck_price_list_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- price_list_item.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_price_list_item_status') THEN
    ALTER TABLE price_list_item
      ADD CONSTRAINT ck_price_list_item_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- promotion.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_promotion_status') THEN
    ALTER TABLE promotion
      ADD CONSTRAINT ck_promotion_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- coupon.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_coupon_status') THEN
    ALTER TABLE coupon
      ADD CONSTRAINT ck_coupon_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- pos_session.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pos_session_status') THEN
    ALTER TABLE pos_session
      ADD CONSTRAINT ck_pos_session_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- pos_idempotency.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pos_idempotency_status') THEN
    ALTER TABLE pos_idempotency
      ADD CONSTRAINT ck_pos_idempotency_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- hangtag_template.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hangtag_template_status') THEN
    ALTER TABLE hangtag_template
      ADD CONSTRAINT ck_hangtag_template_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

-- unique_code_stock.status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_unique_code_stock_status') THEN
    ALTER TABLE unique_code_stock
      ADD CONSTRAINT ck_unique_code_stock_status
      CHECK (status IN ('accepted', 'active', 'approved', 'booked', 'cancelled', 'closed', 'completed', 'confirmed', 'disabled', 'done', 'draft', 'finished', 'in_stock', 'in_transit', 'inactive', 'open', 'out', 'pending', 'processing', 'refunded', 'returned', 'settled', 'skipped', 'sold', 'submitted', 'unpaid', 'wait_confirm', 'ongoing'));
  END IF;
END $$;

COMMIT;
