# 身份上下文（req.userContext）在带前缀部署下失效 — 发现报告

- 日期：2026-10-12
- 发现于：#811 迭代E（⑦ 目录缺口收口）的运行时隔离验证过程
- 性质：**既有缺陷（非本次改动引入）**，属认证/数据权限边界，建议优先级 P0（安全）
- 关联：`erp-pg-event-bus` 无关；关联 P1-d「身份源统一」修复

---

## 1. 结论先行

`server/common/guards/auth.guard.ts:50` 用 `req.url.startsWith('/api/')` 判定「是否 API 请求」，
但本仓库/平台部署的全局前缀来自 `CLIENT_BASE_PATH`（本环境 `.env` 中已设置），
实际 URL 形如 **`/client/api/...`** ⇒ 该判定恒为 false ⇒ 全局 `AuthGuard` **提前 return true**，
**从不写入 `req.userContext`**。

由此产生两个后果：

| # | 后果 | 代码位置 | 严重度 |
|---|---|---|---|
| A | 行级多租户（经销商）数据隔离**整体失效**：`dealerScope` 落到 `ALL_SCOPE` | `common/interceptors/data-scope.interceptor.ts:41,58` | **高（水平越权/IDOR）** |
| B | 任何读取 `req.userContext.userId` 的控制器逻辑拿到 `undefined` 而报错 | 如 `modules/report/report.controller.ts`（透视模板） | 中（功能不可用） |

> 注：`PermissionGuard`（接口级垂直越权防护）**不受影响**——它自行从 `x-auth-token` 解析用户，
> 所以「接口级权限」是对的；失效的是「依赖 `req.userContext` 的行级数据权限」。

---

## 2. 证据链

### 2.1 运行时实证（B 的现场）
以超管身份调用 `GET /client/api/report/pivot/templates` → **500**。服务端日志中的失败 SQL：

```
select "id","name","config","data_source","is_last_used","remark","_created_at","_updated_at"
from "report_pivot_template"
where "report_pivot_template"."owner_user_id" = ROW()::user_profile     -- ← 零列！
order by ... desc
```

```
PostgresError: cannot cast type record to user_profile   (code 42846)
detail: 'Input has too few columns.'
```

`ROW()` 之所以是空，是因为 `ownerUserId` 为 `undefined`
（`drizzle` 自定义类型 `userProfile.toDriver` 生成 `ROW(${value})::user_profile`，值为 undefined 时被丢弃 ⇒ `ROW()`）。
而 `ownerUserId` 直接来自 `req.userContext.userId`。

对照：`super_admin` 与「仅持 `report:pivot:view`」两个账号**都**是 500 →
说明不是权限问题（若是权限问题应为 403），而是身份上下文缺失。

### 2.2 代码链路

```
auth.guard.ts:50    if (!req.url?.startsWith('/api/')) return true;   // ← 带 /client 前缀时不成立
auth.guard.ts:70-71 req.user = { id: userId };  req.userContext = { userId };   // ← 成为死代码
        ↓
data-scope.interceptor.ts:41  const userId = req?.userContext?.userId;   // undefined
data-scope.interceptor.ts:58  dealerScope: scope ?? ALL_SCOPE,           // ← 全量可见兜底
```

`auth.guard.ts:42-45` 的注释本身就预警了这个风险：
> 「…二者命名不一致会导致本地令牌会话的 userContext 为 undefined，进而回退 ALL_SCOPE（全租户可见，越权）。故此处同时写入 userContext 收敛身份源。」

即：P1-d 的修复方向正确，但**被 `startsWith('/api/')` 这行前缀判定架空**。

### 2.3 前缀来源
- 平台 core 包（`@lark-apaas/fullstack-nestjs-core`）用 `CLIENT_BASE_PATH` 调 `setGlobalPrefix(...)`；
- 本项目 `server/middleware/pos-upstream-csrf-bypass.ts:17-18` 注释明确：平台以前缀部署，
  机器对机器推送的 `originalUrl` 实际为 **`/client/api/...`**；
- 本机 `.env` 中 `CLIENT_BASE_PATH` 已设置。

---

## 3. 为什么现在才发现

- 接口级权限（`PermissionGuard`）自解析 token，一直正常 ⇒ 垂直越权测试全绿；
- 行级数据权限（`DataScopeInterceptor`）的失效是**静默**的（回退 ALL_SCOPE 不报错）；
- 需要一个「真的读 `req.userContext.userId`」的端点在带前缀直连下跑，才会以 500 暴露——
  这正是本轮 #811 迭代E 的隔离验证脚本（`/tmp/verify-811e.cjs`）偶然触发的。

---

## 4. 修复方向（三选一 + 代价）

| 方案 | 做法 | 优点 | 代价 / 风险 |
|---|---|---|---|
| **A（推荐）** | `AuthGuard` 的前缀判定改为「兼容 base path」：以 `CLIENT_BASE_PATH` 计算 API 前缀，`/api/` 与 `${base}/api/` 都算 API；或用 `req.originalUrl` 并允许前缀 | 直击根因、改动 3~5 行 | 会让此前「因早退而完全免鉴权」的 `/client/api/*` 无 token 请求开始 **401** → 必须回归「公开路由是否都标了 `@Public()`」（login/health/webhook/pos-receiver 等） |
| **B** | 保留早退，但在 `PermissionGuard` 内顺带补写 `req.userContext`（它已解析出 userId） | 影响面最小 | 语义错位（权限守卫兼职身份注入）；无 `@CheckPermission` 的端点仍拿不到 userContext；治标 |
| **C** | 让 `DataScopeInterceptor` 缺失 userContext 时**默认拒绝**（多租户模式下 fail-closed） | 安全兜底 | 需与「未配置用户的单/多租户语义」对齐，否则可能大面积 403；仍需修 A 才能真正生效 |

建议顺序：**先 A（根因）→ 再 C（兜底纵深）**，A 落地时按下列清单回归。

## 5. A 方案回归清单（落地时必跑）

1. 无 token 访问 `/client/api/*`：
   - 带 `@CheckPermission` 的端点 → 401（此前 403 亦可接受，需确认前后一致）
   - **公开端点必须仍免鉴权**：`/client/api/auth/login`、`/client/api/health`、
     `/client/api/pos-receiver/*`（机器对机器）等 —— 逐个确认 `@Public()` 标注齐全；
2. 本地令牌登录后，`req.userContext.userId` 有值 ⇒ 透视模板 `GET .../pivot/templates` 由 500 → 200；
3. `DataScopeInterceptor` 日志/断点确认 `dealerScope` 不再等于 `ALL_SCOPE`（用经销商账号读取跨经销商数据必须被过滤）；
4. 全量回归：`check-permission-sync.cjs`（版本门禁）、`role-coarse-code-audit.cjs`、
   服务端/客户端构建、以及既有 e2e。

---

## 6. 明确不在本报告范围

- `POST /client/api/report/pivot` 语义是「查询」却挂写动作码（`report:pivot:create`）导致
  「`:view` 持有者可开页面、查询却 403」——这是**权限粒度语义**问题，独立评估（见
  `permission-811-remaining-evaluation-2026-10-12.md`）。
