-- =============================================================================
-- 服装ERP 功能追加（Phase 5）：多级分销组织模式支持
-- 目标：让"总部→一级分销商→二级分销商"的组织层级可在系统中表达，
--       并实现"下级采购单 = 上级销售单"的镜像生成。
-- 本次仅做数据结构改造（DDL），全部幂等（IF NOT EXISTS / DO $$ 防重复）。
-- 数据回填（建立 dealer↔customer/supplier 的 partner 关联、标记层级）见
--   migrations/0006_backfill_partner.example.sql（需业务确认后执行）。
-- 说明：
--   1. dealer 增加 parent_id / level / tree_path / partner_type，表达分销树。
--   2. customer / supplier 增加 partner_id，指向 dealer，实现"一个经销商同时持有
--      客户身份（对上级买）与供应商身份（对下级卖）"的双重身份模型，消除重复主数据。
--   3. garment_purchase_order / garment_purchase_return 增加 source_doc_id /
--      source_doc_type / downstream_org_id，用于下游单据向上游单据的双向追溯。
-- =============================================================================

-- ---------- 1. dealer：分销层级字段 ----------
ALTER TABLE IF EXISTS dealer
  ADD COLUMN IF NOT EXISTS parent_id     uuid,
  ADD COLUMN IF NOT EXISTS level         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tree_path     varchar(500),
  ADD COLUMN IF NOT EXISTS partner_type  varchar(20) NOT NULL DEFAULT 'hq';  -- hq | level1 | level2 | ...

COMMENT ON COLUMN dealer.parent_id    IS '上级分销节点（dealer.id）；总部为 NULL';
COMMENT ON COLUMN dealer.level        IS '分销层级，0=总部，1=一级，2=二级……';
COMMENT ON COLUMN dealer.tree_path    IS '物化路径，如 /hq-id/l1-id/l2-id，便于子树查询';
COMMENT ON COLUMN dealer.partner_type IS '节点类型：hq=总部，level1=一级分销商，level2=二级分销商……';

CREATE INDEX IF NOT EXISTS idx_dealer_parent_id ON dealer(parent_id);
CREATE INDEX IF NOT EXISTS idx_dealer_tree_path ON dealer(tree_path);

-- ---------- 2. customer：关联分销伙伴 ----------
ALTER TABLE IF EXISTS customer
  ADD COLUMN IF NOT EXISTS partner_id uuid;

COMMENT ON COLUMN customer.partner_id IS '关联分销节点 dealer.id；NULL 表示普通客户（非分销商）';

CREATE INDEX IF NOT EXISTS idx_customer_partner_id ON customer(partner_id);

-- ---------- 3. supplier：关联分销伙伴 ----------
ALTER TABLE IF EXISTS supplier
  ADD COLUMN IF NOT EXISTS partner_id uuid;

COMMENT ON COLUMN supplier.partner_id IS '关联分销节点 dealer.id；NULL 表示普通供应商（非分销商）';

CREATE INDEX IF NOT EXISTS idx_supplier_partner_id ON supplier(partner_id);

-- ---------- 4. 外键（幂等，采用 DO $$ 防重复） ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_partner_id_fkey'
  ) THEN
    ALTER TABLE customer
      ADD CONSTRAINT customer_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES dealer(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_partner_id_fkey'
  ) THEN
    ALTER TABLE supplier
      ADD CONSTRAINT supplier_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES dealer(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealer_parent_id_fkey'
  ) THEN
    ALTER TABLE dealer
      ADD CONSTRAINT dealer_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES dealer(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------- 5. garment_purchase_order：镜像追溯字段 ----------
ALTER TABLE IF EXISTS garment_purchase_order
  ADD COLUMN IF NOT EXISTS source_doc_id      uuid,
  ADD COLUMN IF NOT EXISTS source_doc_type    varchar(30),   -- SALES_ORDER | SALES_RETURN
  ADD COLUMN IF NOT EXISTS downstream_org_id  uuid;          -- 下游分销节点 dealer.id

COMMENT ON COLUMN garment_purchase_order.source_doc_id     IS '上游单据ID（销售单/销售退货单）';
COMMENT ON COLUMN garment_purchase_order.source_doc_type   IS '上游单据类型：SALES_ORDER / SALES_RETURN';
COMMENT ON COLUMN garment_purchase_order.downstream_org_id IS '下游分销节点 dealer.id（该采购单归属的分销商）';

CREATE INDEX IF NOT EXISTS idx_gpo_source_doc ON garment_purchase_order(source_doc_id);
CREATE INDEX IF NOT EXISTS idx_gpo_downstream ON garment_purchase_order(downstream_org_id);

-- ---------- 6. garment_purchase_return：镜像追溯字段 ----------
ALTER TABLE IF EXISTS garment_purchase_return
  ADD COLUMN IF NOT EXISTS source_doc_id      uuid,
  ADD COLUMN IF NOT EXISTS source_doc_type    varchar(30),   -- SALES_ORDER | SALES_RETURN
  ADD COLUMN IF NOT EXISTS downstream_org_id  uuid;          -- 下游分销节点 dealer.id

COMMENT ON COLUMN garment_purchase_return.source_doc_id     IS '上游单据ID（销售退货单）';
COMMENT ON COLUMN garment_purchase_return.source_doc_type   IS '上游单据类型：SALES_RETURN';
COMMENT ON COLUMN garment_purchase_return.downstream_org_id IS '下游分销节点 dealer.id';

CREATE INDEX IF NOT EXISTS idx_gpr_source_doc ON garment_purchase_return(source_doc_id);
CREATE INDEX IF NOT EXISTS idx_gpr_downstream ON garment_purchase_return(downstream_org_id);
