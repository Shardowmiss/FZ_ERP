-- =============================================================================
-- 多级分销修复（P0-2）：对齐「供应商身份」与所属经销商的名称
-- -----------------------------------------------------------------------------
-- 背景：
--   0063 迁移补齐了缺失的供应商身份，但全量审计发现更深的问题——
--   原本已存在的 42 条 partner supplier 中，全部存在名称错位。例如：
--     GYS0013  supplier.name = '九牧王（湖州）品牌总代理'
--              但其 partner_id 指向的 dealer 实为 '山西青岛针织品有限公司'
--   根因：这些记录由历史组织模拟脚本（sim-org.cjs 之类）批量生成，
--         name 取自随机品牌名，与 partner_id 指向的真实经销商主体脱钩。
--
-- 影响：
--   镜像引擎取 `supplier.name` 作为下游采购单的上家（supplier_name），
--   名称错位会导致下级经销商看到的采购单上家是"九牧王"而非真正的发货上级，
--   采购单无法与上游销售单对账 —— 链路虽然跑通了，业务上仍是错的。
--
-- 处置：
--   将 partner supplier 的 name 对齐到其 partner_id 对应 dealer 的名称。
--   已核实这 42 条均为模拟数据（remark 为 "组织模拟自动创建（供应商身份）"、
--   FF-SUP-HQ / Sup1 / 规模总部 等占位名），不存在真实物料供应商被误伤的风险。
--
-- 说明：
--   历史单据上的 supplier_name 是冗余存储字段，本 UPDATE 不回溯改写，
--   因此存量单据保持原样，仅此后的新单据使用正确名称。
-- =============================================================================

BEGIN;

-- ---------- 1. 记录修复前的数量，便于核对 ----------
CREATE TEMP TABLE _p0_2_before AS
SELECT count(*) AS mismatched
FROM supplier s
JOIN dealer d ON d.id = s.partner_id
WHERE s._deleted_at IS NULL
  AND s.name <> d.name;

-- ---------- 2. 对齐名称 ----------
UPDATE supplier s
SET name = d.name,
    remark = coalesce(s.remark, '') || ' | ' || to_char(now(), 'YYYY-MM-DD') || ' 已对齐所属经销商名称'
FROM dealer d
WHERE d.id = s.partner_id
  AND s._deleted_at IS NULL
  AND s.name <> d.name;

COMMIT;

-- ---------- 3. 校验：错位应归零 ----------
-- SELECT count(*) AS still_mismatched
-- FROM supplier s JOIN dealer d ON d.id = s.partner_id
-- WHERE s._deleted_at IS NULL AND s.name <> d.name;
-- 期望结果：0
