-- 0040 采购退货解耦采购入库单：退货不再绑定具体入库单，须指定「退货店仓」与「收货方」。
--
-- 业务规则（用户确认）：
--   1) 退货不绑定采购入库单（支持批量 / 无单退货）→ inbound_id / inbound_no 改为可空，历史单据保留原值；
--   2) 「退货店仓」沿用原 warehouse_id / warehouse_name（货物来源，必填）；
--   3) 新增多态「收货方」：receiver_type('supplier'|'store') + receiver_id + receiver_name；
--        - 总部退货：收货方 = 供应商（supplier_id 填充，receiver_type='supplier'）；
--        - 经销商账户退货：收货方 = 上级经销商的店仓（receiver_type='store'，无供应商）；
--   4) 新增 dealer_id 业务归属列，用于行级数据隔离（HQ 退货为 NULL，经销商退货 = 本经销商）。
--
-- 权限：anon_ 已对两表持有表级权限，新增列 / 索引自动继承，无需重复 GRANT；
--       FK 引用 dealer 表，anon_ 对 dealer 亦有 USAGE。
BEGIN;

-- ============ 面辅料采购退货 ============
ALTER TABLE purchase_return
  ALTER COLUMN inbound_id DROP NOT NULL,
  ALTER COLUMN inbound_no DROP NOT NULL,
  ALTER COLUMN supplier_id DROP NOT NULL,
  ALTER COLUMN supplier_name DROP NOT NULL;

ALTER TABLE purchase_return
  ADD COLUMN IF NOT EXISTS dealer_id uuid,
  ADD COLUMN IF NOT EXISTS receiver_type varchar(20) NOT NULL DEFAULT 'supplier',
  ADD COLUMN IF NOT EXISTS receiver_id uuid,
  ADD COLUMN IF NOT EXISTS receiver_name varchar(200);

ALTER TABLE purchase_return
  ADD CONSTRAINT purchase_return_dealer_id_fkey
    FOREIGN KEY (dealer_id) REFERENCES dealer(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_purchase_return_inbound ON purchase_return(inbound_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_dealer ON purchase_return(dealer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_receiver ON purchase_return(receiver_id);

-- ============ 成衣采购退货 ============
ALTER TABLE garment_purchase_return
  ALTER COLUMN inbound_id DROP NOT NULL,
  ALTER COLUMN inbound_no DROP NOT NULL,
  ALTER COLUMN supplier_id DROP NOT NULL,
  ALTER COLUMN supplier_name DROP NOT NULL;

ALTER TABLE garment_purchase_return
  ADD COLUMN IF NOT EXISTS dealer_id uuid,
  ADD COLUMN IF NOT EXISTS receiver_type varchar(20) NOT NULL DEFAULT 'supplier',
  ADD COLUMN IF NOT EXISTS receiver_id uuid,
  ADD COLUMN IF NOT EXISTS receiver_name varchar(200);

ALTER TABLE garment_purchase_return
  ADD CONSTRAINT garment_purchase_return_dealer_id_fkey
    FOREIGN KEY (dealer_id) REFERENCES dealer(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_gpr_dealer ON garment_purchase_return(dealer_id);
CREATE INDEX IF NOT EXISTS idx_gpr_receiver ON garment_purchase_return(receiver_id);

-- ============ 历史单据回填 ============
-- 原退货均为「总部基于供应商」的退货：收货方 = 供应商。
UPDATE purchase_return
  SET receiver_id   = supplier_id,
      receiver_name = supplier_name
  WHERE inbound_id IS NOT NULL
    AND receiver_id IS NULL;

UPDATE garment_purchase_return
  SET receiver_id   = supplier_id,
      receiver_name = supplier_name
  WHERE inbound_id IS NOT NULL
    AND receiver_id IS NULL;

COMMIT;
