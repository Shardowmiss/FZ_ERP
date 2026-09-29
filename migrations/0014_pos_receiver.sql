-- ============================================================================
-- 0014 POS 上行接收「落地区」
-- 目的：为云裁POS（TEST-P 同空间门店POS）推送的 5 类单据提供 ERP 侧接收落库。
--   - 销售/盘点 复用既有 retail_order / inventory_stocktake
--   - 退货/要货/日结 落入本迁移新建的解耦落地表，避免污染 wholesale 强外键域
--   - pos_store_map：POS storeCode ↔ ERP store.id 主数据映射
--   - pos_receive_log：(biz_type,pos_doc_no) 唯一，保证 POS 重试幂等
--   - pos_receiver_seq：ERP 单号生成序列（erpNo）
-- 设计依据：ERP与POS联调可行性报告 §6 上行缺口 P0-①
-- 幂等：全部 IF NOT EXISTS / CREATE ... IF NOT EXISTS
-- ============================================================================
BEGIN;

-- 单号序列（日结/退货/要货/盘点的 ERP 单号前缀 + YYYYMMDD + 序列）
CREATE SEQUENCE IF NOT EXISTS pos_receiver_seq START WITH 1 INCREMENT BY 1;

-- 门店编码映射
CREATE TABLE IF NOT EXISTS pos_store_map (
  store_code varchar(50) PRIMARY KEY,
  store_id   uuid NOT NULL,
  store_name varchar(200),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pos_store_map_store_id_fkey FOREIGN KEY (store_id)
    REFERENCES "store" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pos_store_map_store_id ON pos_store_map (store_id);

-- 上行幂等日志
CREATE TABLE IF NOT EXISTS pos_receive_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_type    varchar(20) NOT NULL,
  pos_doc_no  varchar(50) NOT NULL,
  erp_no      varchar(50),
  status      varchar(20) NOT NULL DEFAULT 'success',
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_receive_log_uniq ON pos_receive_log (biz_type, pos_doc_no);
CREATE INDEX IF NOT EXISTS idx_pos_receive_log_erp_no ON pos_receive_log (erp_no);

-- POS 零售退货
CREATE TABLE IF NOT EXISTS pos_return (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no    varchar(50) NOT NULL,
  pos_order_no varchar(50),
  store_code   varchar(50) NOT NULL,
  store_id     uuid,
  store_name   varchar(200),
  return_date  date NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  reason       varchar(200),
  status       varchar(20) NOT NULL DEFAULT 'received',
  remark       text,
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_return_return_no_key ON pos_return (return_no);
CREATE INDEX IF NOT EXISTS idx_pos_return_store ON pos_return (store_code, return_date);

CREATE TABLE IF NOT EXISTS pos_return_item (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id  uuid NOT NULL,
  sku_code   varchar(100) NOT NULL,
  style_no   varchar(50),
  color      varchar(50),
  size       varchar(50),
  quantity   numeric NOT NULL DEFAULT 0,
  price      numeric NOT NULL DEFAULT 0,
  amount     numeric NOT NULL DEFAULT 0,
  batch_no   varchar(50),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pos_return_item_return_id_fkey FOREIGN KEY (return_id)
    REFERENCES pos_return (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pos_return_item_ret ON pos_return_item (return_id);

-- POS 门店要货申请
CREATE TABLE IF NOT EXISTS pos_requisition (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  req_no       varchar(50) NOT NULL,
  store_code   varchar(50) NOT NULL,
  store_id     uuid,
  store_name   varchar(200),
  req_date     date NOT NULL,
  status       varchar(20) NOT NULL DEFAULT 'submitted',
  remark       text,
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_requisition_req_no_key ON pos_requisition (req_no);
CREATE INDEX IF NOT EXISTS idx_pos_requisition_store ON pos_requisition (store_code, req_date);

CREATE TABLE IF NOT EXISTS pos_requisition_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL,
  sku_code       varchar(100) NOT NULL,
  style_no       varchar(50),
  color          varchar(50),
  size           varchar(50),
  qty            numeric NOT NULL DEFAULT 0,
  remark         varchar(200),
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pos_requisition_item_requisition_id_fkey FOREIGN KEY (requisition_id)
    REFERENCES pos_requisition (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pos_requisition_item_req ON pos_requisition_item (requisition_id);

-- POS 门店日结
CREATE TABLE IF NOT EXISTS pos_daily_settle (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settle_no      varchar(50) NOT NULL,
  store_code     varchar(50) NOT NULL,
  store_id       uuid,
  store_name     varchar(200),
  settle_date    date NOT NULL,
  session_id     varchar(50),
  cashier_name   varchar(50),
  cash_amount    numeric NOT NULL DEFAULT 0,
  card_amount    numeric NOT NULL DEFAULT 0,
  wechat_amount  numeric NOT NULL DEFAULT 0,
  alipay_amount  numeric NOT NULL DEFAULT 0,
  other_amount   numeric NOT NULL DEFAULT 0,
  total_amount   numeric NOT NULL DEFAULT 0,
  deposit_amount numeric NOT NULL DEFAULT 0,
  diff_amount    numeric NOT NULL DEFAULT 0,
  status         varchar(20) NOT NULL DEFAULT 'settled',
  remark         text,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_daily_settle_settle_no_key ON pos_daily_settle (settle_no);
CREATE INDEX IF NOT EXISTS idx_pos_daily_settle_store ON pos_daily_settle (store_code, settle_date);

COMMIT;
