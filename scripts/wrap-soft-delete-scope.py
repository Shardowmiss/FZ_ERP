#!/usr/bin/env python3
"""Wrap `this.db` with scopeDatabase(db) in every service that injects DRIZZLE_DATABASE.

This applies the global soft-delete scope (P2-10 进阶) at the DI boundary with
zero query call-site changes. Idempotent.
"""
import re
import sys

SERVICES = [
    "server/modules/promotions/promotions.service.ts",
    "server/modules/offline-sync/offline-sync.service.ts",
    "server/modules/erp-integration/erp-integration.service.ts",
    "server/modules/master-data/master-data.service.ts",
    "server/modules/inventory/inventory.service.ts",
    "server/modules/stock/stock.service.ts",
    "server/modules/dashboard/dashboard.service.ts",
    "server/modules/returns/returns.service.ts",
    "server/modules/omnichannel/omnichannel.service.ts",
    "server/modules/shift/shift.service.ts",
    "server/modules/members/members.service.ts",
    "server/modules/auth/auth.service.ts",
    "server/modules/sales/sales.service.ts",
    "server/modules/settings/settings.service.ts",
]

INJECT_LINE = "@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,"
ASSIGN = "this.db = scopeDatabase(this.db);"


def add_import(content: str) -> str:
    if "from '@server/database/soft-delete'" in content:
        # merge scopeDatabase into existing soft-delete import
        def repl(m):
            names = m.group(1)
            if "scopeDatabase" in names:
                return m.group(0)
            names = names.rstrip().rstrip(",")
            return "import { %s, scopeDatabase } from '@server/database/soft-delete';" % names

        return re.sub(
            r"import\s*\{([^}]*)\}\s*from\s*'@server/database/soft-delete';",
            repl,
            content,
            count=1,
        )
    # insert new import right after the drizzle-tokens import line
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if "from '@server/database/drizzle-tokens';" in line:
            lines.insert(i + 1, "import { scopeDatabase } from '@server/database/soft-delete';")
            return "\n".join(lines)
    # fallback: prepend
    return "import { scopeDatabase } from '@server/database/soft-delete';\n" + content


def wrap_constructor(content: str) -> str:
    idx = content.find(INJECT_LINE)
    if idx == -1:
        print("  ! constructor not found, skip", file=sys.stderr)
        return content
    if ASSIGN in content:
        return content  # already wrapped (idempotent)

    m = re.search(r"\)\s*\{", content[idx:])
    if not m:
        print("  ! constructor close not found", file=sys.stderr)
        return content
    close_start = idx + m.start()
    brace_open = close_start + m.group(0).rfind("{")
    rest = content[brace_open + 1:]
    stripped = rest.lstrip()
    if stripped.startswith("}"):
        close_end = brace_open + 1 + (len(rest) - len(stripped))
        new_block = "  ) {\n    " + ASSIGN + "\n  }"
        content = content[:close_start] + new_block + content[close_end + 1:]
    else:
        content = content[: brace_open + 1] + "\n    " + ASSIGN + content[brace_open + 1 :]
    return content


def main():
    for path in SERVICES:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        original = content
        content = add_import(content)
        content = wrap_constructor(content)
        if content != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            print("updated:", path)
        else:
            print("no change:", path)


if __name__ == "__main__":
    main()
