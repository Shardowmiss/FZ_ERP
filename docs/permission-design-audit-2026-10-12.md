# 权限设计审计报告（2026-10-12）

> 针对两项报障的代码级核查：
> ① 「删除权限配置中的颜色组模块——该功能在产品中不存在」
> ② 「经销商 dealer_qhjn 只配了尺码查看权限，登录后却能新增尺码」
>
> 核查方式：真库 SQL 实证 + 真机 HTTP 请求复现 + 全量控制器守卫扫描（不凭代码推断）。
> 基线：`erp` 分支 `0610675`；库 `erp_db`(5434)；目录 433 码；控制器 86 个。

---

## 结论先行

| # | 报障 | 核查结论 | 证据强度 |
|---|---|---|---|
| ① | 颜色组功能在产品中不存在 | **与代码不符。颜色组是真实功能，且被款号硬依赖**（`style.color_group_id` NOT NULL，22 个款号全部引用）。它是**颜色组的唯一创建入口**。 | 强（真库 + 全仓库无自动建组路径） |
| ② | 只授尺码查看却能新增 | **成立，已真机复现**。根因是「资源级粗码授权 + 资源级粗码守卫」的组合语义，**不是单点 bug**。 | 强（HTTP 201 vs 403 对照） |

**一句话解释 ②**：在现模型下「只授查看」这个状态**根本不存在** —— 只要授权里出现了资源码（如 `base:size`），按父→子继承就自动拥有该资源**全部**动作（新增/编辑/删除）。真正只读必须授**动作子码**（`base:size:view`）。

---

## 一、颜色组（报障 ①）：证据与纠偏

### 1.1 真实数据

| 项 | 实测值 |
|---|---|
| `color_group` 表 | 10 行 |
| `color_group_color` 关系表 | 18 行 |
| `color` 表（颜色） | 9 行（杏/黑/蓝/灰/卡其/藏青/红/白/X） |
| `style.color_group_id` | **NOT NULL** |
| 引用颜色组的款号 | **22 个，全部**（无空值） |
| 其中 `CG-01 基础色组` | 被 **13 个款号**引用 |

### 1.2 硬依赖（读源码确认）

| 位置 | 内容 |
|---|---|
| `base/style/style.service.ts:161` | `createAuto()`：`if (!dto.colorGroupId) throw new BadRequestException('颜色组不能为空')` |
| `base/style/style.service.ts:295` | `create()`：同上硬校验 |
| `base/style/style.service.ts:428-430` | 批量导入按 `colorGroupCode` 反查，查不到即 `色组编码不存在` 报错 |
| `client/src/pages/base/StyleForm.tsx:246` | 款号表单「颜色组」为**必填**下拉，只能**选择**已存在的组 |

### 1.3 关键判定：颜色组**无任何自动创建路径**

全仓库检索 `ensureColorGroup` / `autoCreate` / 自动建组逻辑 = **0 命中**。
⇒ 颜色组只能来自：① `ColorGroupPage`（`POST /api/base/color-group`，**唯一 UI 入口**）；② 种子脚本。

> 注：库里 8/10 个组名为「色组」、编码形如 `CG_1790153010279`，是**页面自动生成编码**的产物（非自动建组），属测试期遗留数据。

### 1.4 若「统一删除」会发生什么

| 删除范围 | 后果 |
|---|---|
| 仅删菜单 + 权限项 | 产品侧不再出现该功能。**代价**：失去唯一的颜色组创建入口；款号表单的「颜色组」下拉虽仍可读（GET 端点为登录即可），但只能选历史遗留的组。 |
| 连后端 + 表一起删 | 款号新增/自动建款/批量导入**全部阻断**（`color_group_id` NOT NULL 无值可填）；22 个存量款号外键悬空。**需先改造款号模型**（改动大、不可逆）。 |

**⇒ 建议**：先确认口径。若「产品中不存在」指的是「不该作为独立功能模块出现」，推荐**仅移除菜单 + 权限配置入口**（低风险、可回滚），后端保留供款号使用。

