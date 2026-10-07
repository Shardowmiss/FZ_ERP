-- ============================================================
-- 0057 零售退货明细表（retail_return_item）
--
-- 背景：retail_return 长期没有明细表，退货行项目被 JSON 编码进
--       remark 字段（前缀 __return_items__），退款时再解析回库。
--       该设计有三重脆弱性：
--         ① remark 被业务误用/覆盖 → 退货明细丢失，退款无法回库；
--         ② 无法按 SKU/颜色/尺码统计退货原因与退货率；
--         ③ 无法与零售明细（retail_order_item）建立真实外键，
--            退货数量无数据库级校验（可退数量 > 原单数量也能写入）。
--       本迁移补齐明细表，并把历史 remark 编码数据回填为真实行。
--
-- 设计要点：
--   1. 明细冗余原零售明细的关键字段（sku_id/sku_code/style_no/color/size/
--      tag_price/deal_price/line_amount），使退货报表无需 JOIN 原单即可统计，
--      也避免原单明细被修改后历史退货金额失真。
--   2. retail_item_id 指向 retail_order_item.id，DB 级保证退货来源可追溯。
--   3. return_id 指向 retail_return.id，ON DELETE CASCADE 与主表生命周期一致。
--   4. CHECK 约束限定 quantity > 0、金额 >= 0。
--   5. 幂等：表用 IF NOT EXISTS；回填用 NOT EXISTS 去重，可重复执行。
--
-- 兼容性：迁移**不删除** remark 中的 __return_items__ 编码，
--         以便旧版本代码（或回滚后）仍能解析，避免历史数据不可读。
--         待应用侧切换到明细表后，remark 仅保留业务备注文本。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 建表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retail_return_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid NOT NULL REFERENCES retail_return(id) ON DELETE CASCADE,
  -- 来源零售明细（DB 级保证退货行必可追溯到原单行）
  retail_item_id uuid REFERENCES retail_order_item(id) ON DELETE SET NULL,
  -- 明细冗余字段（脱离原单也能独立统计）
  sku_id         uuid,
  sku_code       varchar(100),
  style_no       varchar(100),
  color          varchar(50),
  size           varchar(50),
  quantity       numeric(18, 3) NOT NULL,
  tag_price      numeric(18, 2),
  deal_price     numeric(18, 2),
  line_amount    numeric(18, 2),
  reason         varchar(200),
  remark         text,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    uuid,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    uuid,

  CONSTRAINT ck_retail_return_item_qty   CHECK (quantity > 0),
  CONSTRAINT ck_retail_return_item_price CHECK (
    (tag_price  IS NULL OR tag_price  >= 0) AND
    (deal_price IS NULL OR deal_price >= 0) AND
    (line_amount IS NULL OR line_amount >= 0)
  )
);

-- 索引：按退货单查明细（详情页主路径）
CREATE INDEX IF NOT EXISTS idx_retail_return_item_return
  ON retail_return_item (return_id);
-- 索引：按原零售明细反查（支持"该行退过多少"的校验与统计）
CREATE INDEX IF NOT EXISTS idx_retail_return_item_retail_item
  ON retail_return_item (retail_item_id);
-- 索引：按 SKU 统计退货率 / 退货原因分析（服装行业核心指标）
CREATE INDEX IF NOT EXISTS idx_retail_return_item_sku
  ON retail_return_item (sku_id);
-- 索引：按原因筛选（尺码不合适 / 质量问题 / 客户改变主意等）
CREATE INDEX IF NOT EXISTS idx_retail_return_item_reason
  ON retail_return_item (reason);

-- ------------------------------------------------------------
-- 2) 回填历史明细（从 remark 的 __return_items__ 编码解析）
--
-- remark 格式：  __return_items__:[{"retailItemId":"...","quantity":1}]\n<业务备注>
-- 解析方式： 用 substring 取出首行 JSON，再用 jsonb_array_elements 展开，
--           这样比逐条调用应用层更可靠，且可一次性处理全部历史单据。
--
-- 关联零售明细取 sku/价格等冗余字段；join 不到的行（历史遗留或原单已删）
-- 仍会写入，retail_item_id 保持 NULL，避免丢历史退货记录。
-- ------------------------------------------------------------
INSERT INTO retail_return_item (
  return_id, retail_item_id, sku_id, sku_code, style_no,
  color, size, quantity, tag_price, deal_price, line_amount, remark
)
SELECT
  r.id,
  (e->>'retailItemId')::uuid,
  oi.sku_id,
  oi.sku_code,
  oi.style_no,
  oi.color,
  oi.size,
  (e->>'quantity')::numeric,
  oi.tag_price,
  oi.deal_price,
  -- 退货金额 = 原零售明细行单价 × 本次退货数量
  CASE
    WHEN oi.deal_price IS NOT NULL
      THEN round((oi.deal_price::numeric * (e->>'quantity')::numeric), 2)
    ELSE NULL
  END,
  '迁移0057自remark编码回填'
FROM retail_return r
CROSS JOIN LATERAL jsonb_array_elements(
  substring(
    r.remark
    FROM '^__return_items__:(\[.*\])\n'
  )::jsonb
) AS e
LEFT JOIN retail_order_item oi
  ON oi.id = (e->>'retailItemId')::uuid
WHERE r.remark LIKE '__return_items__:%'
  -- 幂等：已回填过则跳过（按 return_id + retail_item_id 去重）
  AND NOT EXISTS (
    SELECT 1 FROM retail_return_item x
    WHERE x.return_id = r.id
      AND x.retail_item_id IS NOT DISTINCT FROM (e->>'retailItemId')::uuid
      AND x.remark = '迁移0057自remark编码回填'
  );

-- ------------------------------------------------------------
-- 3) 后置校验：确认回填完整且无非法数据
-- ------------------------------------------------------------
DO $$
DECLARE
  v_src      bigint;  -- remark 中有编码的退货单数
  v_items    bigint;  -- 已回填的明细行数
  v_orphan   bigint;  -- 挂不到原零售明细的行数（保留但需知悉）
  v_illegal  bigint;  -- 违反 CHECK 的行数
BEGIN
  SELECT count(*) INTO v_src
    FROM retail_return WHERE remark LIKE '__return_items__:%';

  SELECT count(*) INTO v_items FROM retail_return_item;

  SELECT count(*) INTO v_orphan
    FROM retail_return_item WHERE retail_item_id IS NULL;

  SELECT count(*) INTO v_illegal
    FROM retail_return_item WHERE quantity <= 0;

  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0057] retail_return_item 存在非法数量 % 行', v_illegal;
  END IF;

  RAISE NOTICE '[0057] 完成：remark 含编码退货单 % 张，回填明细 % 行（其中 % 行挂不到原零售明细，保留不丢）',
    v_src, v_items, v_orphan;
END $$;

-- ============================================================
-- 回滚说明：
--   DROP TABLE IF EXISTS retail_return_item;
--   ⚠ 回滚后应用侧会退回「remark 编码」方案。由于 0057 **未删除**
--     remark 中的 __return_items__ 内容，回滚后历史退货的回库功能
--     仍可正常工作（这正是本迁移保留编码的原因）。
--     但回滚后新产生的退货单仍需应用侧写入编码才可回库。
-- ============================================================
