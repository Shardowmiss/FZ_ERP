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