---

## 二、dealer_qhjn 越权（报障 ②）：真机实证

### 2.1 复现（真实 HTTP，dealer 身份）

| 请求 | 守卫码 | 守卫粒度 | 实测 |
|---|---|---|---|
| `GET /api/base/size` | 无（仅登录） | — | **200** |
| `POST /api/base/size` | `base:size` | 资源级粗码 | **201 Created** ← 报障点 |
| `GET /api/base/color` | `base:color:view` | 动作级 | 200 |
| `POST /api/base/color` | `base:color:create` | 动作级 | **403** `无权访问该接口：base:color:create` |

同一账号、同一套中间件，**唯一变量是守卫粒度** → 根因锁定。

### 2.2 dealer 实际下发的权限（`/api/auth/me`，共 173 项）

```
size/color/sku 相关:  base:size:view,  base:size,          ← 粗码 + 动作码并存
                      base:size-group,                     ← 粗码（无任何动作子码）
                      base:sku,  base:sku:view,
                      base:color:view                      ← 只有动作码（第二轮 #793 已收敛）
```

**粗码 `base:size` / `base:size-group` / `base:sku` 的存在，就是「看起来只授了查看、实际全权」的来源。**

### 2.3 根因链（四环，缺一不可）

| 环 | 事实 | 出处 |
|---|---|---|
| ① 判定语义 | `canDo(code, held)` 严格**父→子**：持粗码 ⇒ 放行其**全部**动作 | `shared/permission-match.ts`（铁律#14） |
| ② 授权侧 | dealer 持 **54 个资源级粗码**（含 `base:size`/`base:size-group`/`base:sku`） | `rbac_role_permission` 实测 |
| ③ 守卫侧 | 控制器写端点仍校验**资源级粗码**（`@CheckPermission('base:size')`），未细化到动作码 | 全量扫描见第三节 |
| ④ 前端 | 页面缺动作级门控 ⇒ 越权在 UI 上「可见」（能看到新增按钮） | 上一轮 #807 已补 51 页 |

### 2.4 附带的三个发现

| 发现 | 说明 | 风险 |
|---|---|---|
| **dealer 授权不可复现** | `OPERATIONAL_ROLES` 里 dealer 只声明 `distribution:portal`，而该码已在第二轮被拆码 prune → 启动日志 `角色 dealer 目标 0 码，新增授权 0`。**173 条授权不来自播种**，来源不明（疑手工/已删除的脚本）。 | 换环境/重装即丢失；无法审计 |
| **播种清单含废弃码** | `store_manager` 声明 `retail:view`；`finance`/`purchasing` 声明 `report:garment_purchase`/`report:material_purchase` —— 启动日志显示**被跳过（不存在）** | 全新部署时这些角色会**缺权限** |
| **主数据读取无守卫** | `size`/`size-group`/`sku`/`color-group` 的 GET 仅 `@NeedLogin`，与 `color` 的 GET（有 `base:color:view`）**不一致** | 任意登录用户可读主数据 |

---

## 三、系统性问题：守卫粒度（用户问「权限设计是否存在问题」）

**是，存在结构性缺陷。** 全量扫描 86 个控制器：

| 指标 | 数值 |
|---|---|
| 写端点由**资源级粗码**守卫的资源 | **59 个** |
| 已细化到**动作级**的控制器 | **仅 4 个**：`api/base/color`、`api/pos-receiver`、`api/purchase/garment-inbound`、`api/purchase/inbound` |
| 仅有类级粗码守卫的控制器 | 15 个（`analytics`、`consistency`、`dashboard`、`profit`、`hangtag`、`inventory-flow/query/replenish/-plan/-template/warning`、`product-import`、`rbac-permission`、`rbac-user`、`retail-report` …） |

