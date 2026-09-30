# co-dev-project（跨设备协同开发骨架）

> 用于「公司电脑 + 家里电脑」共同开发同一套软件。
> 代码用 Git 同步；共享资产用 WorkBuddy 云端（资料库 / 云后端 / 发布应用）。

## 1. 协同架构
- 两端各装 WorkBuddy，登录**同一账号**
- 代码：Git 仓库（GitHub / Gitee / 阿里云效 / 飞书代码库）
- 资产：资料库放需求/SQL/数据；cloud-service 放后端；发布应用放运行实例

## 2. 分支约定
| 分支 | 用途 | 来源 | 合入方式 |
|---|---|---|---|
| `main` | 稳定可发布版本 | — | 只接受 `dev` 的合并 |
| `dev` | 日常集成 | `main` | `feature` 合回 `dev` |
| `feature/xxx` | 单功能开发 | `dev` | 提 PR/MR 合回 `dev` |

## 3. 公司 / 家里两端工作流
每天开工：
```bash
git checkout dev
git pull origin dev
git checkout -b feature/xxx      # 从 dev 拉功能分支
```
开发中（WorkBuddy 辅助编码）：正常写代码。
收工：
```bash
git add -A
git commit -m "feat: 实现 xxx"
git push -u origin feature/xxx   # 远程平台提 PR/MR → 合入 dev
```
注意：不在 `main`/`dev` 上长期直接改；各自在 `feature` 分支开发，避免互相覆盖。

## 4. 首次提交前（必做）
本机尚未配置 git 身份，第一次 commit 前执行（换成你自己的）：
```bash
git config --global user.name  "你的名字"
git config --global user.email "you@example.com"
```

## 5. 关联远程仓库
A. 新建空远程仓库后关联：
```bash
git remote add origin <远程仓库URL>
git push -u origin main
```
B. 已有仓库：`git remote set-url origin <URL>`

## 6. 另一端（家里 / 公司）克隆
```bash
git clone <远程仓库URL>
cd co-dev-project
git checkout dev
```

## 7. WorkBuddy 协同要点
- 同一账号登录 → 云端记忆、资料库、发布应用自动共享
- 代码冲突用 Git 解决；非代码资产放资料库
- 数据库/存储用 cloud-service，两端连同一后端，消除环境差

---
把业务代码放进 `src/` 即可；本文件可按需改名或删除。
