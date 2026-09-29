-- =============================================================================
-- 服装ERP 功能追加（Phase 5 续）：分销镜像可观测性 + 下游确认态
-- 目标：
--   1. 在销售单 / 销售退货单上记录"分销镜像（向下游生成采购单/退货单）"的结果，
--      使镜像异常不再被静默吞掉（F2：可观测性）。
--   2. 镜像生成的下游成衣采购单初始置为 wait_confirm（待接收），由下游在门户
--      确认接收后再转 approved，避免上游强制下游收货（F1：下游确认态）。
-- 全部 DDL 幂等（IF NOT EXISTS），可重复执行。
-- =============================================================================

-- ---------- 1. sales_order：镜像结果反馈 ----------
ALTER TABLE IF EXISTS sales_order
  ADD COLUMN IF NOT EXISTS mirror_status   varchar(10),   -- skipped | success | failed
  ADD COLUMN IF NOT EXISTS mirror_error    text,
  ADD COLUMN IF NOT EXISTS mirror_order_id uuid;          -- 下游生成成衣采购单 id

COMMENT ON COLUMN sales_order.mirror_status   IS '分销镜像结果：skipped=非分销客户/顶层不镜像；success=已生成下游采购单；failed=镜像异常';
COMMENT ON COLUMN sales_order.mirror_error    IS '镜像失败时的错误明细';
COMMENT ON COLUMN sales_order.mirror_order_id IS '镜像生成的下游成衣采购单 id（便于门户跳转与对账）';

CREATE INDEX IF NOT EXISTS idx_sales_order_mirror_status ON sales_order(mirror_status);

-- ---------- 2. sales_return：镜像结果反馈 ----------
ALTER TABLE IF EXISTS sales_return
  ADD COLUMN IF NOT EXISTS mirror_status     varchar(10),  -- skipped | success | failed
  ADD COLUMN IF NOT EXISTS mirror_error      text,
  ADD COLUMN IF NOT EXISTS mirror_return_id  uuid;         -- 下游生成成衣采购退货单 id

COMMENT ON COLUMN sales_return.mirror_status    IS '分销镜像结果：skipped=无可镜像下游；success=已生成下游采购退货单；failed=镜像异常';
COMMENT ON COLUMN sales_return.mirror_error     IS '镜像失败时的错误明细';
COMMENT ON COLUMN sales_return.mirror_return_id IS '镜像生成的下游成衣采购退货单 id';

CREATE INDEX IF NOT EXISTS idx_sales_return_mirror_status ON sales_return(mirror_status);
