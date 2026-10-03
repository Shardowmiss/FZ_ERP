-- 补货管理端到端验证种子数据（全部 REPL-TEST 前缀，可重跑）
-- 用途：验证 calc（建议量）与 generate（经销商→销售订单 / 直营店→调拨单草稿）
-- 清理旧数据后重插，避免重复主键。

BEGIN;

-- 清理（按明确 UUID 删除，不影响真实数据）
DELETE FROM replenish_plan_item WHERE plan_id IN (SELECT id FROM replenish_plan WHERE remark LIKE 'REPL-TEST%');
DELETE FROM replenish_plan WHERE remark LIKE 'REPL-TEST%';
DELETE FROM sales_order_item WHERE order_id IN (SELECT id FROM sales_order WHERE remark LIKE 'REPL-TEST%');
DELETE FROM sales_order WHERE remark LIKE 'REPL-TEST%';
DELETE FROM inventory_transfer_item WHERE transfer_id IN (SELECT id FROM inventory_transfer WHERE remark LIKE 'REPL-TEST%');
DELETE FROM inventory_transfer WHERE remark LIKE 'REPL-TEST%';
DELETE FROM retail_order_item WHERE retail_id IN (SELECT id FROM retail_order WHERE retail_no LIKE 'RO-REPL-%');
DELETE FROM retail_order WHERE retail_no LIKE 'RO-REPL-%';
DELETE FROM inventory_stock WHERE sku_code IN ('SKU-REPL-01','SKU-REPL-02');
DELETE FROM sku WHERE sku_code IN ('SKU-REPL-01','SKU-REPL-02');
DELETE FROM store WHERE code IN ('ST-REPL-DIR','ST-REPL-FRAN');
DELETE FROM dealer WHERE code='DL-REPL-01';
DELETE FROM warehouse WHERE code IN ('WH-REPL-MAIN','WH-REPL-DIR','WH-REPL-FRAN');

-- 仓库
INSERT INTO warehouse (id, code, name, type, store_type) VALUES
  ('b1111111-1111-1111-1111-111111111111','WH-REPL-MAIN','补货测试中央仓','main',NULL),
  ('b2222222-2222-2222-2222-222222222222','WH-REPL-DIR','补货测试直营仓','store','direct'),
  ('b3333333-3333-3333-3333-333333333333','WH-REPL-FRAN','补货测试加盟仓','store','franchise');

-- 经销商（供加盟店生成销售订单，门店 dealer_id 直连）
INSERT INTO dealer (id, code, name, status) VALUES
  ('c1111111-1111-1111-1111-111111111111','DL-REPL-01','补货测试经销商','active');

-- 门店
INSERT INTO store (id, code, name, store_type, warehouse_id, dealer_id, status) VALUES
  ('d1111111-1111-1111-1111-111111111111','ST-REPL-DIR','补货测试直营店','direct','b2222222-2222-2222-2222-222222222222',NULL,'active'),
  ('d2222222-2222-2222-2222-222222222222','ST-REPL-FRAN','补货测试加盟店','franchise','b3333333-3333-3333-3333-333333333333','c1111111-1111-1111-1111-111111111111','active');

-- SKU（复用现有 style 9d38d1ef-...）
INSERT INTO sku (id, sku_code, style_id, style_no, color, size, status, supply_price) VALUES
  ('e1111111-1111-1111-1111-111111111111','SKU-REPL-01','9d38d1ef-7a03-4b14-9458-999fed7cde5f','ST-SPRING','RED','M','active','10'),
  ('e2222222-2222-2222-2222-222222222222','SKU-REPL-02','9d38d1ef-7a03-4b14-9458-999fed7cde5f','ST-SPRING','BLUE','L','active','20');

-- 库存（按门店仓）
INSERT INTO inventory_stock (sku_id, sku_code, style_no, color, size, warehouse_id, warehouse_name, quantity, in_transit_qty) VALUES
  ('e1111111-1111-1111-1111-111111111111','SKU-REPL-01','ST-SPRING','RED','M','b2222222-2222-2222-2222-222222222222','补货测试直营仓',50,0),
  ('e2222222-2222-2222-2222-222222222222','SKU-REPL-02','ST-SPRING','BLUE','L','b2222222-2222-2222-2222-222222222222','补货测试直营仓',20,0),
  ('e1111111-1111-1111-1111-111111111111','SKU-REPL-01','ST-SPRING','RED','M','b3333333-3333-3333-3333-333333333333','补货测试加盟仓',100,0);

-- 零售销量（近 30 天内，settled）：直营店 sku1=300，加盟店 sku1=600
INSERT INTO retail_order (id, retail_no, store_id, store_name, sale_date, status) VALUES
  ('a1111111-1111-1111-1111-111111111111','RO-REPL-DIR-1','d1111111-1111-1111-1111-111111111111','补货测试直营店',current_date - 1,'settled'),
  ('a2222222-2222-2222-2222-222222222222','RO-REPL-FRAN-1','d2222222-2222-2222-2222-222222222222','补货测试加盟店',current_date - 1,'settled');
INSERT INTO retail_order_item (id, retail_id, sku_id, sku_code, style_no, color, size, quantity) VALUES
  ('f1111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','e1111111-1111-1111-1111-111111111111','SKU-REPL-01','ST-SPRING','RED','M',300),
  ('f2222222-2222-2222-2222-222222222222','a2222222-2222-2222-2222-222222222222','e1111111-1111-1111-1111-111111111111','SKU-REPL-01','ST-SPRING','RED','M',600);

COMMIT;
