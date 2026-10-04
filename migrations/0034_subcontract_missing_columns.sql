-- 0034 补齐委外模块滞后缺失的列，使数据库与 schema.ts 对齐。
-- 背景：subcontract_issue / subcontract_receipt / subcontract_fee 及其明细表在建表迁移中
-- 漏建了部分列（order_no / fee_no / total_quantity / total_amount / 明细 unit_price / amount 等），
-- 而 schema.ts 已声明这些列；drizzle 对主表做全列 SELECT 时取到缺失列 →
-- "column does not exist" → 委外发料/回收/加工费的列表与新建均失败（前端报"加载失败"）。
-- 经核对，上述表当前均为空，可安全加 NOT NULL 列并带默认值。
BEGIN;

-- 委外发料主表：补 order_no（service 写入 orderNo，列表/详情需读取）
ALTER TABLE subcontract_issue ADD COLUMN IF NOT EXISTS order_no varchar(50) NOT NULL DEFAULT '';

-- 委外发料明细：补 spec / unit_price / amount
ALTER TABLE subcontract_issue_item ADD COLUMN IF NOT EXISTS spec varchar(200);
ALTER TABLE subcontract_issue_item ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT '0';
ALTER TABLE subcontract_issue_item ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT '0';

-- 委外回收主表：补 order_no / total_quantity / total_amount
ALTER TABLE subcontract_receipt ADD COLUMN IF NOT EXISTS order_no varchar(50) NOT NULL DEFAULT '';
ALTER TABLE subcontract_receipt ADD COLUMN IF NOT EXISTS total_quantity numeric NOT NULL DEFAULT '0';
ALTER TABLE subcontract_receipt ADD COLUMN IF NOT EXISTS total_amount numeric NOT NULL DEFAULT '0';

-- 委外回收明细：补 unit_price / amount
ALTER TABLE subcontract_receipt_item ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT '0';
ALTER TABLE subcontract_receipt_item ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT '0';

-- 委外加工费主表：补 order_no / fee_no(唯一业务单号) / payable_id
ALTER TABLE subcontract_fee ADD COLUMN IF NOT EXISTS order_no varchar(50) NOT NULL DEFAULT '';
ALTER TABLE subcontract_fee ADD COLUMN IF NOT EXISTS fee_no varchar(50) NOT NULL DEFAULT '';
ALTER TABLE subcontract_fee ADD COLUMN IF NOT EXISTS payable_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_fee_fee_no_key ON subcontract_fee(fee_no);

COMMIT;
