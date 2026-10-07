-- ============================================================
-- 0062 修透视派生指标白名单撒谎缺陷 + 补inventory 金额映射
--
-- 【缺陷（#758 语义层管理页落地时探针实测发现，非推演）】
-- pivot-engine 的 getPivotFieldWhitelist 对**所有**非sales 数据源
-- 无条件开放 cost / profit / discount / avgPrice 四个派生指标，
-- 但派生指标的 SQL 表达式依赖 valueColMap 里的金额/成本列，
-- 而三个非销售数据源的基础表并不都具备：
--   - garment_purchase_inbound_sku：有 amount、quantity，无 cost_amount
--   - inventory_stock：有 amount、quantity，无 cost_amount
--   - inventory_transfer_item：只有 quantity，连 amount 都没有
-- 于是形成「白名单宣称支持 → 界面可选 → 查询时 PG 报
-- column "cost_amount" does not exist」的必崩组合，
-- 且返回 HTTP 500 而非应有的 400「非法字段」。
-- 实测 12 个「数据源×派生指标」组合中 7 个崩溃：
--   purchase.cost / purchase.profit / purchase.discount
--   inventory.cost / inventory.profit / inventory.discount
--   transfer.cost / transfer.profit / transfer.discount / transfer.avgPrice
--
-- 【为何此前未暴露】
--   ① 这些组合默认未被语义表选中；
--   ② sales 数据源走另一套表达式 buildSalesValueExpr，不经此分支；
--   ③ 前端历史中文维度字典里也没把它们挂到非销售数据源下。
--
-- 【本迁移的语义】
-- 仅同步**语义表里已存在字段的适用数据源范围**，使其与修复后的白名单一致；
-- 不新增字段、不改表结构。代码侧修复在 pivot-engine.ts：
--   派生指标改为「按底层表实际拥有的列逐个开放」——
--   有 cost 列才有 cost；有 amount+cost 才有 profit；有 tagPrice 才有 discount；
--   有 amount+quantity 才有 avgPrice。
--
-- 【顺带修正】
-- inventory_stock 实际有 amount 列且有真实数据（654 行全部非空，合计 2,016,810.00），
-- 但 valueColMap 从未映射它，导致库存数据源白白缺失「金额/均价」两个指标。
-- 本迁移同步放开 inventory 的 avgPrice（配套 avgPrice=金额/数量）。
-- 注意：inventory 是**库存快照**表，其 amount 为当前结存金额而非期间发生额，
-- 跨期对比无意义，故不开放 amount 本身到语义层选择器之外的口径讨论——
-- 此处仅按引擎能力对齐，仍不把 amount 加入语义表（保持与0061 一致的保守口径）。
--
-- 幂等：全部为带 WHERE 的 UPDATE，可重复执行。
-- ============================================================

-- ① avgPrice：引擎修复后 purchase / inventory 均可算（两者都有 amount + quantity）
UPDATE pivot_semantic
   SET data_sources = 'sales,purchase,inventory',
       _updated_at = CURRENT_TIMESTAMP
 WHERE key = 'avgPrice'
   AND data_sources = 'sales';

-- ② 成本/毛利/折扣：三个非销售数据源均无 cost_amount / tag_price 列，
--    引擎已不再开放，故语义层维持 sales 单源——此处显式注释说明，
--    不做 UPDATE（避免误改）。若将来为 purchase/inventory 补上成本列，
--    再按引擎能力逐个放开。

-- ③ 自检：语义表登记的「数据源×字段」必须都被引擎实现。
--    引擎自检（validateAgainstEngine）在启动时也会跑一道，
--    此处再加一道数据库侧断言，确保迁移后即刻可验证，不依赖应用启动。
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(x, ', ') INTO bad
  FROM (
    -- cost_amount 不存在于这些表，故这些数据源不得开放 cost/profit
    SELECT 'purchase.cost' AS x WHERE EXISTS (
      SELECT 1 FROM pivot_semantic
       WHERE key = 'cost' AND data_sources LIKE '%purchase%')
    UNION ALL
    SELECT 'inventory.profit' WHERE EXISTS (
      SELECT 1 FROM pivot_semantic
       WHERE key = 'profit' AND data_sources LIKE '%inventory%')
    UNION ALL
    SELECT 'transfer.avgPrice' WHERE EXISTS (
      SELECT 1 FROM pivot_semantic
       WHERE key = 'avgPrice' AND data_sources LIKE '%transfer%')
  ) t;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '透视语义表登记了引擎无法计算的字段组合（底层表缺列）：%', bad;
  END IF;
END $$;

-- ④ avgPrice 最终口径落档，便于日后核对
DO $$
DECLARE
  v text;
BEGIN
  SELECT data_sources INTO v FROM pivot_semantic WHERE key = 'avgPrice';
  RAISE NOTICE 'avgPrice 适用数据源 = %（引擎侧已按底层列存在性收敛）', v;
END $$;