#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# F.2 一键起本地开发环境（主要是：确保 postgres 已启动，根治“登录 500 = 忘了起库”）
#
# 本仓库权威库是本地 homebrew postgres@16 集群，数据目录 erp_source/.pgdata，
# 端口 5434（postgresql.conf 里 port 是注释掉的默认 5432，故启动时必须显式 -p 5434）。
# 重要：本仓库 migrations/*.sql 不能从零建库，.pgdata 是唯一结构来源，
# 因此本脚本【绝不 initdb】，仅在 .pgdata 已存在时 pg_ctl start。
#
# 用法：
#   bash scripts/dev-up.sh                 # 仅确保主库(erp_db)就绪
#   bash scripts/dev-up.sh --with-test-db  # 额外重建单元测试库 erp_test
#
# 启动后应用：
#   后端  npm run dev:server
#   前端  npm run dev:client   （或 npm run dev 同时起前后端）
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
REPO_ROOT="$(pwd)"

# ---- 解析 SUDA_DATABASE_URL（与应用同源，避免 host/port/user 写死两处）----
if [ ! -f .env ]; then
  echo "找不到 .env，无法解析数据库连接串" >&2
  exit 1
fi
eval "$(node -e '
const m = require("fs").readFileSync(".env", "utf8").match(/^SUDA_DATABASE_URL=(.*)$/m);
if (!m) { console.error(".env 中未找到 SUDA_DATABASE_URL"); process.exit(1); }
const u = new URL(m[1].trim());
console.log(`DB_HOST="${u.hostname}"`);
console.log(`DB_PORT="${u.port || 5432}"`);
console.log(`DB_USER="${decodeURIComponent(u.username)}"`);
console.log(`DB_NAME="${decodeURIComponent(u.pathname.slice(1))}"`);
')"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

# ---- 定位 pg_ctl / pg_isready ----
if command -v pg_ctl >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v pg_ctl)")"
elif [ -x /opt/homebrew/opt/postgresql@16/bin/pg_ctl ]; then
  PG_BIN=/opt/homebrew/opt/postgresql@16/bin
else
  echo "找不到 pg_ctl（请先安装 homebrew postgresql@16：brew install postgresql@16）" >&2
  exit 1
fi

PGDATA="$REPO_ROOT/.pgdata"
ready() { "$PG_BIN/pg_isready" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; }

echo "==> 目标数据库：$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

if ready; then
  echo "==> 数据库已在运行，无需操作。"
else
  if [ ! -d "$PGDATA/base" ]; then
    echo "错误：未找到 $PGDATA/base，无法从零初始化集群。" >&2
    echo "      本仓库迁移脚本不能建库，.pgdata 是唯一结构来源。" >&2
    echo "      请恢复 .pgdata 目录（从备份或同事处同步），再运行本脚本。" >&2
    exit 1
  fi

  # 清理可能残留的 postmaster.pid（仅当确实没有 postgres 进程在监听该端口时）
  if [ -f "$PGDATA/postmaster.pid" ] && ! ready; then
    echo "==> 发现残留 postmaster.pid 且端口无响应，尝试清理..."
    rm -f "$PGDATA/postmaster.pid"
  fi

  echo "==> 启动 postgres (pg_ctl -D $PGDATA -o '-p $DB_PORT -c listen_addresses=localhost') ..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" \
    -o "-p $DB_PORT -c listen_addresses=localhost" \
    -l "$PGDATA/postmaster.log" start || {
      echo "启动失败，详见 $PGDATA/postmaster.log：" >&2
      tail -n 20 "$PGDATA/postmaster.log" 2>/dev/null >&2
      exit 1
    }

  # 等待就绪（最多 30s）
  for i in $(seq 1 30); do
    if ready; then break; fi
    sleep 1
  done
fi

if ready; then
  echo "==> 数据库就绪 ✅"
else
  echo "==> 数据库仍未就绪，请检查 $PGDATA/postmaster.log" >&2
  exit 1
fi

# ---- 可选：重建单元测试库 erp_test ----
if [ "${1:-}" = "--with-test-db" ]; then
  echo "==> 重建单元测试库 erp_test ..."
  bash "$REPO_ROOT/scripts/setup-test-db.sh"
fi

echo
echo "==> 下一步启动应用："
echo "    后端  : npm run dev:server"
echo "    前端  : npm run dev:client"
echo "    或同时: npm run dev"