粗码守卫资源清单（59）：`base:size` `base:size-group` `base:sku` `base:style` `base:color-group` `base:style-attribute` `base:code-rule` `base:dealer` `base:store` `base:supplier` `base:material` `finance:receipt` `finance:payment` `finance:receivable` `finance:payable` `finance:month_close` `inventory:inbound` `inventory:outbound` `inventory:transfer` `inventory:stocktake` `inventory:barcode` `inventory:stocktake_mobile` `inventory:replenish` `purchase:order` `purchase:return` `purchase:reconciliation` `sales:order` `sales:outbound` `sales:return` `sales:retail` `sales:retail_return` `sales:reconciliation` `production:*`(8) `tradeshow:*`(4) `member:manage` `member:level` `member:merge` `md:merge` `omni:manage` `pos:cashier` `pricing:manage` `report:pivot` `report:semantic` `system:config` `system:role` `subcontract:manage` `analytics:lifecycle` `distribution:portal_po` `distribution:portal_partners` …

> **注意**：粗码守卫本身在「持粗码即全权」的语义下是**自洽**的，不算 bug；真正的缺陷是它使**「动作级最小授权」在全系统 59/63 的资源上不可达** —— 管理员想「只给查看」，只能自己去勾动作子码，而界面并不会阻止他勾资源粗码。

---

## 四、修复方案（按优先级）

### P0 — 收敛 dealer 的越权面（直接对应报障）

| 动作 | 内容 | 代价 |
|---|---|---|
| 授权最小化 | 把 dealer 的 54 个资源级粗码替换为对应的显式 `:view` 动作码（尤其 `base:size`→`base:size:view`、`base:size-group`→`:view`、`base:sku`→`:view`） | 小；需一次性数据修复 + 复查 |
| 可复现化 | 把 dealer 的权限清单补进 `OPERATIONAL_ROLES`（当前为空壳），使授权**可审计、可重装复现** | 小 |

### P1 — 守卫动作级细化（对齐既有范式）

| 动作 | 内容 | 代价 |
|---|---|---|
| 主数据先行 | 把 `size`/`size-group`/`sku`/`color-group` 的写端点守卫由粗码改为动作子码，GET 补 `:view`（完全复刻 `color.controller` 范式） | 小（4 个控制器） |
| 全量细化 | 其余 55 个资源的写端点同样细化（设计文档已写明这是既定后续步骤） | 大；需逐控制器回归 |
| 前端门控 | 与守卫同源的按钮级门控（#807 已补 51 页，含 Size/SizeGroup/Sku 页） | 已完成待提交 |

### P2 — 治理与防复发

| 动作 | 内容 |
|---|---|
| 种子卫生 | 清理 `OPERATIONAL_ROLES` 中 3 处废弃码，防止新部署缺权限 |
| 护栏脚本 | 新增「角色粗码体检」：列出每个角色的**有效动作集**（展开粗码后）与显式授权集的差集 ⇒ 暴露所有静默越权 |
| 界面提示 | 权限树勾选资源粗码时提示「= 全部动作」 |

---

## 五、可复现验证

```bash
# 1) 越权实证（dealer 身份打真实接口，无需口令：临时 token + 自签 CSRF）
NODE_OPTIONS= NODE_ENV=production ERP_CSRF_SIGNING_SECRET=<secret> node dist/server/main.js
ERP_CSRF_SIGNING_SECRET=<secret> node <实证脚本>.cjs
#   预期（修复前）: POST /api/base/size → 201 ； POST /api/base/color → 403
#   预期（修复后）: POST /api/base/size → 403

# 2) 守卫全量扫描
node scripts/scan-guard-granularity.cjs     # 输出 59 个粗码守卫资源

# 3) 权限目录护栏
node scripts/check-permission-sync.cjs      # 错误 0 / 告警 0
```

---

## 六、待决事项

1. **颜色组**：确认删除口径（见 1.4）。
2. **越权修复范围**：仅收敛 dealer，还是全系统 59 个资源统一动作级细化。
3. **上一轮 #807（51 页按钮门控）**：55 个文件已在工作区未提交，验证到「构建通过 / 护栏 PASS / 服务启动 433 码无 prune」，尚缺 CDP 真机按钮级复核。
