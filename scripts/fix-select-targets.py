import re, glob

NULLABLE = {'closingCash'}
files = glob.glob('server/modules/**/*.service.ts', recursive=True)
# 表名 posXxx + 列名 camelCase(含大写)
pat = re.compile(r'fromCents\((pos[A-Z]\w+)\.([a-zA-Z_][a-zA-Z0-9_]*)\)')

changed = []
for f in sorted(files):
    with open(f, encoding='utf-8') as fh:
        src = fh.read()
    orig = src
    def repl(m):
        tbl, col = m.group(1), m.group(2)
        if col in NULLABLE:
            return "sql<number>`COALESCE(${" + tbl + "." + col + "} / 100.0, 0)`"
        return "sql<number>`${" + tbl + "." + col + "} / 100.0`"
    src = pat.sub(repl, src)
    if src != orig:
        with open(f, 'w', encoding='utf-8') as fh:
            fh.write(src)
        changed.append(f)

print("SELECT-TARGET REVERTED:")
for f in changed:
    print("  ", f)
