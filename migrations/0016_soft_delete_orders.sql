-- 0016 软删除扩表（P1-c②）：销售订单 / 采购订单由"硬删"改为"软删"。
--
-- 背景（评估发现的实际缺陷，非潜在风险）：
--   sales-order.service.ts / purchase-order.service.ts 的 delete() 此前执行
--   `DELETE FROM sales_order WHERE id = ?`，属物理删除。草稿单一旦被误删，
--   订单头 + 全部明细 + 单号即永久消失，无回收手段（此前系统内不存在任何 restore 接口）。
--
-- 改动：
--   1) 两张主表增加 _deleted_at，删除仅置位（可恢复）；明细表不扩列——
--      主表软删后不再触发 FK ON DELETE CASCADE，明细行天然保留，无需额外字段。
--   2) 兑现 0011 遗留 TODO：把 order_no 的唯一索引改为 PARTIAL
--      （WHERE _deleted_at IS NULL），使软删后可复用同一单号重建。
--   3) 为 _deleted_at 建索引，支撑 IS NULL 过滤（列表/统计计数均按此条件）。
--
-- 全语句幂等（IF NOT EXISTS），可重复执行。

-- 1) 新增软删除标记列
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS _deleted_at timestamptz(3);
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS _deleted_at timestamptz(3);

-- 2) 唯一键改为 PARTIAL：允许「软删 → 用同一单号重建」
--    注意：order_no 上同时存在两种唯一对象——列级 .unique() 生成的约束
--    <table>_<col>_unique，以及 drizzle uniqueIndex 生成的 <table>_<col>_key。
--    两者都是非 PARTIAL 的普通唯一索引，只改其中一个仍会让重建撞键，
--    故必须先全部清除。
ALTER TABLE sales_order DROP CONSTRAINT IF EXISTS sales_order_order_no_unique;
ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS purchase_order_order_no_unique;
DROP INDEX IF EXISTS sales_order_order_no_key;
DROP INDEX IF EXISTS purchase_order_order_no_key;

DROP INDEX IF EXISTS sales_order_order_no_key;
CREATE UNIQUE INDEX sales_order_order_no_key
  ON sales_order (order_no) WHERE _deleted_at IS NULL;

DROP INDEX IF EXISTS purchase_order_order_no_key;
CREATE UNIQUE INDEX purchase_order_order_no_key
  ON purchase_order (order_no) WHERE _deleted_at IS NULL;

-- 3) 软删除过滤索引
CREATE INDEX IF NOT EXISTS idx_sales_order_deleted_at ON sales_order (_deleted_at);
CREATE INDEX IF NOT EXISTS idx_purchase_order_deleted_at ON purchase_order (_deleted_at);

-- 说明：inventory_flow（流水）与 system_operation_log（审计日志）不在本次范围内。
--   · 流水表删除的正确姿势是「红冲/反记账」，软删会让流水与库存余额对不上账；
--   · 审计日志为 append-only，加 _deleted_at 等于给审计留"可删除"的后门，违背合规。
--  retail_order 的删除语义已由 voidDraftDocument 的 cancelled 终态承担，
--  再叠加 _deleted_at 会形成两套并行的"删除"语义，故一并排除。
