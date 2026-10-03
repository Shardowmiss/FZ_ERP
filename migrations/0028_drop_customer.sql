-- 0028 删除 customer 主数据：业务表改挂 dealer（dealer_id 直连），删除 customer 表
--
-- 背景：P0 客户管理下线。用户决策「彻底删表 + 重构依赖」。
--   原数据模型中 customer.partner_id 即下游经销商(dealer)主键；销售单/出库/退货/应收/收款/对账
--   均经 customer_id -> customer.partner_id 反查经销商做数据隔离。
--   现改为业务表直接持有 dealer_id（FK -> dealer.id），去掉中间层 customer，
--   并 DROP customer 表（含 0027 落在 customer 上的 merged_into/merged_at 打标列随表删除）。
--
-- 幂等：可重复执行（IF NOT EXISTS / DO BLOCK 条件建约束 / 条件 DROP）。

BEGIN;

-- ============ 1) 解除指向 customer 的外键 ============
ALTER TABLE receivable   DROP CONSTRAINT IF EXISTS receivable_customer_id_fkey;
ALTER TABLE sales_order  DROP CONSTRAINT IF EXISTS sales_order_customer_id_fkey;

-- ============ 2) 6 张业务表新增 dealer_id（可空，兼容历史 partner_id 为空行） ============
ALTER TABLE sales_order         ADD COLUMN IF NOT EXISTS dealer_id uuid;
ALTER TABLE sales_outbound      ADD COLUMN IF NOT EXISTS dealer_id uuid;
ALTER TABLE sales_return        ADD COLUMN IF NOT EXISTS dealer_id uuid;
ALTER TABLE receivable           ADD COLUMN IF NOT EXISTS dealer_id uuid;
ALTER TABLE finance_receipt      ADD COLUMN IF NOT EXISTS dealer_id uuid;
ALTER TABLE sales_reconciliation ADD COLUMN IF NOT EXISTS dealer_id uuid;

-- ============ 3) 索引（与 schema.ts 同名） ============
CREATE INDEX IF NOT EXISTS idx_sales_order_dealer_id       ON sales_order(dealer_id);
CREATE INDEX IF NOT EXISTS idx_sales_outbound_dealer_id    ON sales_outbound(dealer_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_dealer_id      ON sales_return(dealer_id);
CREATE INDEX IF NOT EXISTS idx_receivable_dealer_id        ON receivable(dealer_id);
CREATE INDEX IF NOT EXISTS idx_fr_dealer_id                 ON finance_receipt(dealer_id);
CREATE INDEX IF NOT EXISTS idx_sr_dealer_id                 ON sales_reconciliation(dealer_id);

-- ============ 4) 外键 dealer_id -> dealer.id（幂等 DO BLOCK） ============
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT t, c FROM (VALUES
      ('sales_order',         'sales_order_dealer_id_fkey'),
      ('sales_outbound',      'sales_outbound_dealer_id_fkey'),
      ('sales_return',        'sales_return_dealer_id_fkey'),
      ('receivable',          'receivable_dealer_id_fkey'),
      ('finance_receipt',     'finance_receipt_dealer_id_fkey'),
      ('sales_reconciliation','sales_reconciliation_dealer_id_fkey')
    ) AS v(t, c)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = rec.c AND conrelid = rec.t::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (dealer_id) REFERENCES dealer(id)',
        rec.t, rec.c
      );
    END IF;
  END LOOP;
END $$;

-- ============ 5) 回填 dealer_id（来自 customer.partner_id） ============
-- customer 此刻仍在，用于补齐历史归属；回填仅作用于 dealer_id 仍为空的行，可重复跑。
UPDATE sales_order         SET dealer_id = c.partner_id FROM customer c WHERE sales_order.customer_id = c.id         AND sales_order.dealer_id IS NULL;
UPDATE sales_outbound      SET dealer_id = c.partner_id FROM customer c WHERE sales_outbound.customer_id = c.id       AND sales_outbound.dealer_id IS NULL;
UPDATE sales_return        SET dealer_id = c.partner_id FROM customer c WHERE sales_return.customer_id = c.id         AND sales_return.dealer_id IS NULL;
UPDATE receivable           SET dealer_id = c.partner_id FROM customer c WHERE receivable.customer_id = c.id           AND receivable.dealer_id IS NULL;
UPDATE finance_receipt      SET dealer_id = c.partner_id FROM customer c WHERE finance_receipt.customer_id = c.id       AND finance_receipt.dealer_id IS NULL;
UPDATE sales_reconciliation SET dealer_id = c.partner_id FROM customer c WHERE sales_reconciliation.customer_id = c.id AND sales_reconciliation.dealer_id IS NULL;

-- ============ 6) 删除 customer_id 列（含其上的索引与外键随列删除） ============
ALTER TABLE sales_order         DROP COLUMN IF EXISTS customer_id;
ALTER TABLE sales_outbound      DROP COLUMN IF EXISTS customer_id;
ALTER TABLE sales_return        DROP COLUMN IF EXISTS customer_id;
ALTER TABLE receivable           DROP COLUMN IF EXISTS customer_id;
ALTER TABLE finance_receipt      DROP COLUMN IF EXISTS customer_id;
ALTER TABLE sales_reconciliation DROP COLUMN IF EXISTS customer_id;

-- ============ 7) 删除 customer 表（含自引用 customer_merged_into_fkey 随 CASCADE 移除） ============
DROP TABLE IF EXISTS customer CASCADE;

COMMIT;
