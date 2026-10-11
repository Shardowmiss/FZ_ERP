-- =============================================================================
-- 多级分销（P0-3）：为销售单补充「反向追溯」字段
-- -----------------------------------------------------------------------------
-- 背景：
--   多级分销支持双向发起两种模式（业务已确认两者等价、需同时支持）：
--     正向：上级开销售单 → 自动生成下级的采购单（0006 已实现）
--     反向：下级发起采购单 → 自动生成上级的销售单（本次新增）
--
-- 为什么必须加这两个字段：
--   反向镜像会「由采购单产出的销售单」。若不标记来源，该销售单后续若流转到记账(book)，
--   正向镜像会再拿它生成第二张下游采购单 —— 同一个业务事实被镜像两次，产生重复单据。
--
--   解法是双向互指形成闭环：
--     采购单 P：source_doc_id = S.id, source_doc_type = 'SALES_ORDER'
--     销售单 S：source_doc_id = P.id, source_doc_type = 'PURCHASE_ORDER'
--   正向镜像 mirrorFromSalesOrder(S) 的幂等去重条件是
--     「存在 source_doc_id = S.id 且 source_doc_type='SALES_ORDER' 的采购单」，
--   因此会命中 P 并直接跳过，天然阻断二次镜像。幂等由数据结构保证，不依赖运行时判断。
--
-- 命名说明：sales_order 已有 source_type 字段（取值 manual / trade_show / replenish_plan，
--   表示单据来源场景），与本文件的 source_doc_id / source_doc_type（指向具体上游单据）互不相关，
--   请勿混用。
-- =============================================================================

ALTER TABLE IF EXISTS sales_order
  ADD COLUMN IF NOT EXISTS source_doc_id     uuid,
  ADD COLUMN IF NOT EXISTS source_doc_type   varchar(30);   -- PURCHASE_ORDER | PURCHASE_RETURN

COMMENT ON COLUMN sales_order.source_doc_id   IS '上游单据ID：反向镜像时指向触发本单的下游采购单';
COMMENT ON COLUMN sales_order.source_doc_type IS '上游单据类型：PURCHASE_ORDER';

CREATE INDEX IF NOT EXISTS idx_so_source_doc ON sales_order(source_doc_id);

-- =============================================================================
-- 幂等去重索引（防止重复镜像的关键护栏）
-- -----------------------------------------------------------------------------
-- 正向镜像每次执行都会按 (source_doc_id, source_doc_type) 查一次重。目前建立在
-- source_doc_id 上的普通索引已可用，但当采购单量大时，区分 doc_type 的复合索引更高效。
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_gpo_source_doc_type
  ON garment_purchase_order(source_doc_id, source_doc_type);

CREATE INDEX IF NOT EXISTS idx_gpr_source_doc_type
  ON garment_purchase_return(source_doc_id, source_doc_type);
