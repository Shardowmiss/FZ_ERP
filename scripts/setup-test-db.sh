#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 重建 ERP 单元测试库 erp_test。
#
# 为什么不用 migrations/*.sql：那批脚本内部存在未声明的前置依赖（0001 就引用
# 了并未建出的 user_profile 类型），顺序跑通需要既有库做底座，无法从零建库。
# 因此改为直接复刻真实开发库（erp_db）的**结构**，保证「测的结构 == 跑的结构」，
# 不会像手写 DDL 那样随时间漂移。
#
# 做法：drop → create → pg_dump --schema-only erp_db → 导入 erp_test。
#
# 用法：  bash scripts/setup-test-db.sh
# 覆盖：  ERP_TEST_DATABASE=erp_test（默认）
# ---------------------------------------------------------------------------
set -euo pipefail

# 从 .env 读连接串（与应用同源），避免 host/port/user 写死两处
if [ ! -f .env ]; then
  echo "找不到 .env，无法解析数据库连接串" >&2
  exit 1
fi
URL_LINE=$(grep -m1 '^SUDA_DATABASE_URL=' .env | cut -d= -f2-)
if [ -z "${URL_LINE}" ]; then
  echo ".env 中未找到 SUDA_DATABASE_URL" >&2
  exit 1
fi

# 用 Node 解析连接串（比 sed 解析 URL 可靠）
eval "$(node -e '
const m = require("fs").readFileSync(".env", "utf8").match(/^SUDA_DATABASE_URL=(.*)$/m);
if (!m) { console.error(".env 中未找到 SUDA_DATABASE_URL"); process.exit(1); }
const u = new URL(m[1].trim());
console.log(`HOST="${u.hostname}"`);
console.log(`PORT="${u.port || 5432}"`);
console.log(`USER="${decodeURIComponent(u.username)}"`);
console.log(`BASE="${decodeURIComponent(u.pathname.slice(1))}"`);
')"
HOST="${HOST:-localhost}"
TEST_DB="${ERP_TEST_DATABASE:-erp_test}"
PW="${PGPASSWORD:-erp}"

DUMP=$(mktemp /tmp/erp_schema_XXXX.sql)
trap 'rm -f "$DUMP"' EXIT

echo "==> 导出 ${BASE} 结构 → ${TEST_DB}"
PGPASSWORD="$PW" pg_dump -h "$HOST" -p "$PORT" -U "$USER" \
  --schema-only --no-owner --no-acl --no-privileges "$BASE" > "$DUMP"

PGPASSWORD="$PW" psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres \
  -q -c "DROP DATABASE IF EXISTS ${TEST_DB}" \
  -c "CREATE DATABASE ${TEST_DB} OWNER ${USER}"

PGPASSWORD="$PW" psql -h "$HOST" -p "$PORT" -U "$USER" -d "$TEST_DB" \
  -q -v ON_ERROR_STOP=1 -f "$DUMP"

N=$(PGPASSWORD="$PW" psql -h "$HOST" -p "$PORT" -U "$USER" -d "$TEST_DB" \
     -tAc "select count(*) from information_schema.tables where table_schema='public'")
echo "==> ${TEST_DB} 就绪，共 ${N} 张表（与 ${BASE} 结构一致）"
