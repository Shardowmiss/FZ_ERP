#!/usr/bin/env bash
#
# W1-4 灾备自动化: erp_db 逻辑备份 (pg_dump -Fc) + 轮转保留 + 完整性校验
#
# 安全铁律（对齐 .workbuddy/memory 铁律#1: 库不可从迁移重建）:
#   - 本脚本只做「逻辑备份」(pg_dump --format=custom)，绝不 rm -rf .pgdata、
#     绝不重建数据目录；恢复由 restore-erp-db.sh 用 pg_restore --clean 完成。
#   - 备份文件为逻辑转储，可跨小版本恢复，且独立于物理数据目录，规避单盘损坏即全损。
#
# 用法:
#   ./scripts/backup-erp-db.sh              # 默认备份到 ./backups，保留最近 14 份
#   ERP_DB_URL=... ./scripts/backup-erp-db.sh
#   BACKUP_DIR=/data/backups RETAIN=30 ./scripts/backup-erp-db.sh
#
set -euo pipefail

# ---- 解析连接串 (优先 ERP_DB_URL，回退 .env 的 SUDA_DATABASE_URL，再回退默认值) ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${ERP_DB_URL:-}" ]]; then
  if [[ -f "$REPO_ROOT/.env" ]]; then
    ERP_DB_URL="$(grep -E '^SUDA_DATABASE_URL=' "$REPO_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
  fi
fi
ERP_DB_URL="${ERP_DB_URL:-postgres://erp:erp@localhost:5434/erp_db}"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETAIN="${RETAIN:-14}"            # 保留最近 N 份
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/erp_db-${TS}.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup] erp_db -> $OUT"
echo "[backup] url=${ERP_DB_URL//:*@/:***@}"   # 掩码密码

# ---- 逻辑备份 (custom 格式，便于 pg_restore 选择性恢复与并行) ----
# 凭据已包含在 --dbname 的 URL 中，无需单独设 PGPASSWORD。
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --dbname="$ERP_DB_URL" \
  --file="$OUT"

# ---- 完整性校验: pg_restore -l 能列出即文件未损坏 ----
if pg_restore --list "$OUT" >/dev/null 2>&1; then
  SIZE="$(du -h "$OUT" | cut -f1)"
  echo "[backup] OK  size=$SIZE"
else
  echo "[backup] FAIL 备份文件损坏，删除" >&2
  rm -f "$OUT"
  exit 1
fi

# ---- 轮转: 仅保留最近 RETAIN 份 ----
# POSIX 可移植写法: 按修改时间倒序列出，跳过前 RETAIN 份，删除更旧的超额文件。
# 仅匹配 erp_db-*.dump，绝不递归、绝不碰其他目录，规避单盘/误删风险。
KEEP="$RETAIN"
OLDFILES="$(ls -1t "$BACKUP_DIR"/erp_db-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) || true)"
if [[ -n "$OLDFILES" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    echo "[backup] rotate remove $f"
    rm -f "$f"
  done <<< "$OLDFILES"
fi

# 统计当前保留份数
CUR="$(ls -1 "$BACKUP_DIR"/erp_db-*.dump 2>/dev/null | wc -l | tr -d ' ')"
echo "[backup] done. 当前保留 $CUR 份 (上限 $RETAIN)。"
