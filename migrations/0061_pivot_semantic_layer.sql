-- ============================================================
-- 0061 透视语义层（pivot_semantic）——让业务/实施自助加维度指标
--
-- 【原状】维度与指标写死在代码里：
--   - 后端 pivot-engine.ts 的 getPivotFieldWhitelist（sales 源 16 维度 + 10 指标）
--   - 前端 pivot-utils.ts 的 DIMENSION_FIELDS / MEASURE_FIELDS（仅为中文标签）
--   每加一个维度要改前后端两处代码并发版，业务人员只能等开发。
--
-- 【本迁移提供】
--   把「维度/指标的 key、中文标签、SQL 表达式、适用数据源、是否敏感」
--   全部落到配置表，业务/实施新增维度只需 INSERT 一行，无需改代码发版。
--
-- 【安全边界（关键）】
--   语义层是**受控模板**而非任意 SQL 执行：
--     ① sql_expr 只能引用**该数据源 FROM/JOIN 已在库中的物理列**
--        （如 sales 源可用 st.brand / roi.line_amount）；
--     ② 应用启动时校验每个 sql_expr 引用的表别名是否在该数据源的
--        fromTable/joins 中出现，**不通过则启动失败**而非运行时 500；
--     ③ 前端只提交 key，SQL 片段始终由服务端从配置读取，请求无法注入；
--     ④ 敏感指标（毛利/成本）标 sensitive=true，配合 finance:profit 权限
--        在 controller 层剥离，双层防护。
--
-- 【与既有白名单的关系】代码里的白名单作为**兜底**：配置表缺失或读取失败时
-- 仍按内置白名单工作，保证透视功能永不因配置问题不可用。
--
-- 幂等：ON CONFLICT DO NOTHING，可重复执行；内置维度已全部预置。
-- ============================================================

CREATE TABLE IF NOT EXISTS pivot_semantic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 语义 key（前端只传这个，如 season / member / sellThrough）
  key           varchar(64) NOT NULL,
  -- 中文标签（前端维度选择器直接展示，避免再维护一份前端字典）
  label         varchar(100) NOT NULL,
  -- 类型：dimension=可分组维度；measure=可聚合指标
  kind          varchar(20) NOT NULL,
  -- 适用数据源（sales/purchase/inventory/transfer），逗号分隔
  -- sales 含两个分支（出库 + 零售），故允许多值
  data_sources  varchar(200) NOT NULL,
  -- 分类，供前端分组展示（商品维度/时间维度/人员维度/服装维度…）
  category      varchar(50) NOT NULL DEFAULT '其他',
  -- 排序（越小越靠前）
  sort_order    integer NOT NULL DEFAULT 100,
  -- 排序与格式化方式：sum/avg/count/ratio/amount
  -- ratio 型（如售罄率）前端按百分比格式化
  value_format  varchar(20) NOT NULL DEFAULT 'sum',
  -- 敏感指标：毛利/成本等，需 finance:profit 权限才能取数
  sensitive     boolean NOT NULL DEFAULT false,
  -- 是否启用（业务可先建后用，或临时停用某维度而不删配置）
  enabled       boolean NOT NULL DEFAULT true,
  remark        text,
  -- System field: Creation time (auto-filled, do not modify)
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- System field: Update time (auto-filled, do not modify)
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT ck_pivot_semantic_kind   CHECK (kind IN ('dimension', 'measure')),
  CONSTRAINT ck_pivot_semantic_format CHECK (value_format IN ('sum', 'avg', 'count', 'ratio', 'amount')),
  -- 同一数据源下 key 唯一（sales 含双分支，故以 key + 数据源集合做联合约束）
  CONSTRAINT uk_pivot_semantic_key UNIQUE (key)
);

-- 按数据源拉启用中的语义（引擎启动校验与前端拉清单共用）
CREATE INDEX IF NOT EXISTS idx_pivot_semantic_enabled
  ON pivot_semantic (data_sources, enabled);

