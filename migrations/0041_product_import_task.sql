-- 0041 商品资料批量导入任务表（款号 / SKU）
--
-- 背景（商品资料「批量导入」功能，用户需求）：
--   商品资料下新增「款号批量导入」「SKU 批量导入」，提供 Excel 模板；每次导入记录
--   Excel 原文件（file_url）+ 解析后的全量数据内容（rows）；导入时列出「不支持格式
--   清单」与「已存在清单」，SKU 导入须校验系统中款号/颜色/尺码主数据存在；可编码重导、
--   后一次覆盖前一次（草稿）；点击「审核」才批量写入商品库（仅新增、跳过已存在）。
--
-- 状态机：draft → approved；重导时旧 draft 置为 superseded。
--   - import_type ∈ { 'style', 'sku' }
--   - status      ∈ { 'draft', 'approved', 'superseded' }
--
-- 三处同步（ERP 侧）：本迁移 → schema.ts 声明 productImportTask → scripts/setup-test-db.sh 重克隆 erp_test。
-- 可重复执行（IF NOT EXISTS / 条件 GRANT 无害）。

CREATE TABLE IF NOT EXISTS product_import_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type varchar(16) NOT NULL
    CHECK (import_type IN ('style', 'sku')),
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'superseded')),
  file_name varchar(255),
  file_url text,
  file_path text,
  bucket_id varchar(100),
  total_rows integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);

-- ============ 索引 ============
CREATE INDEX IF NOT EXISTS idx_product_import_type_status
  ON product_import_task (import_type, status);
CREATE INDEX IF NOT EXISTS idx_product_import_created
  ON product_import_task (_created_at);

-- ============ 平台权限：新建 public 对象须补 GRANT 给 anon_（铁律#5） ============
-- 仅授权 DML + 表级（无序列，故无需 GRANT USAGE ON SEQUENCE）；schema public 的 USAGE
-- 默认对 PUBLIC 角色开放，anon_ 继承，无需单独授予。
GRANT SELECT, INSERT, UPDATE, DELETE ON product_import_task TO anon_;

-- ============ 数据字典注释 ============
COMMENT ON TABLE product_import_task IS '商品资料批量导入任务（款号/ SKU）：记录每次上传的 Excel 原文件与解析数据，草稿可重导覆盖，审核后批量写入商品库';
COMMENT ON COLUMN product_import_task.import_type IS '导入类型：style=款号批量导入；sku=SKU 批量导入';
COMMENT ON COLUMN product_import_task.status IS 'draft=草稿(可重导覆盖) / approved=已审核入库 / superseded=被后续重导覆盖';
COMMENT ON COLUMN product_import_task.file_name IS '上传的 Excel 原文件名（留档）';
COMMENT ON COLUMN product_import_task.file_url IS '上传 Excel 原文件存储地址（apaas 桶直传 url）';
COMMENT ON COLUMN product_import_task.file_path IS '文件在桶内的路径（可选）';
COMMENT ON COLUMN product_import_task.bucket_id IS '存储桶 ID（可选）';
COMMENT ON COLUMN product_import_task.total_rows IS '解析出的有效数据行数';
COMMENT ON COLUMN product_import_task.summary IS '校验汇总：{ total, ok, existed, unsupported, missingMasterData, inserted, skipped }';
COMMENT ON COLUMN product_import_task.rows IS '逐行明细：[{ rowIndex, raw, status, reason }]，status ∈ ok|existed|unsupported|missing_master';
