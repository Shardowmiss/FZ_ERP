#!/usr/bin/env python3
"""将 ERP 源码导出为 ZIP，文件名带日期与自增版本号。

命名规则：erp_source_export{YYYYMMDD}_V{n}.zip
- 日期 = 导出当天
- 版本 = 扫描目标目录下已有 `erp_source_export*_V*.zip`，取最大版本号 +1（无则从 V1 起）
- 全局自增：每次导出版本 +1（满足"多次导出版本号每次加1"）

排除项（体积大 / 二进制 / 含敏感信息 / 构建产物，均非源码）：
  node_modules, .pgdata, dist, .env, .spark, .spark_project,
  coverage, .cache, .DS_Store, *.zip
"""
import os
import re
import sys
import zipfile
from datetime import date

SRC = '/Users/woxxnixx/WorkBuddy/2026-09-17-14-43-21/erp_source'
OUT_DIR = '/Users/woxxnixx/ai_project'

EXCLUDE_DIRS = {
    'node_modules', '.pgdata', 'dist', 'coverage', '.cache',
    '.spark', '.spark_project', '.workbuddy', '.idea', '.vscode',
}
EXCLUDE_FILES = {'.env', '.DS_Store'}
EXCLUDE_EXT = {'.zip', '.log', '.tmp'}

VERSION_RE = re.compile(r'erp_source_export\d*_V(\d+)\.zip$')


def next_version(out_dir: str) -> int:
    max_v = 0
    try:
        names = os.listdir(out_dir)
    except FileNotFoundError:
        return 1
    for n in names:
        m = VERSION_RE.search(n)
        if m:
            max_v = max(max_v, int(m.group(1)))
    return max_v + 1


def should_skip(rel_path: str) -> bool:
    parts = rel_path.split('/')
    # 排除目录组件
    for p in parts[:-1]:
        if p in EXCLUDE_DIRS:
            return True
    fname = parts[-1]
    if fname in EXCLUDE_FILES:
        return True
    if fname in EXCLUDE_DIRS:
        return True
    _, ext = os.path.splitext(fname)
    if ext.lower() in EXCLUDE_EXT:
        return True
    return False


def main() -> int:
    today = date.today().strftime('%Y%m%d')
    v = next_version(OUT_DIR)
    out_name = f'erp_source_export{today}_V{v}.zip'
    out_path = os.path.join(OUT_DIR, out_name)

    os.makedirs(OUT_DIR, exist_ok=True)

    n_files = 0
    total_bytes = 0
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(SRC):
            # 原地剪枝：不进入排除目录
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, SRC)
                arcname = f'erp_source/{rel}'
                if should_skip(rel):
                    continue
                try:
                    st = os.stat(full)
                    zf.write(full, arcname)
                    n_files += 1
                    total_bytes += st.st_size
                except OSError as e:
                    print(f'  skip {rel}: {e}', file=sys.stderr)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f'已导出：{out_path}')
    print(f'  版本：V{v}  日期：{today}')
    print(f'  文件数：{n_files}  源大小：{total_bytes/1024/1024:.1f} MB  压缩后：{size_mb:.1f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
