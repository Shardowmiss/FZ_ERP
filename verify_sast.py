#!/usr/bin/env python3
"""P0-5 SAST 配置/CI 接线校验（无 semgrep 依赖，仅校验静态正确性）。

校验项：
  1) .semgrep.yml 是合法 YAML，且为 {rules:[...]}，每条规则具备
     id(str) / severity(ERROR|WARNING|INFO) / message(str) / 至少一个 pattern 类字段。
  2) .github/workflows/ci.yml 含 sast job，且该 job 引用 semgrep 与 .semgrep.yml
     （确保规则集真的被 CI 跑起来，不是空壳）。

退出码：0=全部通过；1=存在违规（打印明细）。
"""
import sys
import os
import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
SEMGREP_YML = os.path.join(ROOT, ".semgrep.yml")
CI_YML = os.path.join(ROOT, ".github", "workflows", "ci.yml")
VALID_SEVERITIES = {"ERROR", "WARNING", "INFO"}
PATTERN_KEYS = {"pattern", "pattern-either", "pattern-inside", "patterns", "pattern-not", "pattern-regex"}


def err(msg):
    print(f"[FAIL] {msg}")
    return False


def main():
    ok = True

    # ---- 1) .semgrep.yml ----
    if not os.path.isfile(SEMGREP_YML):
        return 1 if err(f"缺少规则文件: {SEMGREP_YML}") else 1
    try:
        with open(SEMGREP_YML, "r", encoding="utf-8") as f:
            doc = yaml.safe_load(f)
    except Exception as e:  # noqa: BLE001
        return 1 if err(f".semgrep.yml 不是合法 YAML: {e}") else 1

    if not isinstance(doc, dict) or not isinstance(doc.get("rules"), list):
        return 1 if err(".semgrep.yml 顶层需为含 'rules' 列表的映射") else 1

    if not doc["rules"]:
        return 1 if err(".semgrep.yml 的 rules 为空（空壳规则集）") else 1

    for i, rule in enumerate(doc["rules"]):
        tag = f"rules[{i}]"
        if not isinstance(rule, dict):
            ok = err(f"{tag} 必须是映射") and ok
            continue
        rid = rule.get("id")
        if not isinstance(rid, str) or not rid:
            ok = err(f"{tag}.id 缺失或非字符串") and ok
        sev = rule.get("severity")
        if sev not in VALID_SEVERITIES:
            ok = err(f"{tag}(id={rid}) severity 必须是 {VALID_SEVERITIES} 之一，实际={sev!r}") and ok
        if not isinstance(rule.get("message"), str) or not rule["message"].strip():
            ok = err(f"{tag}(id={rid}) message 缺失或非空字符串") and ok
        has_pattern = any(k in rule for k in PATTERN_KEYS)
        if not has_pattern:
            ok = err(f"{tag}(id={rid}) 至少需含一个 pattern 类字段: {sorted(PATTERN_KEYS)}") and ok
        langs = rule.get("languages")
        if not isinstance(langs, list) or not langs:
            ok = err(f"{tag}(id={rid}) languages 缺失或非列表") and ok

    # ---- 2) ci.yml 接线 ----
    if not os.path.isfile(CI_YML):
        return 1 if err(f"缺少 CI 文件: {CI_YML}") else 1
    with open(CI_YML, "r", encoding="utf-8") as f:
        ci_text = f.read()

    if "sast:" not in ci_text:
        ok = err("ci.yml 未定义 sast job（SAST 未被接入 CI）") and ok
    elif "semgrep" not in ci_text:
        ok = err("ci.yml 的 sast job 未引用 semgrep（未真正执行扫描）") and ok
    elif ".semgrep.yml" not in ci_text:
        ok = err("ci.yml 的 sast job 未引用 .semgrep.yml（未使用本规则集）") and ok

    if ok:
        print(f"[OK] SAST 校验通过：{len(doc['rules'])} 条规则，ci.yml 已接入 sast job")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
