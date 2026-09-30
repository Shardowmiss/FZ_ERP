# FZ_ERP — Clothing ERP and POS Software

> 服装 ERP 与 POS 软件。代码用 Git 同步；共享资产用 WorkBuddy 云端（资料库 / 云后端 / 发布应用）。

## 协同架构
- 公司 / 家里各装 WorkBuddy，登录同一账号
- 代码：Git 仓库（GitHub）
- 资产：资料库放需求/SQL/数据；cloud-service 放后端；发布应用放运行实例

## 分支约定
| 分支 | 用途 | 来源 | 合入方式 |
|---|---|---|---|
| `main` | 稳定可发布版本 | — | 只接受 `dev` 的合并 |
| `dev` | 日常集成 | `main` | `feature` 合回 `dev` |
| `feature/xxx` | 单功能开发 | `dev` | 提 PR/MR 合回 `dev` |

## 公司 / 家里两端工作流
每天开工：
```bash
git checkout dev && git pull origin dev && git checkout -b feature/xxx
```
收工：
```bash
git add -A && git commit -m "feat: 实现 xxx" && git push -u origin feature/xxx   # 提 PR/MR 合回 dev
```
注意：不在 `main`/`dev` 上长期直接改；各自在 `feature` 分支开发，避免互相覆盖。

## 另一端（家里 / 公司）加入
```bash
git clone git@github.com:Shardowmiss/FZ_ERP.git
cd FZ_ERP && git checkout dev
```

## WorkBuddy 协同要点
- 同一账号登录 → 云端记忆、资料库、发布应用自动共享
- 代码冲突用 Git 解决；非代码资产放资料库
- 数据库/存储用 cloud-service，两端连同一后端，消除环境差

## 安全规范（硬约束）：禁止向 Git 提交密钥 / 凭证
**任何私有密钥、密码、令牌、访问凭证都不得进入 Git 仓库。** 已通过 `.gitignore` 全量排除（见仓库根）。
- ❌ 禁止提交：`service_role` 私钥、数据库密码、连接串（含密码）、PAT、SSH 私钥、`.env`（非 example）、`*.genie`、`credentials*`、`*secret*`、`config.local.js` 等
- ✅ 允许提交：`*.example` 占位模板（不含真实值）；以及 **`publishableKey`（前缀 `wbpk_`，公开客户端密钥）**——它等价于 Supabase anon key / Stripe publishable key，按设计就是要发到浏览器的**非私密**凭证，可安全提交
- 真实密钥如需在本地使用，放 `config.local.js`（已被 `.gitignore` 忽略），并在 `config.example.js` 留占位模板
- 提交前自查：`git status` 中若出现 `.env` / `*.key` / `*secret*` / `*.genie` 等，立即停止提交并核实
