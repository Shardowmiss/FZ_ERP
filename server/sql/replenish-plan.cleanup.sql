-- 补货管理 / 补偿机制 验证测试数据清理（仅测试标识，不影响真实数据）
-- 覆盖两类测试数据：REPL-TEST（手动验证）+ REPL-E2E（Phase2 模板 e2e）+ ZZZ-UNKNOWN（补偿验证）
-- 可重跑（幂等）。整事务执行，任一失败全回滚。

BEGIN;

-- 测试 SKU 集合（供明细级 FK 安全删除）
-- SKU-REPL-01 / SKU-REPL-02 / ZZZ-UNKNOWN-001

-- 0) 先清引用了测试 SKU 的订单明细（规避 sku 外键阻塞）
DELETE FROM sales_order_item
  WHERE sku_id IN (SELECT id FROM sku WHERE sku_code IN ('SKU-REPL-01','SKU-REPL-02','ZZZ-UNKNOWN-001'));
DELETE FROM retail_order_item
  WHERE sku_id IN (SELECT id FROM sku WHERE sku_code IN ('SKU-REPL-01','SKU-REPL-02','ZZZ-UNKNOWN-001'));

-- 1) 补货计划头+明细（手动 REPL-TEST 与模板 REPL-E2E 自动生成）
DELETE FROM replenish_plan_item
  WHERE plan_id IN (
    SELECT id FROM replenish_plan
    WHERE remark LIKE 'REPL-TEST%'
       OR remark LIKE '%REPL-E2E%'
       OR template_id IN (SELECT id FROM replenish_template WHERE code LIKE 'REPL-E2E%')
  );
DELETE FROM replenish_plan
  WHERE remark LIKE 'REPL-TEST%'
     OR remark LIKE '%REPL-E2E%'
     OR template_id IN (SELECT id FROM replenish_template WHERE code LIKE 'REPL-E2E%');

-- 2) 补货模板（Phase2 e2e 创建）
DELETE FROM replenish_template WHERE code LIKE 'REPL-E2E%';

-- 3) 销售订单（经销商分支）：REPL-TEST + REPL-E2E 自动生成
DELETE FROM sales_order_item
  WHERE order_id IN (SELECT id FROM sales_order WHERE remark LIKE 'REPL-TEST%' OR remark LIKE '%REPL-E2E%');
DELETE FROM sales_order WHERE remark LIKE 'REPL-TEST%' OR remark LIKE '%REPL-E2E%';

-- 4) 调拨单（直营分支）：REPL-TEST + REPL-E2E 自动生成
DELETE FROM inventory_transfer_item
  WHERE transfer_id IN (SELECT id FROM inventory_transfer WHERE remark LIKE 'REPL-TEST%' OR remark LIKE '%REPL-E2E%');
DELETE FROM inventory_transfer WHERE remark LIKE 'REPL-TEST%' OR remark LIKE '%REPL-E2E%';

-- 5) 零售销量（验证种子）：RO-REPL-%
DELETE FROM retail_order_item WHERE retail_id IN (SELECT id FROM retail_order WHERE retail_no LIKE 'RO-REPL-%');
DELETE FROM retail_order WHERE retail_no LIKE 'RO-REPL-%';

-- 6) 库存 / SKU
DELETE FROM inventory_stock WHERE sku_code IN ('SKU-REPL-01','SKU-REPL-02');
DELETE FROM sku WHERE sku_code IN ('SKU-REPL-01','SKU-REPL-02');

-- 7) 门店 / 经销商 / 仓库
DELETE FROM store WHERE code IN ('ST-REPL-DIR','ST-REPL-FRAN');
DELETE FROM dealer WHERE code='DL-REPL-01';
DELETE FROM warehouse WHERE code IN ('WH-REPL-MAIN','WH-REPL-DIR','WH-REPL-FRAN');

-- 8) 补偿机制 ZZZ-UNKNOWN 测试数据（P1-4 验证产物）
DELETE FROM retail_order_item WHERE retail_id IN (SELECT id FROM retail_order WHERE retail_no='RT2026092800063');
DELETE FROM retail_order WHERE retail_no='RT2026092800063';
DELETE FROM pos_receive_log WHERE pos_doc_no='REPL-COMP-001';
DELETE FROM sku WHERE sku_code='ZZZ-UNKNOWN-001';
DELETE FROM style WHERE style_no='ZZZ-UNKNOWN';

COMMIT;