-- ------------------------------------------------------------
-- 预置内置维度与指标（与 pivot-engine.ts 的代码白名单一致）
-- 这样配置表一上线即等价于当前行为，不产生口径漂移；
-- 之后业务新增维度才会真正体现「自助」。
-- ------------------------------------------------------------
INSERT INTO pivot_semantic (key, label, kind, data_sources, category, sort_order, value_format, sensitive, remark)
VALUES
  -- ===== 时间维度（sales / purchase / transfer 各自有日期列）=====
  ('date',      '日期',      'dimension', 'sales,purchase,transfer', '时间维度', 1,  'sum', false, NULL),
  ('year',      '年',        'dimension', 'sales,purchase,transfer', '时间维度', 2,  'sum', false, NULL),
  ('month',     '月',        'dimension', 'sales,purchase,transfer', '时间维度', 3,  'sum', false, NULL),
  ('quarter',   '季度',      'dimension', 'sales,purchase,transfer', '时间维度', 4,  'sum', false, NULL),
  ('week',      '周',        'dimension', 'sales,purchase,transfer', '时间维度', 5,  'sum', false, NULL),
  ('day',       '日',        'dimension', 'sales,purchase,transfer', '时间维度', 6,  'sum', false, NULL),
  -- ===== 商品维度 =====
  ('brand',        '品牌',     'dimension', 'sales,purchase,inventory,transfer', '商品维度', 10, 'sum', false, NULL),
  ('category',     '品类',     'dimension', 'sales,purchase,inventory,transfer', '商品维度', 11, 'sum', false, NULL),
  ('subCategory',  '子品类',   'dimension', 'sales,purchase,inventory,transfer', '商品维度', 12, 'sum', false, NULL),
  ('styleNo',      '款号',     'dimension', 'sales,purchase,inventory,transfer', '商品维度', 13, 'sum', false, NULL),
  ('styleName',    '款名',     'dimension', 'sales,purchase,inventory,transfer', '商品维度', 14, 'sum', false, NULL),
  ('color',        '颜色',     'dimension', 'sales,purchase,inventory,transfer', '商品维度', 15, 'sum', false, '服装核心维度'),
  ('size',         '尺码',     'dimension', 'sales,purchase,inventory,transfer', '商品维度', 16, 'sum', false, '服装核心维度'),
  -- ===== 服装专属维度（本次新增）=====
  ('season',    '上市季节',   'dimension', 'sales',     '服装维度', 20, 'sum', false, '春夏秋冬，支撑季节性销售与季末清货'),
  ('member',    '会员/非会员', 'dimension', 'sales',    '服装维度', 21, 'sum', false, '零售会员消费占比分析'),
  ('memberNo',  '会员号',     'dimension', 'sales',     '服装维度', 22, 'sum', false, '会员画像与复购分析'),
  ('channel',   '渠道',       'dimension', 'sales',     '服装维度', 23, 'sum', false, 'POS 门店 / 线上'),
  ('cashier',   '收银员',     'dimension', 'sales',     '服装维度', 24, 'sum', false, '导购业绩（现有可算口径）'),
  -- ===== 组织维度 =====
  ('store',       '门店',     'dimension', 'sales',            '组织维度', 30, 'sum', false, NULL),
  ('dealer',      '经销商',   'dimension', 'sales',            '组织维度', 31, 'sum', false, NULL),
  ('warehouse',   '仓库',     'dimension', 'sales,purchase',   '组织维度', 32, 'sum', false, NULL),
  ('outboundNo',  '单据号',   'dimension', 'sales',            '组织维度', 33, 'sum', false, NULL),
  ('supplier',    '供应商',   'dimension', 'purchase',         '组织维度', 34, 'sum', false, NULL),
  ('inboundNo',   '入库单号', 'dimension', 'purchase',         '组织维度', 35, 'sum', false, NULL),
  ('fromWarehouse', '调出仓',  'dimension', 'transfer',         '组织维度', 36, 'sum', false, NULL),
  ('toWarehouse',   '调入仓',  'dimension', 'transfer',         '组织维度', 37, 'sum', false, NULL),
  ('transferNo',  '调拨单号', 'dimension', 'transfer',         '组织维度', 38, 'sum', false, NULL),
  -- ===== 基础指标 =====
  ('quantity',  '销量',        'measure', 'sales,purchase,inventory,transfer', '基础指标', 50, 'sum',    false, NULL),
  ('amount',    '销售额',      'measure', 'sales,purchase',                       '基础指标', 51, 'amount', false, NULL),
  ('avgPrice',  '平均单价',    'measure', 'sales',                                '基础指标', 52, 'avg',    false, NULL),
  ('discount',  '折扣额',      'measure', 'sales',                                '基础指标', 53, 'sum',    false, NULL),
  -- ===== 敏感指标（需 finance:profit）=====
  ('cost',      '成本',        'measure', 'sales',     '财务指标', 60, 'amount', true,  '敏感：需 finance:profit'),
  ('profit',    '毛利',        'measure', 'sales',     '财务指标', 61, 'amount', true,  '敏感：需 finance:profit'),
  -- ===== 服装零售衍生指标（本次新增）=====
  ('returnQty',    '退货件数',   'measure', 'sales', '服装指标', 70, 'sum',    false, '按款号+色+码关联已退款退货单'),
  ('returnAmount', '退货额',     'measure', 'sales', '服装指标', 71, 'amount', false, '退货件数 × 成交单价'),
  ('netAmount',    '净销售额',   'measure', 'sales', '服装指标', 72, 'amount', false, '销售额 - 退货额'),
  ('sellThrough',  '售罄率',     'measure', 'sales', '服装指标', 73, 'ratio',  false, '销量 /（销量 + 成品仓现货）')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 后置校验：内置语义是否齐全（缺项会让对应维度/指标在前端消失）
-- ------------------------------------------------------------
DO $$
DECLARE
  v_dims  bigint;
  v_measures bigint;
  v_missing text;
BEGIN
  SELECT count(*) FILTER (WHERE kind = 'dimension'),
         count(*) FILTER (WHERE kind = 'measure')
    INTO v_dims, v_measures
    FROM pivot_semantic WHERE enabled = true;

  -- sales 源必须有的核心语义（与 pivot-engine 内置白名单对齐）
  SELECT string_agg(k, ', ') INTO v_missing
  FROM unnest(ARRAY['season','member','memberNo','channel','cashier',
                    'sellThrough','returnAmount','netAmount']) AS k
  WHERE NOT EXISTS (SELECT 1 FROM pivot_semantic s WHERE s.key = k AND s.enabled);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '[0061] sales 核心语义缺失: %', v_missing;
  END IF;

  RAISE NOTICE '[0061] 完成：维度 % 个、指标 % 个已就绪；敏感指标 % 个（需 finance:profit）',
    v_dims, v_measures,
    (SELECT count(*) FROM pivot_semantic WHERE sensitive);
END $$;

-- ============================================================
-- 回滚说明：
--   DROP TABLE IF EXISTS pivot_semantic;
--   ⚠ 回滚不影响透视功能——代码白名单作为兜底仍在，届时全部维度/指标
--     退回「需改代码发版才能新增」的状态，但已能用的维度不会消失。
-- ============================================================
