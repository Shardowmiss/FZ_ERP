# 云裁 ERP · 服装企业资源计划系统

> 面向服装连锁企业的全链路 ERP：以「款（Style）— 色（Color）— 码（Size）」三维主数据为核心，打通订货会、采购、委外、生产、库存、批发零售、财务对账与经营分析。

[中文文档](#中文文档) ｜ [English Documentation](#english-documentation)

---

<a id="中文文档"></a>
## 中文文档

### 1. 项目简介

云裁 ERP 是面向服装连锁企业的全栈资源管理平台。系统以「款—色—码」三维主数据模型为骨架，覆盖订货会、采购、委外、生产、库存、批发与零售、财务对账及经营分析等关键链路，支持**直营 / 经销商双模式**与**多级分销**，长期持续迭代。

### 2. 技术栈

| 层 | 技术 |
|----|------|
| 后端 | NestJS 10、Drizzle ORM 0.44、PostgreSQL（>= 14） |
| 前端 | React 19、TypeScript 5.9、Vite 8、Tailwind CSS v4、Radix UI、Recharts / ECharts |
| 工程化 | Vitest、ESLint、Stylelint、tsc 类型检查、GitHub Actions CI（依赖审计 + 密钥扫描 + SAST） |
| 部署 | Docker（Dockerfile + docker-compose.yml） |

### 3. 环境要求

- Node.js **>= 22**
- npm **>= 10**
- PostgreSQL **>= 14**

### 4. 目录结构

```
erp_source/
├── server/            # NestJS 后端（modules/ 业务模块，database/ 为 drizzle schema）
├── client/            # React 19 + Vite 前端
├── shared/            # 前后端共享类型与工具
├── migrations/        # SQL 迁移（0001 → 0034，按序应用）
├── scripts/           # 构建 / 回填 / 测试库脚本
├── docs/              # 部署与治理文档
├── test/              # 服务端集成测试
├── drizzle.config.ts  # drizzle 配置
└── Dockerfile / docker-compose.yml
```

### 5. 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env      # 至少填写 SUDA_DATABASE_URL 与 FORCE_AUTHN_INNERAPI_DOMAIN

# 3. 初始化数据库（按序应用迁移）
node exec-migration.cjs

# 4. 启动开发环境（前后端热更新，默认 http://localhost:3000/client/）
npm run dev

# 5. 生产构建并启动
npm run build
npm run start             # 等价于 cd dist && NODE_ENV=production node server/main.js
```

常用脚本：

```bash
npm run dev:server       # 仅后端（nest start --watch）
npm run dev:client       # 仅前端（vite）
npm run type:check       # 服务端 + 前端 全量类型检查
npm run test             # vitest 单元测试
npm run test:db          # 克隆测试库（scripts/setup-test-db.sh）
npm run lint             # ESLint + Stylelint
```

### 6. 环境变量

| 变量 | 说明 | 必填 | 默认 |
|------|------|------|------|
| `SUDA_DATABASE_URL` | PostgreSQL 连接串 | ✅ | — |
| `FORCE_AUTHN_INNERAPI_DOMAIN` | 平台基础域名（注入期强制要求） | ✅ | `https://placeholder.local` |
| `SERVER_PORT` | HTTP 端口 | | `3000` |
| `SERVER_HOST` | 监听地址 | | `0.0.0.0` |
| `CLIENT_BASE_PATH` | 前端路由基路径 | | `/client` |
| `ERP_UPSTREAM_TOKEN` | ERP→POS 推送鉴权令牌 | ⚙️ | — |
| `ERP_RECEIVER_ALLOWED_IPS` | 推送来源 IP 白名单 | ⚙️ | — |
| `ERP_CSRF_SIGNING_SECRET` | CSRF 双重提交签名密钥（生产必填，>= 16 位） | ⚙️ | 本地随机 |
| `FIELD_ENC_KEY` | 字段级 PII 加密主密钥（AES-256-GCM，>= 32 字节，生产必填） | ⚙️ | 本地兜底 |
| `LOG_DIR` / `LOG_REQUEST_BODY` / `LOG_RESPONSE_BODY` | 日志目录与请求体记录开关 | | `./logs` / `false` / `false` |
| `MIAODA_APP_TYPE` / `MIAODA_LOCAL_DEV` | 平台（妙搭）集成开关 | | — |

> ⚙️ 仅在启用 POS 下行推送、生产安全强化或字段加密时必填；开发环境提供安全兜底默认值。

### 7. 核心功能模块

| 模块 | 职责 |
|------|------|
| `base` | 款 / 色 / 码 / 物料 / 仓库 / 门店 / 经销商 / 供应商主数据 |
| `bom` | 物料清单 |
| `inventory` | 库存、盘点、调拨、出入库 |
| `purchase` | 原料 / 成衣采购订单、入库、退货 |
| `production` | 生产工单、发料、完工入库 |
| `sales` | 批发销售订单、出库、退货 |
| `retail` | 零售订单、退货 |
| `trade-show` | 订货会、配货、预订单 |
| `finance` | 应收 / 应付、收付款、月结、利润 |
| `member` | 会员、钱包事件、合并 |
| `distribution` | 多级分销 |
| `pricing` | 计价引擎 |
| `analytics` | 生命周期、预测分析 |
| `report` | 经营报表（强制时间窗，杜绝无界扫描） |
| `rbac` | 角色权限（权限目录 + 读穿缓存） |
| `system` | 系统、用户、参数、编码规则 |
| `pos` / `pos-receiver` | POS 下行接收与幂等 |
| `master-data-merge` | 主数据查重合并引擎（款 / 客户 / 会员） |
| `consistency` | 主数据一致性校验 |
| `hangtag` / `unique-code` / `subcontract` / `omni` / `ops` | 吊牌、唯一编码、委外、全渠道、运维 |

### 8. 架构与工程实践

- **统一主数据下行（ERP→POS）**：幂等键 + 墓碑策略，规避「裁剪 / 空结果误下架」等四类典型坑。
- **会员钱包账本**：钱包事件 ledger 原子累加 + 幂等去重，保障资金安全。
- **字段级 PII 加密**：AES-256-GCM 加密 + HMAC 查询列，手机号等敏感字段支持可搜索加密。
- **主数据合并引擎**：资金安全合并（依赖改指 survivor，**禁删被合并方**）+ 审计回滚。
- **报表强制时间窗**：未传日期注入默认回看窗口，全量需显式 `allowFullRange`，杜绝无界全表扫描。
- **RBAC 权限目录**：`onModuleInit` 幂等写入 `rbac_permission`，新增独立权限码四步法。
- **安全 CI 门禁**：`npm audit` 生产依赖零高危 + `gitleaks` 密钥扫描 + `semgrep` SAST（SARIF 上传）。

### 9. 部署

**Docker**

```bash
docker build -t yuncai-erp .
docker compose up -d
```

**云平台（豆包 aiforce.run / 任意 Node 平台）**

- `SUDA_DATABASE_URL` 必须指向**云端可达**的 PostgreSQL（RDS / Supabase / Aiven 等），不可用 `localhost`。
- 在平台「环境变量」面板逐项设置，或直接随构建提交 `.env`（仓库已排除真实凭据）。
- 构建产物为 `dist/`，生产启动命令 `node server/main.js`（`NODE_ENV=production`）。

### 10. 分支策略

- 统一远程仓库：`FZ_ERP.git`
- `erp` 分支：ERP 程序（本仓库根目录即 ERP 程序）
- `pos` 分支：POS 程序
- ⚠️ **严禁推送到 `main` 分支**。

### 11. 许可证

私有 / 内部使用，未开源。

---

<a id="english-documentation"></a>
## English Documentation

### 1. Overview

YunCai ERP is a full-stack resource planning platform for apparel retail chains. Built around a three-dimensional master-data model of **Style – Color – Size**, it connects trade shows, purchasing, subcontracting, production, inventory, wholesale & retail, financial reconciliation, and business analytics, supporting both **direct-sales and dealer models** with multi-level distribution.

### 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | NestJS 10, Drizzle ORM 0.44, PostgreSQL (>= 14) |
| Frontend | React 19, TypeScript 5.9, Vite 8, Tailwind CSS v4, Radix UI, Recharts / ECharts |
| Tooling | Vitest, ESLint, Stylelint, tsc type-check, GitHub Actions CI (dep-audit + secret-scan + SAST) |
| Deploy | Docker (Dockerfile + docker-compose.yml) |

### 3. Requirements

- Node.js **>= 22**
- npm **>= 10**
- PostgreSQL **>= 14**

### 4. Project Structure

```
erp_source/
├── server/            # NestJS backend (modules/ = business modules, database/ = drizzle schema)
├── client/            # React 19 + Vite frontend
├── shared/            # Shared types & utilities for both sides
├── migrations/        # SQL migrations (0001 -> 0034, applied in order)
├── scripts/           # Build / backfill / test-db scripts
├── docs/              # Deployment & governance docs
├── test/              # Server-side integration tests
├── drizzle.config.ts  # Drizzle configuration
└── Dockerfile / docker-compose.yml
```

### 5. Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env      # at least set SUDA_DATABASE_URL and FORCE_AUTHN_INNERAPI_DOMAIN

# 3. Initialize database (apply migrations in order)
node exec-migration.cjs

# 4. Start dev environment (hot-reload, default http://localhost:3000/client/)
npm run dev

# 5. Production build & start
npm run build
npm run start             # same as: cd dist && NODE_ENV=production node server/main.js
```

Common scripts:

```bash
npm run dev:server       # backend only (nest start --watch)
npm run dev:client       # frontend only (vite)
npm run type:check       # full type-check for server + client
npm run test             # vitest unit tests
npm run test:db          # clone test database (scripts/setup-test-db.sh)
npm run lint             # ESLint + Stylelint
```

### 6. Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SUDA_DATABASE_URL` | PostgreSQL connection string | ✅ | — |
| `FORCE_AUTHN_INNERAPI_DOMAIN` | Platform base domain (enforced at bootstrap) | ✅ | `https://placeholder.local` |
| `SERVER_PORT` | HTTP port | | `3000` |
| `SERVER_HOST` | Bind address | | `0.0.0.0` |
| `CLIENT_BASE_PATH` | Frontend route base path | | `/client` |
| `ERP_UPSTREAM_TOKEN` | ERP→POS push auth token | ⚙️ | — |
| `ERP_RECEIVER_ALLOWED_IPS` | Allowed push source IPs | ⚙️ | — |
| `ERP_CSRF_SIGNING_SECRET` | CSRF double-submit signing key (prod required, >= 16 chars) | ⚙️ | local random |
| `FIELD_ENC_KEY` | Field-level PII encryption master key (AES-256-GCM, >= 32 bytes, prod required) | ⚙️ | local fallback |
| `LOG_DIR` / `LOG_REQUEST_BODY` / `LOG_RESPONSE_BODY` | Log dir & request-body flags | | `./logs` / `false` / `false` |
| `MIAODA_APP_TYPE` / `MIAODA_LOCAL_DEV` | Platform (Miaoda) integration switches | | — |

> ⚙️ Required only when enabling POS downstream push, production hardening, or field encryption; dev environment provides safe fallback defaults.

### 7. Core Modules

| Module | Responsibility |
|--------|----------------|
| `base` | Master data: style / color / size / material / warehouse / store / dealer / supplier |
| `bom` | Bill of materials |
| `inventory` | Stock, stocktake, transfer, in/out |
| `purchase` | Material / garment purchase orders, inbound, returns |
| `production` | Work orders, material issue, finish receipt |
| `sales` | Wholesale sales orders, outbound, returns |
| `retail` | Retail orders, returns |
| `trade-show` | Trade shows, allocation, pre-orders |
| `finance` | Receivable / payable, payments, month-close, profit |
| `member` | Members, wallet events, merge |
| `distribution` | Multi-level distribution |
| `pricing` | Pricing engine |
| `analytics` | Lifecycle, forecasting analytics |
| `report` | Business reports (enforced time-window, no unbounded scans) |
| `rbac` | Role & permission (catalog + read-through cache) |
| `system` | System, users, params, code rules |
| `pos` / `pos-receiver` | POS downstream receiver & idempotency |
| `master-data-merge` | Master-data dedup & merge engine (style / customer / member) |
| `consistency` | Master-data consistency checks |
| `hangtag` / `unique-code` / `subcontract` / `omni` / `ops` | Hangtag, unique codes, subcontract, omnichannel, ops |

### 8. Architecture & Engineering Practices

- **Unified master-data downstream (ERP→POS)**: idempotency keys + tombstone strategy, avoiding the four typical pitfalls (pruning / empty-result false takedown, etc.).
- **Member wallet ledger**: atomic wallet-event accumulation + idempotent dedup for fund safety.
- **Field-level PII encryption**: AES-256-GCM encryption + HMAC searchable columns; sensitive fields (e.g. phone) support searchable encryption.
- **Master-data merge engine**: fund-safe merge (redirect dependents to survivor, **never delete the merged party**) + audit rollback.
- **Report enforced time-window**: defaults a look-back window when no date is passed; full scan requires explicit `allowFullRange`, preventing unbounded table scans.
- **RBAC permission catalog**: `onModuleInit` idempotently writes `rbac_permission`; four-step flow for new permission codes.
- **Security CI gate**: `npm audit` zero high-severity prod deps + `gitleaks` secret scan + `semgrep` SAST (SARIF upload).

### 9. Deployment

**Docker**

```bash
docker build -t yuncai-erp .
docker compose up -d
```

**Cloud platform (Doubao aiforce.run / any Node platform)**

- `SUDA_DATABASE_URL` must point to a **cloud-reachable** PostgreSQL (RDS / Supabase / Aiven etc.), not `localhost`.
- Set variables in the platform's environment panel, or commit `.env` alongside the build (real credentials are excluded from the repo).
- Build output is `dist/`; production start command is `node server/main.js` (`NODE_ENV=production`).

### 10. Branching

- Single remote repository: `FZ_ERP.git`
- `erp` branch: ERP program (repo root **is** the ERP program)
- `pos` branch: POS program
- ⚠️ **Never push to the `main` branch.**

### 11. License

Private / internal use only; not open-sourced.
