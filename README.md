# 云裁 POS · 智慧门店终端系统

> 服装连锁门店终端 POS：会员中心、离线收银、ERP 主数据下行同步与钱包事件上行回写，支持离线优先与硬件打印。

[中文文档](#中文文档) ｜ [English Documentation](#english-documentation)

---

<a id="中文文档"></a>
## 中文文档

### 1. 项目简介

云裁 POS 是云裁 ERP 体系下的门店终端系统，与 ERP 共用「款—色—码」三维主数据模型与品牌视觉语言。系统面向连锁门店的**开单收银、会员运营、库存管理、促销与退货**场景，采用**离线优先**架构（本地队列 + 与 ERP 异步对账），并支持 ESC/POS 硬件打印。

### 2. 技术栈

| 层 | 技术 |
|----|------|
| 后端 | NestJS 10、Drizzle ORM 0.44、PostgreSQL（>= 14） |
| 前端 | React 19、TypeScript 5.9、Vite 8、Tailwind CSS v4、Radix UI、Recharts |
| 工程化 | Vitest（含 @electric-sql/pglite 内存库测试）、ESLint、Stylelint、tsc 类型检查、GitHub Actions CI（依赖审计 + 密钥扫描 + SAST） |
| 部署 | Node 进程（无 Docker，构建产物直接由 `node main.js` 启动） |

### 3. 环境要求

- Node.js **>= 22**
- npm **>= 10**
- PostgreSQL **>= 14**（门店/中心库）
- 可选：与 ERP 同网可达，用于主数据下行与钱包事件上行

### 4. 目录结构

```
pos-review/pos-review/
├── server/            # NestJS 后端（modules/ 业务模块，database/ 为 drizzle schema，test-utils/ 为 pglite）
├── client/            # React 19 + Vite 前端
├── shared/            # 前后端共享类型与工具
├── scripts/           # 索引补建 / 种子 / 对账脚本
├── test/              # 服务端测试（pglite 契约层 + 真库端到端层）
├── vite.config.ts / vitest.config.ts
└── nest-cli.json
```

> 说明：本仓库**不含** `migrations/` 目录。POS 索引与种子通过 `scripts/apply-pos-indexes.cjs` 与 `scripts/pos-seed.sql` 落地；单元测试使用 pglite 内存库，不依赖外部 PostgreSQL。

### 5. 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
# 至少填写 SUDA_DATABASE_URL、FORCE_AUTHN_INNERAPI_DOMAIN、ERP_UPSTREAM_BASE_URL、POS_AUTH_SECRET
# 可参考 ERP 的 .env.example 结构自行创建 .env（本仓库未随附 .env.example）

# 3. 初始化数据库（建索引 + 种子）
node scripts/apply-pos-indexes.cjs
psql "$SUDA_DATABASE_URL" -f scripts/pos-seed.sql

# 4. 启动开发环境（前后端热更新，默认 http://localhost:3001/client/）
npm run dev

# 5. 生产构建并启动（必须在仓库根目录执行，node 按 process.cwd() 定位 dist/client）
npm run build
NODE_ENV=production node main.js
```

常用脚本：

```bash
npm run dev:server       # 仅后端（nest start --watch）
npm run dev:client       # 仅前端（vite）
npm run type:check       # 服务端 + 前端 全量类型检查
npm run test             # vitest 单元测试（pglite）
npm run lint             # ESLint + Stylelint
```

### 6. 环境变量

| 变量 | 说明 | 必填 | 默认 |
|------|------|------|------|
| `SUDA_DATABASE_URL` | PostgreSQL 连接串 | ✅ | — |
| `FORCE_AUTHN_INNERAPI_DOMAIN` | 平台基础域名（注入期强制要求） | ✅ | `https://placeholder.local` |
| `SERVER_PORT` | HTTP 端口 | | `3001` |
| `CLIENT_BASE_PATH` | 前端路由基路径 | | `/client` |
| `ERP_UPSTREAM_BASE_URL` | ERP 上游基址（直连 node 须含 `/client`；走网关转发 `/api` 则不含） | ✅ | — |
| `ERP_UPSTREAM_TOKEN` | 调用 ERP 上游的鉴权令牌 | ✅ | — |
| `POS_AUTH_SECRET` | POS 自身鉴权强密钥（**生产必填**，缺失即拒绝启动） | ✅ | 本地兜底 |
| `POS_AUTH_DISABLED` | 本地联调时旁路鉴权（仅开发） | | `false` |
| `LOG_DIR` / `LOG_REQUEST_BODY` / `LOG_RESPONSE_BODY` | 日志目录与请求体记录开关 | | `./logs` / `false` / `false` |
| `MIAODA_APP_TYPE` / `MIAODA_LOCAL_DEV` | 平台（妙搭）集成开关 | | — |

### 7. 核心功能模块

| 模块 | 职责 |
|------|------|
| `auth` | 登录、鉴权守卫、令牌 |
| `dashboard` | 门店经营看板 |
| `sales` | 开单收银 |
| `returns` | 退货 |
| `members` | 会员中心（查询 / 储值 / 积分） |
| `promotions` | 促销规则 |
| `inventory` / `stock` | 库存 / 盘点 |
| `offline-sync` | 离线同步队列（本地入队 + 异步上报） |
| `erp-integration` | ERP 主数据下行接收 + 钱包事件上行 |
| `omnichannel` | 全渠道订单 |
| `shift` | 班次 / 收银交班 |
| `settings` | 门店参数 |
| `master-data` | 本地主数据（款 / 色 / 码 / 会员） |
| `view` | 视图层 |

### 8. 架构与工程实践

- **离线优先**：收银与会员操作先落本地队列，网络恢复后异步上报 ERP，保障弱网门店可用。
- **主数据下行（ERP→POS）**：幂等键 + 墓碑策略，规避裁剪 / 空结果误下架四类坑（与 ERP 同源实践）。
- **钱包事件上行**：`pos_wallet_event` 出箱表 + 幂等去重 + 零依赖补推，逐条 POST 回写 ERP 账本。
- **三层灰度**：`POS_WALLET_UPSTREAM = off | shadow | strict`，shadow 期对账零致命差异后再切 strict。
- **字段级 PII 加密**：与 ERP 同源的 AES-256-GCM + HMAC 查询列。
- **安全 CI 门禁**：`npm audit` 生产依赖零高危 + `gitleaks` 密钥扫描 + `semgrep` SAST。
- **硬件打印**：ESC/POS 指令对接小票打印机（P0-7，待真机联调）。

### 9. 部署

本仓库**不含 Dockerfile**，以 Node 进程方式部署：

```bash
npm run build
NODE_ENV=production node main.js
```

- 必须在仓库根目录启动：node 通过 `process.cwd()` 定位 `dist/client`，从子目录启动将导致前端资源 404。
- `SUDA_DATABASE_URL` 须指向可达的 PostgreSQL。
- 生产环境**必须**配置 `POS_AUTH_SECRET` 与真实的 `ERP_UPSTREAM_*`；切勿在生产开启 `POS_AUTH_DISABLED`。

### 10. 分支策略

- 统一远程仓库：`FZ_ERP.git`
- `erp` 分支：ERP 程序
- `pos` 分支：POS 程序（本仓库根目录即 POS 程序）
- ⚠️ **严禁推送到 `main` 分支**。

### 11. 许可证

私有 / 内部使用，未开源。

---

<a id="english-documentation"></a>
## English Documentation

### 1. Overview

YunCai POS is the store-front terminal of the YunCai ERP family, sharing the same **Style – Color – Size** master-data model and brand visual language. It targets chain-store scenarios — **checkout, member operations, inventory, promotions, and returns** — using an **offline-first** architecture (local queue + async reconciliation with ERP) and supports ESC/POS hardware printing.

### 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | NestJS 10, Drizzle ORM 0.44, PostgreSQL (>= 14) |
| Frontend | React 19, TypeScript 5.9, Vite 8, Tailwind CSS v4, Radix UI, Recharts |
| Tooling | Vitest (with @electric-sql/pglite in-memory DB), ESLint, Stylelint, tsc type-check, GitHub Actions CI (dep-audit + secret-scan + SAST) |
| Deploy | Node process (no Docker; build output launched directly via `node main.js`) |

### 3. Requirements

- Node.js **>= 22**
- npm **>= 10**
- PostgreSQL **>= 14** (store / central DB)
- Optional: reachable ERP on the same network for master-data downstream & wallet-event upstream

### 4. Project Structure

```
pos-review/pos-review/
├── server/            # NestJS backend (modules/ = business modules, database/ = drizzle schema, test-utils/ = pglite)
├── client/            # React 19 + Vite frontend
├── shared/            # Shared types & utilities for both sides
├── scripts/           # Index backfill / seed / reconcile scripts
├── test/              # Server tests (pglite contract layer + real-DB e2e layer)
├── vite.config.ts / vitest.config.ts
└── nest-cli.json
```

> Note: this repo has **no** `migrations/` directory. POS indexes and seeds are applied via `scripts/apply-pos-indexes.cjs` and `scripts/pos-seed.sql`; unit tests use an in-memory pglite database and do not depend on an external PostgreSQL.

### 5. Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
# At least set SUDA_DATABASE_URL, FORCE_AUTHN_INNERAPI_DOMAIN, ERP_UPSTREAM_BASE_URL, POS_AUTH_SECRET
# (This repo does not ship a .env.example; mirror the structure from ERP's .env.example)

# 3. Initialize database (indexes + seed)
node scripts/apply-pos-indexes.cjs
psql "$SUDA_DATABASE_URL" -f scripts/pos-seed.sql

# 4. Start dev environment (hot-reload, default http://localhost:3001/client/)
npm run dev

# 5. Production build & start (MUST run from repo root; node locates dist/client via process.cwd())
npm run build
NODE_ENV=production node main.js
```

Common scripts:

```bash
npm run dev:server       # backend only (nest start --watch)
npm run dev:client       # frontend only (vite)
npm run type:check       # full type-check for server + client
npm run test             # vitest unit tests (pglite)
npm run lint             # ESLint + Stylelint
```

### 6. Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SUDA_DATABASE_URL` | PostgreSQL connection string | ✅ | — |
| `FORCE_AUTHN_INNERAPI_DOMAIN` | Platform base domain (enforced at bootstrap) | ✅ | `https://placeholder.local` |
| `SERVER_PORT` | HTTP port | | `3001` |
| `CLIENT_BASE_PATH` | Frontend route base path | | `/client` |
| `ERP_UPSTREAM_BASE_URL` | ERP upstream base URL (include `/client` for direct node; omit for gateway `/api` forwarding) | ✅ | — |
| `ERP_UPSTREAM_TOKEN` | Auth token for calling ERP upstream | ✅ | — |
| `POS_AUTH_SECRET` | POS own auth strong secret (**prod required**, reject on missing) | ✅ | local fallback |
| `POS_AUTH_DISABLED` | Bypass auth for local dev only | | `false` |
| `LOG_DIR` / `LOG_REQUEST_BODY` / `LOG_RESPONSE_BODY` | Log dir & request-body flags | | `./logs` / `false` / `false` |
| `MIAODA_APP_TYPE` / `MIAODA_LOCAL_DEV` | Platform (Miaoda) integration switches | | — |

### 7. Core Modules

| Module | Responsibility |
|--------|----------------|
| `auth` | Login, auth guards, tokens |
| `dashboard` | Store operations dashboard |
| `sales` | Checkout |
| `returns` | Returns |
| `members` | Member center (query / stored-value / points) |
| `promotions` | Promotion rules |
| `inventory` / `stock` | Inventory / stocktake |
| `offline-sync` | Offline sync queue (local enqueue + async upload) |
| `erp-integration` | ERP master-data downstream receiver + wallet-event upstream |
| `omnichannel` | Omnichannel orders |
| `shift` | Shift / cash-handover |
| `settings` | Store settings |
| `master-data` | Local master data (style / color / size / member) |
| `view` | View layer |

### 8. Architecture & Engineering Practices

- **Offline-first**: checkout and member ops are queued locally and uploaded asynchronously when the network returns, keeping weak-network stores usable.
- **Master-data downstream (ERP→POS)**: idempotency keys + tombstone strategy, avoiding the four typical pitfalls (shares the practice with ERP).
- **Wallet-event upstream**: `pos_wallet_event` outbox + idempotent dedup + dependency-free retry, POSTing back to the ERP ledger one by one.
- **Three-stage rollout**: `POS_WALLET_UPSTREAM = off | shadow | strict`; switch to strict only after zero fatal diffs during the shadow period.
- **Field-level PII encryption**: same AES-256-GCM + HMAC searchable columns as ERP.
- **Security CI gate**: `npm audit` zero high-severity prod deps + `gitleaks` secret scan + `semgrep` SAST.
- **Hardware printing**: ESC/POS commands for receipt printers (P0-7, pending real-device integration).

### 9. Deployment

This repo ships **no Dockerfile**; deploy as a Node process:

```bash
npm run build
NODE_ENV=production node main.js
```

- Must be launched from the repo root: node locates `dist/client` via `process.cwd()`; starting from a sub-directory leads to 404 on frontend assets.
- `SUDA_DATABASE_URL` must point to a reachable PostgreSQL.
- Production **must** configure `POS_AUTH_SECRET` and real `ERP_UPSTREAM_*`; never enable `POS_AUTH_DISABLED` in production.

### 10. Branching

- Single remote repository: `FZ_ERP.git`
- `erp` branch: ERP program
- `pos` branch: POS program (repo root **is** the POS program)
- ⚠️ **Never push to the `main` branch.**

### 11. License

Private / internal use only; not open-sourced.
