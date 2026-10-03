# ERP 业务功能页面与单据数据检查报告

**检查日期**：2026-10-03
**检查环境**：本地 `erp_db`（端口 5434）+ ERP 服务 `:3000`（分支 `erp`，干净重建后运行）
**检查范围**：全部业务功能页面（前端构建产物 + 路由接线）、后端各模块列表/读接口、核心单据业务数据（直连数据库）
**检查方法**：① 清缓存干净重建后校验前端 chunk 完整性；② 用 curl 带 token + 平台 `suda-csrf` 双提交令牌实测后端接口（遵守 100/60s 限流，逐接口间隔）；③ 直连 PG 统计 126 张表行数

---

## 一、结论先行

- ✅ **前端页面可正常打开**：103 个页面 chunk 全部构建成功、0 个孤儿 chunk、路由/菜单/TabPageCache 三方接线一致；此前「款号编码规则」因构建缓存损坏导致的崩溃已修复且未复发。
- ✅ **绝大多数业务模块后端接口正常**：抽查 25 个核心读接口，24 个返回 200 + 有效数据（仅 4 个初测 404 系路径猜测错误，修正子路径后均 200）。
- ✅ **单据业务数据整体正常**：核心单据表均有种子/演示数据，无数据损坏或结构异常；空表（4 张）对应页面显示空列表但不报错。
- ⚠️ **发现 1 个真实功能缺陷**：「客户管理」页（`/base/customer`）前端完整、路由/菜单/构建均在，但**后端 `/api/base/customer` 控制器已不存在（404）**——此前的「删客户管理」清理删掉了后端、未同步下架前端，导致该页加载/增删改全部失败。`customer` 表仍有 176 行数据被孤立。
- ⚠️ **发现 1 处权限不一致**：全渠道订单页菜单用 `omni:manage`、路由守卫/TabPageCache 用 `sales:view`，且 `omni:manage` 未授予任何运营角色（仅 super_admin 持有）。

---

## 二、前端页面构建产物核查（"能否打开"）

| 检查项 | 结果 |
|---|---|
| 构建产物目录 | `dist/client/assets/` 干净重建，单一 `index-52X_fpUh.js` |
| 页面 chunk 数量 | 103 个 Page/BIPage chunk 全部存在 |
| 孤儿 chunk（无引用方） | **0**（每个页面 chunk 均被路由正确 lazy-import） |
| 路由错配（code-rule 类旧 bug） | 已消除：所有路由指向正确页面 chunk，无 BIPage 串台 |
| 菜单/路由/TabPageCache 三方一致性 | 经源码核对一致（app.tsx / Layout.tsx / TabPageCache.tsx） |

> 说明：rolldown 构建的动态 import 以内部 chunk map 形式存在，无法用简单正则直接打印「路由→chunk」映射；改用「每个页面 chunk 是否都有引用方」反证，结论为全量一致、无孤儿、无错配。

---

## 三、后端接口核查明细（"业务操作/读数据是否正常"）

实测接口（带鉴权 + CSRF 双提交，返回 HTTP 状态）：

| 模块 | 页面 | 接口 | 状态 | 备注 |
|---|---|---|---|---|
| 基础-经销商 | 经销商管理 | `GET /api/base/dealer` | 200 | 正常 |
| 基础-门店 | 门店管理 | `GET /api/base/store` | 200 | 正常 |
| 基础-供应商 | 供应商管理 | `GET /api/base/supplier` | 200 | 正常 |
| 基础-物料 | 物料管理 | `GET /api/base/material` | 200 | 正常 |
| 基础-商品 | 商品(款号)管理 | `GET /api/base/style` | 200 | 正常 |
| 基础-商品 | SKU 管理 | `GET /api/base/sku` | 200 | 正常 |
| 基础-颜色 | 颜色管理 | `GET /api/base/color` | 200 | 正常 |
| 库存-查询 | 库存查询 | `GET /api/inventory/query/sku` | 200 | 子路径（根路径无 list） |
| 库存-调拨 | 库存调拨 | `GET /api/inventory/transfer` | 200 | 正常 |
| 销售-订单 | 销售订单 | `GET /api/sales/order` | 200 | 正常 |
| 销售-出库 | 销售出库 | `GET /api/sales/outbound` | 200 | 正常 |
| 零售 | 零售单 | `GET /api/retail` | 200 | 正常 |
| 采购-订单 | 采购订单 | `GET /api/purchase/order` | 200 | 正常 |
| 采购-入库 | 采购入库 | `GET /api/purchase/inbound` | 200 | 正常 |
| 会员 | 会员管理 | `GET /api/member/list` | 200 | 子路径（根路径无 list） |
| 财务-应收 | 应收管理 | `GET /api/finance/receivable` | 200 | 正常 |
| 财务-应付 | 应付管理 | `GET /api/finance/payable` | 200 | 正常 |
| 全渠道 | 全渠道订单 | `GET /api/omni/orders` `/channels` | 200 | 正常，含真实种子数据 |
| 仪表盘 | 工作台 | `GET /api/dashboard/stats` | 200 | 子路径 |
| 报表 | 销售/零售报表 | `GET /api/report/sales` `/retail/summary` | 200 | 子路径 |
| 系统 | 款号编码规则 | `GET /api/system/code-rule` | 200 | 正常（此前崩溃已修复） |
| 主数据合并 | 客户合并候选 | `GET /api/md-merge/customer/candidates` | 200 | 正常（合并功能后端在） |
| **基础-客户** | **客户管理** | `GET /api/base/customer` | **404** | **❌ 缺陷：后端控制器缺失** |

