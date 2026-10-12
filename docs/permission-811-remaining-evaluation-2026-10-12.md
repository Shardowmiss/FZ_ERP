# #811 剩余事项评估（② 主数据 GET 补 :view / ⑤ 移除角色冗余粗码）

> 日期：2026-10-12 ｜ 关联：#811（守卫动作级细化后续）、审计报告 `permission-design-audit-2026-10-12.md`
> 复跑：`NODE_OPTIONS= node scripts/analyze-read-guard-safety.cjs`、`NODE_OPTIONS= node scripts/role-coarse-code-audit.cjs`

## 结论先行

| 事项 | 结论 | 处置 |
|---|---|---|
| **② 主数据 GET 补 `:view`** | **不可机械落地**。审计「复刻 color 范式」的建议**忽略了一个事实**：主数据 GET 被大量**跨模块页面**调用，而那些页面所属角色**普遍不持**该资源 → 加守卫会大面积 403。 | 已落地**唯一可证安全**的一处（`base:size`，与 `base:color` 对齐）；其余标记为**决策项**（下表三方案）。 |
| **⑤ 移除角色冗余粗码** | **已实质达成**（审计实测「0 越权」：角色持有粗码时其全部子码也已显式授予 ⇒ 粗码仅**形式冗余**，授权集未放大）。残余风险是「**未来新增动作会被粗码自动放大**」。 | 阻塞于 21 个残留粗码守卫；且移除需在配置中**显式展开子码**（否则新部署复现失败）。列为**决策项**。 |

---

## 一、② 判据与证据

### 1.1 判据（可判定）

读接口走 `PermissionGuard` 的 **`checkAccess`（宽松）**：

```
canAccess(code, held) = held 含 code / 其前缀祖先，或含 code 的子码
```

⇒ 给资源 `res` 的 GET 补 `res:view` 守卫后，**只有完全不持 `res`、`res:view`、`res:*` 的角色**会被 403。
故「安全性」= 该资源 GET 的**前端调用方所属角色**是否都持有该资源。

### 1.2 证据 A：角色 × 资源持有矩阵

| 资源 | 持有角色 | 未持有（加守卫会 403） |
|---|---|---|
| `base:color` | super_admin / dealer / data_governor | purchasing / warehouse / store_manager / finance |
| `base:size` | super_admin / dealer / data_governor | 同上 |
| `base:size-group` | super_admin / dealer / data_governor | 同上 |
| `base:sku` | super_admin / dealer / data_governor | 同上 |
| `base:style` | super_admin / data_governor | + dealer |
| `base:material` | super_admin / purchasing | warehouse / dealer / store_manager / finance / data_governor |
| `base:supplier` | super_admin / purchasing | warehouse / dealer / store_manager / finance / data_governor |
| `base:store` | super_admin / dealer / store_manager | purchasing / warehouse / finance / data_governor |
| `base:dealer` | super_admin / dealer | purchasing / warehouse / store_manager / finance / data_governor |
| `base:warehouse` | **目录中不存在该资源码** —— `warehouse.controller` 的读写守卫复用 `base:store:*`（既有不一致，本次未动） | — |

> 关键：**没有任何主数据资源被 5 个业务角色全覆盖**。

### 1.3 证据 B：主数据 GET 的前端调用方（跨模块）

| 资源 | 调用方页数 | 代表性跨模块调用方 |
|---|---|---|
| `base:style` | 25 | sales / retail / production / purchase / trade-show / bom / inventory |
| `base:material` | 16 | production / purchase / inventory / bom / subcontract |
| `base:size-group` | 12 | retail / sales / trade-show / inventory |
| `base:warehouse`（controller 复用 `base:store`） | 12 | retail / inventory / trade-show / report |
| `base:dealer` | 11 | finance / inventory / report / sales / trade-show |
| `base:store` | 12 | retail / inventory / trade-show / report |
| `base:supplier` | 24 | finance / production / purchase / report / inventory / subcontract |
| `base:sku` | 10 | inventory / production / analytics / omni / subcontract |
| `base:color` | 2 | 仅 `pages/base/`（ColorPage / SkuPage） |
| `base:size` | 3 | 仅 `pages/base/`（SizePage / SizeGroupRelationPage / SkuPage） |
| `base:style-attribute` / `base:style-attr-def` | 各 1 | 仅 `pages/base/StyleAttributePage` |

⇒ 只有 **`base:color`（已守卫）与 `base:size`** 的调用方全部落在自身模块内。

### 1.4 已落地（可证安全）

`server/modules/base/size/size.controller.ts`：`@Get()` / `@Get(':id')` 补 `@CheckPermission('base:size:view')`；
`@Get('options/list')` **保持开放**（复刻 color 范式：共享下拉端点不窄化）。

