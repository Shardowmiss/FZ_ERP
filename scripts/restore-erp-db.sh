#!/usr/bin/env bash
#
# W1-4 灾备自动化: 从逻辑备份恢复进目标库 (pg_restore --clean --if-exists)
#
# 安全铁律（对齐 .workbuddy/memory 铁律#1: 库不可从迁移重建）:
#   - 只做「逻辑恢复」，绝不 rm -rf .pgdata、绝不重建数据目录。
#   - 恢复实时库 erp_db 须显式 --confirm（双保险），避免误操作清空生产数据。
#   - 推荐先 --dry-run 查看内容，或 --target 指向演练库验证后再恢复生产。
#
# 用法:
#   ./scripts/restore-erp-db.sh --file backups/erp_db-xxx.dump --dry-run
#   ./scripts/restore-erp-db.sh --file backups/erp_db-xxx.dump --target erp_drill
#   ./scripts/restore-erp-db.sh --file backups/erp_db-xxx.dump --confirm   # 恢复进实时 erp_db
#
set -euo pipefail

FILE=""
TARGET=""
DRY_RUN=0
CONFIRM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)   FILE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --confirm) CONFIRM=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$FILE" ]]; then
  echo "用法: $0 --file <dump> [--target <db>] [--dry-run] [--confirm]" >&2
  exit 2
fi
if [[ ! -f "$FILE" ]]; then
  echo "备份文件不存在: $FILE" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${ERP_DB_URL:-}" && -f "$REPO_ROOT/.env" ]]; then
  ERP_DB_URL="$(grep -E '^SUDA_DATABASE_URL=' "$REPO_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
fi
ERP_DB_URL="${ERP_DB_URL:-postgres://erp:erp@localhost:5434/erp_db}"

# 目标库: 显式 --target 优先；否则取连接串中的库名
if [[ -z "$TARGET" ]]; then
  TARGET="${ERP_DB_URL##*/}"
fi

# 恢复实时 erp_db 必须 --confirm（dry-run 为只读预览，放行）
if [[ "$TARGET" == "erp_db" && "$CONFIRM" -ne 1 && "$DRY_RUN" -ne 1 ]]; then
  echo "⚠️  即将恢复进实时库 erp_db，这会清空并重建其中的所有对象！" >&2
  echo "     如需继续，请追加 --confirm；演练请改用 --target <演练库名>。" >&2
  exit 1
fi

echo "[restore] 源=$FILE"
echo "[restore] 目标库=$TARGET  (url=${ERP_DB_URL//:*@/:***@})"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[restore] --dry-run: 仅列出备份内容"
  pg_restore --list "$FILE"
  exit 0
fi

# 逻辑恢复: --clean 先 DROP 已有对象，--if-exists 避免缺对象报错，--no-owner 复用目标库角色
pg_restore \
  --dbname="${ERP_DB_URL%/*}/$TARGET" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --format=custom \
  --jobs=4 \
  "$FILE"

echo "[restore] OK 已完成逻辑恢复至 ${TARGET}。"