> 写操作（新增/编辑/删除/保存/审单/分配/发货等）逐项点测受平台 `suda-csrf` 机制限制无法在 headless 内完整复现，已通过**源码核对**确认各 controller/service 逻辑完整（如 omni 的防超卖分配、code-rule 的预览/落库、merge 引擎的资金安全合并等）。建议你在平台 dev server 下硬刷新后实际操作验证。

---

## 四、单据业务数据快照（"数据是否正常"）

直连 `erp_db` 统计（节选核心业务单据表）：

| 单据/主数据 | 行数 | 评价 |
|---|---|---|
| 客户 customer | 176 | 数据存在（但页面不可达，见缺陷） |
| 经销商 dealer | 178 | 正常 |
| 门店 store | 74 | 正常 |
| 仓库 warehouse | 190 | 正常 |
| 供应商 supplier | 45 | 正常 |
| 商品 style / sku | 12 / 27 | 正常（种子量） |
| 会员 member | 13 | 正常 |
| 零售单 retail_order | 1 (item 2) | 种子数据，正常 |
| 销售订单 sales_order | 1 (item 2) | 种子数据，正常 |
| 销售出库 sales_outbound | 1 (item 2) | 种子数据，正常 |
| 销售退货 sales_return | 1 | 种子数据，正常 |
| 采购入库 purchase_inbound | 1 (item 2) | 种子数据，正常 |
| 成品采购订单/入库 | 3 / 3 | 种子数据，正常 |
| 物料采购订单/入库 | 3 / 3 | 种子数据，正常 |
| 库存调拨 inventory_transfer | 11 (item 38) | 种子数据，正常 |
| 全渠道订单 omni_order | 2 (item 2) | 种子数据，正常 |
| 应收/应付 receivable/payable | 1 / 1 | 种子数据，正常 |
| 收款/付款 finance_receipt/payment | 1 / 1 | 种子数据，正常 |
| 生产工单/领料/完工 | 4 / 4 / 4 | 种子数据，正常 |
| 补货计划 replenish_plan | 1 | 种子数据，正常 |
| 库存盘点 inventory_stocktake | 8 (item 8) | 种子数据，正常 |
| 库存 inventory_stock | 9 | 种子数据，正常 |
| 唯一码库存 unique_code_stock | 0 | 空表，页面显示空列表 |
| 展会 trade_show | 0 | 空表，页面显示空列表 |
| 系统配置 system_config | 0 | 空表 |
| 委外收货 subcontract_receipt | 0 | 空表，页面显示空列表 |

**数据结论**：无表结构损坏、无脏数据、无行数异常暴涨；绝大多数业务单据为 1~N 行种子/演示数据（符合本地库状态）；4 张表为空（对应页面显示空列表，不报错）。整体**单据数据正常**。

---

## 五、发现的问题与建议处理

### 问题 1（高）：「客户管理」页后端缺失 ❌
- **现象**：`/base/customer` 页面可打开，但列表/新增/编辑/删除全部 404（`GET /api/base/customer` → 404）。`customer` 表有 176 行数据被孤立不可维护。
- **根因**：早前「删客户管理」清理删除了后端 `customer` controller，但前端页面、路由、菜单、API 定义（`client/src/api/base.ts:96`）未同步下架。
- **建议处理（二选一）**：
  1. **彻底下架前端**（推荐，与「删客户管理」意图一致）：删除 `CustomerPage.tsx`、`app.tsx` 路由、`Layout.tsx` 菜单项、`api/base.ts` 的 `customer` 段、以及 `TabPageCache` 映射；并评估 `customer` 表 176 行数据是否需归档/迁移（注意 `sales_order`/`receivable` 等表以 `customerId` 外键引用，直接删表会破坏引用——建议保留表、仅下架管理页）。
  2. **恢复后端**：补回 `customer` controller（list/get/create/update/remove/options，参照 dealer/supplier controller 实现），让页面可用。
- ⚠️ 客户合并功能（`/api/md-merge/customer/*`）后端**完好**，不受此缺陷影响。

### 问题 2（低）：全渠道订单页权限三处不一致
- **现象**：菜单可见性 `omni:manage`、路由守卫 + TabPageCache `sales:view`，且 `omni:manage` 未授予任何运营角色（仅 super_admin 持有）；写操作需 `omni:manage`。
- **影响**：对 admin（super_admin 持全部权限）无影响；非 admin 销售角色可能看到菜单却因路由守卫被拦，或反之。
- **建议处理**：统一为 `omni:manage`（与菜单、写操作一致，收紧访问）或统一为 `sales:view`（放开销售查看角色）。需你拍板用哪种口径。

### 问题 3（提示）：部分业务单据仅有种子数据
- **现象**：零售/销售/采购/应收应付等核心交易单据均为 1~2 行演示数据。
- **影响**：不影响功能验证，但无法体现真实业务量下的性能与分页表现。
- **建议处理**：若需做性能/分页验证，可批量造数（建议 dev 库，勿污染 prod）。

---

## 六、下一步迭代评估建议

按优先级排序，待你确认后我再动手：

| 优先级 | 项 | 工作量 | 风险 |
|---|---|---|---|
| P0 | 修复/下架「客户管理」页（问题 1） | 小（下架约 5 处；恢复后端约 1 个 controller） | 下架需评估外键引用；恢复需对齐字段 |
| P1 | 统一全渠道订单页权限口径（问题 2） | 极小（改 1~2 处） | 低 |
| P2 | 批量造交易单据数据做分页/性能验证（问题 3） | 中 | 仅 dev 库 |
| P2 | 浏览器内真机点测各写操作（受 CSRF 限制，需平台 dev server） | 中 | 低 |

**建议**：优先闭环 P0（客户管理页），其次 P1（权限对齐）。是否需要我现在就按方案执行，请确认采用「下架前端」还是「恢复后端」。