**运行时验证**（`/tmp/verify-size-read.cjs`，隔离账号打真实接口）：

| 账号 | list | detail | options/list |
|---|---|---|---|
| 超管 / 持 `base:size` 粗码 / 仅持 `base:size:view` | 200 | 404（放行） | 200 |
| 仅持 `base:sku` 粗码 | **403** | **403** | 200 |
| 零权限 | **403** | **403** | 200 |

⇒ 持粗码/`:view` 均放行（零回归）；无权限被拦（收敛生效）；`options` 刻意开放。

> 潜在耦合（已记录，无现实角色触发）：`pages/base/SkuPage`（门控 `base:sku`）与 `SizeGroupRelationPage`（门控 `base:size-group`）会调 `size.list`；当前持 `base:sku`/`base:size-group` 的角色均同时持 `base:size`，故安全。**未来若新增「只给 sku 不给 size」的角色，需同步授予 `base:size:view`。**

### 1.5 未落地（UNSAFE）与三方案

| 方案 | 内容 | 代价 | 风险 |
|---|---|---|---|
| **A（推荐现状）** | 保持开放 + 文档化「主数据为跨模块共享参考数据，读仅需登录」 | 0 | 无。但「任意登录用户可读参考数据」保留 |
| **B（已部分采用）** | 仅对**调用方全在本模块**的资源加守卫（当前：color✅ / size✅ / 及大量 `finance:*`/`production:*`/`system:*` 免守卫 GET） | 小 | 低（每个资源需一次调用方核对） |
| **C（审计本意）** | 「授权 + 守卫」配对：先给全部 6 运营角色授 `res:view`（约 40~60 条），再给全部主数据 GET 加守卫 | 大 | 中（漏授任一角色即 403；且授权列表膨胀，与「最小授权」叙事相悖） |

> **本仓判断**：参考数据（颜色/尺码/款号/仓库…）是**跨模块共享的低敏数据**，读开放是当前事实上的合理设计；C 的收益（阻止无权限账号读款号表）远低于其成本与回归面。**建议维持 A+B**，若确需 C，应作为独立的「参考数据访问模型」设计项推进。

---

## 二、⑤ 移除角色冗余粗码

### 2.1 事实：已实质达成

`ensureOperationalRoles` 的「分组码连带展开子码」使角色持有粗码时**其全部子码也已显式授予**。
`role-coarse-code-audit.cjs` 实测：**存在静默越权的角色数 = 0**（无「粗码授予但未显式持有」的动作）。
⇒ 粗码当前**仅形式冗余**，移除与否**不改变授权集**。

### 2.2 阻塞：21 个残留粗码守卫

移除角色粗码的前提是「无任何守卫使用该粗码」。当前控制器仍有 **21 种**粗码守卫（多为**只读资源**与**类级守卫**）：

```
analytics:lifecycle  base:import  dashboard  dashboard:view  finance:profit
inventory:flow  inventory:hangtag  inventory:query  inventory:replenish
inventory:replenish-plan  inventory:replenish-template  inventory:warning
md:merge  member:merge  report:pivot  report:retail_report  sales:retail
system:config  system:operation_log  system:permission  system:user
```

> 其中 `inventory:query`/`inventory:warning`/`sales:retail`/`system:*` 等正是多个运营角色持有的粗码 ⇒ **直接移除会 403**。

### 2.3 残余风险与方案

| 方案 | 内容 | 代价 | 说明 |
|---|---|---|---|
| **A（现状）** | 保留粗码（冗余但无害） | 0 | 授权集不变；审计 0 越权 |
| **B** | 对「非粗码守卫资源」把配置里的粗码**替换为其显式子码**（行为等价） | 中（配置膨胀约 150 行） | 可**阻止未来新增动作被自动放大**（真正的最小授权） |
| **C** | 先消灭 21 个残留粗码守卫（多为只读资源，需逐个判定是否值得动作级化） | 大 | 之后才可整体移除角色粗码 |

> **本仓判断**：B 的价值（阻断未来自动放大）真实但前提是接受配置膨胀；C 的收益不明显（只读资源的粗码守卫语义本就合理）。**建议维持 A**，除非团队明确要在配置层显式化全部授权。

---

## 三、复现命令

```bash
# 读接口守卫安全性分析（② 的判据与证据）
NODE_OPTIONS= node scripts/analyze-read-guard-safety.cjs

# 角色粗码体检（⑤ 的基线：0 越权）
NODE_OPTIONS= node scripts/role-coarse-code-audit.cjs

# 权限一致性门禁（播种/守卫/路由/菜单 ↔ 目录 五方对账）
NODE_OPTIONS= npm run perm:check

# ② 的运行时验证（需 ERP 在 :3000 运行）
NODE_OPTIONS= node <verify-size-read.cjs>
```
