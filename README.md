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

## 安全规范（硬约束）：禁止向 Git 提交任何密钥 / 凭证
**包括 `publishableKey`（wbpk_ 前缀的公开客户端密钥）在内的任何密钥都不得进入 Git 仓库。**（用户已通过 `Delete app/index.html` 提交明确要求：不能提交带密钥的材料。）
- ❌ 禁止提交：`service_role` 私钥、数据库密码、连接串（含密码）、PAT、SSH 私钥、`.env`（非 example）、`*.genie`、`credentials*`、`*secret*`、`config.local.js` 等——无论公私，一律不进仓库
- ✅ 允许提交：源码与 `*.example` 占位模板（不含真实值）；`config.js`（仅含公开 endpoint + 空占位 key）
- 密钥如何既"不进 Git"又"线上可用"：**外置到 `app/config.local.js`（已被 `.gitignore` 忽略，仅本机存在）**，由 `index.html` 在运行时加载；发布时该文件随目录上传到线上，但不会被 Git 追踪。换机器时从 WorkBuddy 应用面板复制 `publishableKey` 重建此文件即可
- 提交前自查：`git status` 中若出现 `.env` / `*.key` / `*secret*` / `*.genie` / `config.local.js` 等，立即停止提交并核实
