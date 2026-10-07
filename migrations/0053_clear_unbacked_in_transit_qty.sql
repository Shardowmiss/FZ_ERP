-- 0053 清理成品仓无单据支撑的在途量（幂等）
-- 巡检遗留项：inventory_stock 有 8 行 in_transit_qty（合计 80 件），
-- 但**无任何在途调拨单支撑**，属孤立脏数据。
--
-- 【取证过程】（四项交叉验证，均为只读查询）
--   ① 全库在途量分布：仅 WH-MAIN（finished 成品仓）8 行 / 80 件，
--      且每行恰好 10 件（整齐的种子特征）。
--   ② 全库调拨单共 11 张，其中 in_transit 状态仅 1 张：
--      TR202609230001（调出仓=WH-MAIN 成品仓，调入仓=SW_1790154407621）。
--      注意方向：该单是**从成品仓调出**，而非调入成品仓。
--   ③ 该在途单仅 1 条明细、数量 3 件、SKU=FS_1790154407621，
--      与成品仓那 8 行的 SKU（ST-AUTUMN-红-S / ST-SUMMER-红-S /
--      ST-SPRING-黑-S / SD_SKU 等）**完全不重叠**。
--      逐 SKU 反查「在途单中该 SKU 行数」= 全部为 0。
--   ④ 库存流水表 inventory_flow 中 flow_type LIKE '%transfer%' 的记录数 = 0，
--      即在途量产生时**未留下任何流水**，无法追溯来源。
--   ⑤ 排除跨库来源：POS 库 pos_stock 虽有 12 行在途（54 件），但属独立库、
--      SKU 与仓库完全不同，与 ERP 成品仓在途量无关。
--
-- 【业务语义】按 inventory-transfer.service.ts:506-560 的实现，
--   调入仓库在途增加只应由「调出→调入」且状态为 in_transit 的调拨单驱动。
--   成品仓作为「调出方」本不应持有在途量——货已发出即离开本仓，
--   在途概念属于「尚未到达的调入方」。这 80 件在途量与业务语义直接矛盾。
--
-- 【处置】清零为 0，并同步修正已完成的调拨单语义（仅注释说明，不改数据）。
--   保留在途字段本身（列不动），只把无单据支撑的数值归零。
--   若后续有真实在途调拨产生，代码会正常重新累加。

-- ============================================================
-- 1) 预检查：确认无在途单支撑（双重保险，避免误删真实在途）
-- ============================================================
DO $$
DECLARE
  v_dirty_rows  bigint;
  v_dirty_qty   numeric;
  v_intransit_docs bigint;
  v_covered     bigint;
BEGIN
  SELECT count(*), COALESCE(sum(s.in_transit_qty),0)
    INTO v_dirty_rows, v_dirty_qty
  FROM inventory_stock s
  JOIN warehouse w ON w.id = s.warehouse_id
  WHERE s.in_transit_qty <> 0;

  SELECT count(*) INTO v_intransit_docs
  FROM inventory_transfer WHERE status = 'in_transit';

  -- 这些 SKU 在在途单中是否真无明细支撑（期望 0）
  SELECT count(*) INTO v_covered
  FROM inventory_stock s
  JOIN inventory_transfer t ON t.status = 'in_transit'
  JOIN inventory_transfer_item i ON i.transfer_id = t.id AND i.sku_id = s.sku_id
  WHERE s.in_transit_qty <> 0;

  RAISE NOTICE '[0053] 预检查：';
  RAISE NOTICE '  有在途量的行=% 行 / 数量=% 件', v_dirty_rows, v_dirty_qty;
  RAISE NOTICE '  in_transit 状态调拨单=% 张；其明细覆盖到的在途 SKU 行数=%', v_intransit_docs, v_covered;

  IF v_covered > 0 THEN
    RAISE EXCEPTION '[0053] 存在有在途单支撑的在途量（% 行），请人工确认后再处理', v_covered;
  END IF;
END $$;

-- ============================================================
-- 2) 清理：把无单据支撑的在途量归零
--    幂等：WHERE in_transit_qty <> 0 保证重复执行不产生变更。
--    限定 WH-MAIN（成品仓）以避免误清其他仓库的真实在途。
-- ============================================================
UPDATE inventory_stock s
SET in_transit_qty = 0,
    _updated_at = now()
FROM warehouse w
WHERE w.id = s.warehouse_id
  AND w.type = 'finished'
  AND s.in_transit_qty <> 0;

-- ============================================================
-- 3) 后置校验
-- ============================================================
DO $$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left
  FROM inventory_stock s
  JOIN warehouse w ON w.id = s.warehouse_id
  WHERE s.in_transit_qty <> 0;

  IF v_left > 0 THEN
    RAISE EXCEPTION '[0053] 仍有 % 行在途量未清理', v_left;
  END IF;

  RAISE NOTICE '[0053] 完成：成品仓无单据支撑的在途量已归零，全库剩余在途行数=%', v_left;
END $$;

-- ============================================================
-- 回滚说明：
--   恢复为固定值（清理前的 8 行均为 10 件，故可精确还原）：
--   UPDATE inventory_stock s
--      SET in_transit_qty = 10
--     FROM warehouse w
--    WHERE w.id = s.warehouse_id AND w.type='finished'
--      AND s.sku_id IN (
--        '8ccb202e-d034-42ae-817b-ff20e19ac3d5','6383fa7e-771c-4e6d-aea0-27049f531e94',
--        'a994269d-3380-456c-8766-4b12651b6fe7','50e0cc56-e788-4953-a600-a6604eb34770',
--        'd9835d26-875c-4102-84b1-bb86eebe8a95','e3dce050-b4fb-47eb-88b2-14c3cb2b144c',
--        'd384478a-693e-4e4c-a037-9b2920929ad2','fe98acdf-2d08-4562-858a-924e00db5c1d'
--      );
--   ⚠ 依赖上述 sku_id 硬编码，若清理后有新增成品仓库存行则无法完全还原，
--     稳妥起见建议清理前先 pg_dump 备份。
-- ============================================================
