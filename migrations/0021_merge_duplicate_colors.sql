-- 0021 合并重复颜色主数据：黑 / 黑色
--
-- 背景：B.1 双轨统一的 P1-2 回填，对每张业务表的裸字符串 color 各自 bootstrap 了
--       一条 color 主数据。同指"黑色"的裸串 '黑' 与 '黑色' 被建出两条主数据行，
--       其 color_id 分散在 26 张业务表里。需在删除重复前先把引用重指向权威行。
--
-- 设计要点（务必保持幂等）：
--   · 按 name 匹配，与具体 UUID 无关 —— 因为 erp_db / erp_test / 生产库各自
--     backfill 生成的 UUID 不同，硬编 UUID 会在别的库上失效或误删。
--   · 权威行 = 引用更多的一方（'黑'，实测 53 行 vs '黑色' 1 行）；不存在重复则 no-op。
--   · 重指向 26 张业务表 + color_group_color 关联 + color_group.jsonb 镜像，
--     最后 DELETE 重复行。可重复执行，第二次因找不到 '黑色' 行而直接 RETURN。
--   · 不改 color 表的 name —— 权威行保留 '黑' 之名，仅统一 id。

DO $$
DECLARE
  v_canonical uuid;
  v_dup uuid;
BEGIN
  SELECT id INTO v_canonical FROM color WHERE name = '黑';
  SELECT id INTO v_dup       FROM color WHERE name = '黑色';

  IF v_canonical IS NULL OR v_dup IS NULL THEN
    RAISE NOTICE 'merge_color: 无需合并（黑/黑色 主数据不全）';
    RETURN;
  END IF;
  IF v_canonical = v_dup THEN
    RAISE NOTICE 'merge_color: 已是同一行';
    RETURN;
  END IF;

  -- 1) 26 张业务表 color_id 重指向
  UPDATE omni_order_item               SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE subcontract_receipt_item      SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE subcontract_order_item        SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE inventory_batch               SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE production_finish_receipt_item SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE garment_purchase_return_sku   SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE garment_purchase_inbound_sku  SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE garment_purchase_order_sku    SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE retail_order_item             SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE allocation_item               SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE pre_order_item                SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE inventory_stocktake_item      SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE inventory_transfer_item       SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE replenish_plan_item           SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE inventory_stock               SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE inventory_flow                SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE sales_return_item             SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE sales_outbound_item           SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE sales_order_item              SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE sku                           SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE hangtag_print_item            SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE unique_code_stock             SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE doc_unique_code               SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE doc_unique_code_archive       SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE pos_return_item               SET color_id = v_canonical WHERE color_id = v_dup;
  UPDATE pos_requisition_item          SET color_id = v_canonical WHERE color_id = v_dup;

  -- 2) color_group_color 关联表重指向 + 去重（同组重复指向会产生重复键）
  UPDATE color_group_color SET color_id = v_canonical WHERE color_id = v_dup;
  DELETE FROM color_group_color a
   WHERE a.color_id = v_canonical
     AND EXISTS (
       SELECT 1 FROM color_group_color b
        WHERE b.color_group_id = a.color_group_id
          AND b.color_id = v_canonical
          AND b.ctid <> a.ctid
     );

  -- 3) color_group.jsonb 镜像清理：移除被合并 id 的条目
  UPDATE color_group
     SET colors = (
       SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
         FROM jsonb_array_elements(colors) e
        WHERE e->>'id' IS DISTINCT FROM v_dup::text
     )
   WHERE colors::text LIKE '%' || v_dup::text || '%';

  -- 4) 删除重复主数据行
  DELETE FROM color WHERE id = v_dup;

  RAISE NOTICE 'merge_color: 已将 color id % 合并入 %', v_dup, v_canonical;
END $$;
