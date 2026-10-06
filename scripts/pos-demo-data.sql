-- POS 演示数据初始化（幂等：以 SO2026DEMO 销售单为标记，已存在则整体跳过）
-- 覆盖：调拨入库/出库、销售单+明细+支付、会员(增量)、积分/储值流水、退货、促销
-- 金额单位：bigint 分（cents）；stored_value 为 numeric 元

DO $$
DECLARE
  v_m1000 uuid := 'cc97ca05-bbeb-40f9-a9ca-873bd777a101';
  v_m1001 uuid := '1fb95955-f4fa-4d38-89c6-f11f7897d104';
  v_m1002 uuid := 'a8c89ebd-ff2c-4dec-9bab-83b2810d80c9';
  v_m1003 uuid := 'bf65c616-d503-4974-b8f9-556a5c4f70c2';
  v_m1004 uuid := '03c8303e-97e2-4d9d-b9ae-e949f97d3ad3';
  v_emp1001 uuid := '05b9fd5a-d991-48bd-9c6d-091b660ba9da';
  v_emp2002 uuid := '1153c5bb-4b08-4a09-9011-14a756e59d5f';
  v_newm2 uuid := 'f4000000-0000-0000-0000-000000000002';
BEGIN
  IF EXISTS (SELECT 1 FROM pos_sale_order WHERE order_no LIKE 'SO2026DEMO%') THEN
    RAISE NOTICE 'POS demo data already present (SO2026DEMO* exists), skipping.';
    RETURN;
  END IF;

  -- ============ 1) 销售单（8 笔，覆盖会员/散客、不同门店导购） ============
  INSERT INTO pos_sale_order (id, order_no, store_id, member_id, employee_id, sale_date, total_qty, total_amount, discount_amount, pay_amount, points_used, points_earned, status, channel, remark)
  VALUES
    ('f1000000-0000-0000-0000-000000000001','SO2026DEMO0001','S001', v_m1000, v_emp1001, (CURRENT_DATE - 9), 0,0,0,0,0,0,'completed','store','演示数据'),
    ('f1000000-0000-0000-0000-000000000002','SO2026DEMO0002','S001', v_m1001, v_emp1001, (CURRENT_DATE - 8), 0,0,0,0,0,0,'completed','store','演示数据'),
    ('f1000000-0000-0000-0000-000000000003','SO2026DEMO0003','S001', v_m1002, v_emp2002, (CURRENT_DATE - 7), 0,0,0,0,0,0,'completed','store','演示数据'),
    ('f1000000-0000-0000-0000-000000000004','SO2026DEMO0004','S001', v_m1003, v_emp1001, (CURRENT_DATE - 6), 0,0,0,0,0,0,'completed','store','演示数据'),
    ('f1000000-0000-0000-0000-000000000005','SO2026DEMO0005','S001', v_m1004, v_emp2002, (CURRENT_DATE - 5), 0,0,0,0,0,0,'completed','store','演示数据'),
    ('f1000000-0000-0000-0000-000000000006','SO2026DEMO0006','S001', v_m1000, v_emp1001, (CURRENT_DATE - 4), 0,0,0,0,0,0,'completed','store','演示数据'),
    ('f1000000-0000-0000-0000-000000000007','SO2026DEMO0007','S001', NULL,     v_emp2002, (CURRENT_DATE - 3), 0,0,0,0,0,0,'completed','store','演示数据-散客'),
    ('f1000000-0000-0000-0000-000000000008','SO2026DEMO0008','S001', v_m1001, v_emp1001, (CURRENT_DATE - 2), 0,0,0,0,0,0,'completed','store','演示数据');

  -- ============ 2) 销售明细（line_amount = qty*unit_price - discount_amount） ============
  INSERT INTO pos_sale_item (id, order_id, sku_id, style_id, style_name, color_id, size_id, qty, tag_price, unit_price, discount_amount, line_amount)
  VALUES
    ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','ST-AUTUMN-红-M','ST-AUTUMN','秋日风衣外套','红','M',2,19900,19900,0,39800),
    ('f2000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','ST-SUMMER-黑-S','ST-SUMMER','盛夏冰丝T恤','黑','S',1,15900,15900,0,15900),
    ('f2000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000002','ST-SPRING-红-M','ST-SPRING','春日清新卫衣','红','M',1,21900,21900,0,21900),
    ('f2000000-0000-0000-0000-000000000004','f1000000-0000-0000-0000-000000000003','ST-AUTUMN-黑-S','ST-AUTUMN','秋日风衣外套','黑','S',3,18900,18900,0,56700),
    ('f2000000-0000-0000-0000-000000000005','f1000000-0000-0000-0000-000000000003','ST-SUMMER-红-M','ST-SUMMER','盛夏冰丝T恤','红','M',2,16900,16900,1900,31900),
    ('f2000000-0000-0000-0000-000000000006','f1000000-0000-0000-0000-000000000004','ST-AUTUMN-红-M','ST-AUTUMN','秋日风衣外套','红','M',1,19900,17900,2000,15900),
    ('f2000000-0000-0000-0000-000000000007','f1000000-0000-0000-0000-000000000005','ST-SPRING-红-M','ST-SPRING','春日清新卫衣','红','M',2,21900,21900,0,43800),
    ('f2000000-0000-0000-0000-000000000008','f1000000-0000-0000-0000-000000000005','ST-SUMMER-黑-S','ST-SUMMER','盛夏冰丝T恤','黑','S',1,15900,15900,0,15900),
    ('f2000000-0000-0000-0000-000000000009','f1000000-0000-0000-0000-000000000006','ST-AUTUMN-黑-S','ST-AUTUMN','秋日风衣外套','黑','S',1,18900,18900,0,18900),
    ('f2000000-0000-0000-0000-000000000010','f1000000-0000-0000-0000-000000000007','ST-SUMMER-红-M','ST-SUMMER','盛夏冰丝T恤','红','M',4,16900,16900,0,67600),
    ('f2000000-0000-0000-0000-000000000011','f1000000-0000-0000-0000-000000000008','ST-AUTUMN-红-S','ST-AUTUMN','秋日风衣外套','红','S',1,19900,19900,0,19900),
    ('f2000000-0000-0000-0000-000000000012','f1000000-0000-0000-0000-000000000008','ST-SPRING-黑-M','ST-SPRING','春日清新卫衣','黑','M',1,21900,20900,1000,19900);

  -- ============ 3) 回算销售单汇总 ============
  UPDATE pos_sale_order o SET
    total_qty = s.qty,
    total_amount = s.amt,
    discount_amount = s.disc,
    pay_amount = s.amt,
    points_earned = floor(s.amt / 100.0)::int
  FROM (
    SELECT order_id,
           sum(qty) AS qty,
           sum(line_amount) AS amt,
           sum(discount_amount) AS disc
    FROM pos_sale_item
    WHERE order_id IN (SELECT id FROM pos_sale_order WHERE order_no LIKE 'SO2026DEMO%')
    GROUP BY order_id
  ) s
  WHERE o.id = s.order_id;

  -- ============ 4) 支付记录（每单一笔，微信/支付宝交替） ============
  INSERT INTO pos_sale_payment (id, order_id, pay_method, amount)
  SELECT gen_random_uuid(), id,
         CASE WHEN order_no ~ '000[2468]' THEN 'alipay' ELSE 'wechat' END,
         pay_amount
  FROM pos_sale_order WHERE order_no LIKE 'SO2026DEMO%';

  -- ============ 5) 积分流水 + 会员累计 ============
  INSERT INTO pos_points_log (id, member_id, change, balance, type, source_no, remark)
  SELECT gen_random_uuid(), o.member_id, o.points_earned, (m.points + o.points_earned),
         'earn', o.order_no, '消费获赠积分'
  FROM pos_sale_order o JOIN pos_member m ON m.id = o.member_id
  WHERE o.order_no LIKE 'SO2026DEMO%' AND o.member_id IS NOT NULL;

  UPDATE pos_member m SET
    points = m.points + o.points_earned,
    total_spent = m.total_spent + o.pay_amount / 100.0,
    total_count = m.total_count + 1,
    last_purchase_at = o.sale_date::timestamp
  FROM (
    SELECT member_id, points_earned, pay_amount, sale_date
    FROM pos_sale_order WHERE order_no LIKE 'SO2026DEMO%' AND member_id IS NOT NULL
  ) o
  WHERE m.id = o.member_id;

  -- ============ 6) 新增会员（5 位，丰富会员中心） ============
  INSERT INTO pos_member (id, member_no, name, phone, gender, birthday, level, points, stored_value, prefer_size, prefer_style, total_spent, total_count, last_purchase_at, client_id)
  VALUES
    ('f4000000-0000-0000-0000-000000000001','M2001','陈晓','13900002001','female','1995-03-12','silver',1200,200.00,'M','ST-SUMMER',0,0,NULL,'demo-M2001'),
    (v_newm2,'M2002','刘洋','13900002002','male','1990-07-21','gold',5400,500.00,'L','ST-AUTUMN',0,0,NULL,'demo-M2002'),
    ('f4000000-0000-0000-0000-000000000003','M2003','赵敏','13900002003','female','1988-11-02','normal',320,0.00,'S','ST-SPRING',0,0,NULL,'demo-M2003'),
    ('f4000000-0000-0000-0000-000000000004','M2004','孙磊','13900002004','male','1992-05-18','silver',2100,100.00,'XL','ST-SUMMER',0,0,NULL,'demo-M2004'),
    ('f4000000-0000-0000-0000-000000000005','M2005','周婷','13900002005','female','1997-09-09','normal',80,0.00,'M','ST-SPRING',0,0,NULL,'demo-M2005');

  -- ============ 7) 储值流水 + 钱包事件（会员 M2002 充值 ¥500） ============
  INSERT INTO pos_stored_log (id, member_id, change, balance, type, source_no, remark)
  VALUES (gen_random_uuid(), v_newm2, 50000, (SELECT stored_value*100 FROM pos_member WHERE id=v_newm2) + 50000, 'recharge', 'DEMO-RECHARGE-1', '演示储值充值');
  UPDATE pos_member SET stored_value = stored_value + 500.00 WHERE id = v_newm2;

  INSERT INTO pos_wallet_event (id, event_key, member_id, erp_member_id, kind, change_value, source_type, source_no, store_id, status)
  VALUES (gen_random_uuid(), 'DEMO-WE-STORED-1', v_newm2, NULL, 'stored', 50000, 'recharge', 'DEMO-RECHARGE-1', 'S001', 'pending');

  -- ============ 8) 调拨：入库 2 + 出库 3 ============
  INSERT INTO pos_transfer (id, transfer_no, type, store_id, from_location, to_location, total_qty, status, source, received_at)
  VALUES
    ('c1000000-0000-0000-0000-000000000001','TR2026DEMO0001','in','S001',NULL,'门店S001',30,'received','manual','2026-09-19 10:00:00+08'),
    ('c1000000-0000-0000-0000-000000000002','TR2026DEMO0002','in','S001',NULL,'门店S001',20,'received','manual','2026-09-19 11:00:00+08'),
    ('c1000000-0000-0000-0000-000000000003','TR2026DEMO0003','out','S001','门店S001',NULL,15,'completed','manual','2026-09-20 09:30:00+08'),
    ('c1000000-0000-0000-0000-000000000004','TR2026DEMO0004','out','S001','门店S001',NULL,12,'completed','manual','2026-09-21 14:00:00+08'),
    ('c1000000-0000-0000-0000-000000000005','TR2026DEMO0005','out','S001','门店S001',NULL,8,'pending','manual',NULL);

  INSERT INTO pos_transfer_item (id, transfer_id, sku_id, style_id, color_id, size_id, planned_qty, received_qty)
  VALUES
    ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','ST-AUTUMN-红-M','ST-AUTUMN','红','M',10,10),
    ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','ST-SUMMER-黑-S','ST-SUMMER','黑','S',10,10),
    ('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','ST-SPRING-红-M','ST-SPRING','红','M',10,10),
    ('c2000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000002','ST-AUTUMN-黑-S','ST-AUTUMN','黑','S',10,10),
    ('c2000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000002','ST-SUMMER-红-M','ST-SUMMER','红','M',10,10),
    ('c2000000-0000-0000-0000-000000000006','c1000000-0000-0000-0000-000000000003','ST-AUTUMN-红-M','ST-AUTUMN','红','M',15,15),
    ('c2000000-0000-0000-0000-000000000007','c1000000-0000-0000-0000-000000000004','ST-SUMMER-黑-S','ST-SUMMER','黑','S',12,12),
    ('c2000000-0000-0000-0000-000000000008','c1000000-0000-0000-0000-000000000005','ST-SPRING-红-M','ST-SPRING','红','M',8,8);

  -- ============ 8b) 店仓库存（store_id=S001，按门店维度展示；ON CONFLICT 幂等） ============
  INSERT INTO pos_stock (id, store_id, sku_id, style_id, color_id, size_id, qty, in_transit_qty)
  VALUES
    (gen_random_uuid(),'S001','ST-AUTUMN-红-M','ST-AUTUMN','红','M',30,5),
    (gen_random_uuid(),'S001','ST-AUTUMN-红-S','ST-AUTUMN','红','S',22,3),
    (gen_random_uuid(),'S001','ST-AUTUMN-黑-M','ST-AUTUMN','黑','M',40,6),
    (gen_random_uuid(),'S001','ST-AUTUMN-黑-S','ST-AUTUMN','黑','S',35,4),
    (gen_random_uuid(),'S001','ST-SPRING-红-M','ST-SPRING','红','M',28,2),
    (gen_random_uuid(),'S001','ST-SPRING-红-S','ST-SPRING','红','S',25,3),
    (gen_random_uuid(),'S001','ST-SPRING-黑-M','ST-SPRING','黑','M',33,4),
    (gen_random_uuid(),'S001','ST-SPRING-黑-S','ST-SPRING','黑','S',30,2),
    (gen_random_uuid(),'S001','ST-SUMMER-红-M','ST-SUMMER','红','M',45,6),
    (gen_random_uuid(),'S001','ST-SUMMER-红-S','ST-SUMMER','红','S',38,5),
    (gen_random_uuid(),'S001','ST-SUMMER-黑-M','ST-SUMMER','黑','M',50,8),
    (gen_random_uuid(),'S001','ST-SUMMER-黑-S','ST-SUMMER','黑','S',42,6)
  ON CONFLICT (store_id, sku_id) DO UPDATE SET qty = EXCLUDED.qty, in_transit_qty = EXCLUDED.in_transit_qty;

  -- ============ 9) 退货 2 笔（引用演示销售单） ============
  INSERT INTO pos_return_order (id, return_no, original_order_no, store_id, member_id, employee_id, total_qty, refund_amount, refund_method, status, remark)
  VALUES
    ('d1000000-0000-0000-0000-000000000001','RO2026DEMO0001','SO2026DEMO0001','S001', v_m1000, v_emp1001, 1, 19900, 'original', 'completed', '演示退货'),
    ('d1000000-0000-0000-0000-000000000002','RO2026DEMO0002','SO2026DEMO0003','S001', v_m1002, v_emp2002, 1, 18900, 'original', 'completed', '演示退货');

  INSERT INTO pos_return_item (id, return_id, original_item_id, sku_id, style_id, style_name, color_id, size_id, qty, refund_price, line_amount)
  VALUES
    ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','ST-AUTUMN-红-M','ST-AUTUMN','秋日风衣外套','红','M',1,19900,19900),
    ('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000004','ST-AUTUMN-黑-S','ST-AUTUMN','秋日风衣外套','黑','S',1,18900,18900);

  -- ============ 10) 促销 2 条 ============
  INSERT INTO pos_promotion (id, name, type, threshold, discount_value, discount_type, apply_scope, scope_ids, valid_from, valid_to, status, priority, is_member_only, source)
  VALUES
    ('e1000000-0000-0000-0000-000000000001','满200减30','full_reduction',20000,3000,'amount','all','{}','2026-09-01 00:00:00+08','2026-12-31 23:59:59+08','active',10,false,'manual'),
    ('e1000000-0000-0000-0000-000000000002','会员95折','discount',NULL,95,'percent','all','{}','2026-09-01 00:00:00+08','2026-12-31 23:59:59+08','active',5,true,'manual');

  RAISE NOTICE 'POS demo data inserted: sales/transfers/members/promotions/returns OK.';
END $$;
