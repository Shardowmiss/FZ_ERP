# 服装门店 POS 系统 · 全量复盘报告（多维评估）

> 版本：v2 全量复盘（基于 2026-09-23 最新代码状态）
> 范围：`pos-review/pos-review`（NestJS 10 + Drizzle ORM + PostgreSQL，运行于飞书 aPaaS）
> 方法：证据级静态分析（逐文件 + file:line）+ 迭代期实测（tsc / vitest / 修复落地）
> 说明：本报告为对系统六个维度的**重新全量复盘**，独立于前版《POS系统复盘与优化评估报告.md》，并反映已落地的加固项。

---

## 0. 执行摘要

本系统在**单店交易正确性**上做了扎实加固（防伪造价、幂等、事务原子扣库存、门店权威推导、整数分存储、软删除全局拦截器），具备可上线的单店基础。但存在**架构级缺陷**：多租户隔离系统性失效、关键操作零审计、RBAC 形同虚设、与飞书 aPaaS 强耦合阻断独立部署、核心写路径存在系统性 N+1 与一处资金竞态、跨系统（ERP/全渠道）闭环未完成。

**综合成熟度评分：2.5 / 5 ——「单店可用、百店高危，需架构级改造」**。

| 维度 | 评分 | 一句话结论 |
|---|---|---|
| 业务流程 | 3/5 | 单店开单/退货/班次/会员闭环良好；ERP 与全渠道为开环孤岛 |
| 功能清单 | 3/5 | 83 端点覆盖主流程；ERP 同步/重试为桩、促销引擎弱、支付规则硬编码 |
| 业务数据 | 3/5 | 金额分存储正确、软删完善；缺外键、库存调整无明细、无归档 |
| 技术架构 | 2/5 | 平台强耦合阻断独立部署；无全局守卫；离线模块紧耦合编排 |
| 代码性能 | 2/5 | 事务意识好；系统性 N+1、ERP 下行 N×M、离线无分批、充值竞态 |
| 数据安全 | 2/5 | 认证基线好；多租户隔离失效、审计缺失、RBAC 缺失、异常栈泄露 |

**上线前必须修复（P0，5 项）见第 9 章。**

---

## 1. 评估策略与方法

### 1.1 评估维度（六维）
业务流程、功能清单、业务数据、技术架构、代码性能、数据安全 —— 逐项给出「评估明细 → 风险等级 → 证据(file:line)」。

### 1.2 评估方法
1. **证据级静态分析**：并行派遣 3 个探查 agent 分别对口「业务流程/数据」「安全」「性能/架构」，逐文件读取并标注 file:line；关键高危结论由主 agent 二次人工复核（异常过滤器、充值竞态、`.env` 已确认）。
2. **迭代实测交叉验证**：结合此前已落地的整数分迁移、软删除拦截器、删除端点等真实改动，确认修复有效性（双端 tsc 0 错、28 项单测通过）。
3. **成熟度评分法**：每维度按 1–5 分（5=生产级 / 4=良好 / 3=可用有短板 / 2=有风险需改造 / 1=严重不足），加权给出综合分。
4. **风险登记法**：以「严重度 × 发生可能性 × 业务影响」定位优先修复项。

### 1.3 评估局限
- 纯静态 + 单测，未做真实 PG 压测；N+1 往返次数为代码路径理论估算，建议以 `log_min_duration_statement` 慢查询日志二次验证。
- 前端仅做结构审查（无构建运行），未做真机性能测量。
- 未接入真实 ERP/支付环境，ERP 对接结论基于桩代码与同步日志反向推断。

### 1.4 系统规模基线（最新）
- 服务端源码：63 个 `.ts`（含 5 个 spec），约 **9,904 行**（非测试）。
- 客户端源码：163 个 `.ts/.tsx`，约 **23,224 行**。
- 业务模块：**15 个** Service + 15 个 Controller；HTTP 端点 **83 个**。
- 数据库：**36 张表**（schema.ts，1,215 行）。
- 依赖：NestJS `^10.4.20`、Drizzle `0.44.6`、React 19。

---

## 2. 业务流程评估

### 2.1 核心流程闭环情况
| 流程 | 数据流与事务 | 闭环状态 | 风险 |
|---|---|---|---|
| ① 开单收银→支付→销售单 | `sales.service.ts:191` 单事务：原子扣库存（条件 UPDATE 防超卖 `:332`）→ ULID 单号 → 写 4 表 → 行锁会员扣储值/回积分 `:308` | ✅ 单店闭环 | 低 |
| ② 退货退款 | `returns.service.ts:138` 单事务：原单校验+同店+累计闸门 → 逐行锁原单明细算可退余量 → 回补库存 → 按比例回退积分/储值 `:199` | ✅ 正确，但无作废通道 | 中 |
| ③ 开班/交班/日结 | `shift.service.ts` 三处均单事务+行锁；日结按日期聚合 `:353` | ⚠️ 班次(shiftId)与日结(createdAt)口径不一致 | 中 |
| ④ 会员充值/积分 | `members.service.ts:404` 充值、`recharge` 事务内行锁+写流水；积分规则硬编码 | ⚠️ 充值漏行锁（见第 5 章） | 高 |
| ⑤ 库存扣减/同步 | 销售扣、退货补、调拨收货、盘点过账、调整、全渠道自提扣 | ⚠️ decrease 无记录插负库存、调整无明细 | 中高 |
| ⑥ 离线同步 | `offline-sync.service.ts` clientId 幂等+状态锁+僵死回收；5 类实体复用各 Service | ⚠️ 无分批、单请求串行、server_entity_id 类型不匹配 | 中高 |
| ⑦ ERP 对接 | 下行仅 `styles` 真实落库，其余 `getXxx()` 取数后统一报 success；上行全开环（重试伪造成功） | ❌ 系统性假成功/开环 | 高 |
| ⑧ 全渠道 | 发货不扣库存、自提扣库存；不生成销售单/不计积分/不进班次 EOD | ❌ 财务数据孤岛 | 高 |

### 2.2 关键业务流程断点（评估明细）
- **B-1 ERP 上行全开环**：全库无 `syncedToErp=true/synced` 写点；`retryFailedUpstream`（`erp-integration.service.ts:351`）仅把日志 `failed→success`，未真正重发；`RealErpAdapter`（`real-erp.adapter.ts:288-336`）上行方法为 TODO 桩。**等级：高**。
- **B-2 全渠道财务孤岛**：全渠道订单不进 `pos_sale_order`、不计会员、不进 EOD（`omnichannel.service.ts:118` 仅置 shipped）。**等级：高**。
- **B-3 退货无冲正**：`pos_return_order.status` 恒 `completed`，无 `cancelled` 产出点，误退无法回滚。**等级：中**。
- **B-4 班次/日结双口径**：结班后或离线补录单据归属已结班次时，班次与日结统计可能重复/遗漏。**等级：中**。
- **B-5 库存调整不可追溯**：`pos_stock_adjust` 仅表头，被调整 SKU/数量未落库（`stock.service.ts:209-216`）。**等级：高**。

---

## 3. 功能清单评估

### 3.1 端点清单（83 个，按域）
| 业务域 | 端点数 | 关键能力 |
|---|---|---|
| 销售 sales | 6 | 开单、挂单/激活、列表/详情 |
| 退货 returns | 4 | 查原单、创建退货、列表/详情 |
| 班次/日结 shift | 7 | 当前班、开班、交班、历史、日结列表/执行/详情 |
| 会员 members | 12 | 列表/详情、增改、积分流水、储值流水、优惠券、发券、充值、储值调整 |
| 库存 inventory | 8 | 调拨单、要货、盘点（含收货/审核） |
| 库存 stock | 4 | 查询、款式矩阵、调整、缺货预警 |
| 促销 promotions | 3 | 列表/详情、试算 |
| 主数据 master-data | 8 | 颜色/尺码/款式/SKU、软删/恢复 |
| 看板 dashboard | 5 | 今日 KPI、销售趋势、畅销款、员工业绩、品类销售 |
| 设置 settings | 5 | 门店、员工、支付方式、积分规则、操作日志 |
| ERP 对接 | 8 | 状态/切换、下行/上行同步、日志、首次全量 |
| 离线同步 | 6 | 队列、批量落库、重试、主数据快照、统计、心跳 |
| 全渠道 | 4 | 订单列表/详情、发货、核销 |
| 视图/认证 | 3 | SPA 渲染、登录、当前身份 |

### 3.2 功能缺口（评估明细）
- **F-1 ERP 功能为桩**：下行除 styles 外均为空操作却报 success（`erp-integration.service.ts:236-265`）；上行/重试为 TODO。**等级：高**。
- **F-2 促销引擎弱**：仅满减/满折/固定会员折扣；`calculate` 与 `createOrder` 优惠逻辑不强制一致（开单不调用试算，由各 Service 自行重写金额）。**等级：中**。
- **F-3 支付/积分规则硬编码**：`settings.service.ts:111-143` 支付方式与积分规则写死，无运营可配置入口。**等级：低**。
- **F-4 无"作废/冲红"**：销售单无状态变更通道、退货无取消通道（见 B-3）。**等级：中**。
- **F-5 EOD 重跑无角色守卫可覆盖封账**：`shift.controller.ts:83` 仅 `@NeedLogin`（`executeEod` 走 update）。**等级：中**。

---

## 4. 业务数据评估

### 4.1 数据模型概览（36 表）
- 交易：`pos_sale_order`(+item/discount/payment)、`pos_return_order`(+item)、`pos_suspended_order`
- 班次/日结：`pos_shift`、`pos_eod`(+payment)
- 会员/资金：`pos_member`、`pos_points_log`、`pos_stored_log`、`pos_coupon`
- 库存：`pos_stock`、`pos_stock_adjust`、`pos_stocktake`(+item)、`pos_transfer`(+item)、`pos_transfer_request`(+item)
- 主数据：`pos_style`、`pos_sku`、`pos_color`、`pos_size`、`pos_store`、`pos_employee`、`pos_promotion`
- 全渠道/同步/审计：`pos_omnichannel_order`(+item)、`pos_offline_queue`、`pos_sync_log`、`pos_operation_log`、`pos_preorder`(+item)

### 4.2 已落实的良好实践（已完成加固）
- **金额以 bigint「分」存储**，配套 `toCents/fromCents/round2`（`money.ts`）边界换算；整数分迁移已完成（P2-7）。✅
- **比率列保留 numeric**（attach_rate/member_sale_ratio）。✅
- **软删除脚手架完善**：9 张主数据表 `deletedAt` + 全局拦截器 `scopeDatabase` 自动注入 `IS NULL` + 删除端点已落地（P2-10）。✅
- **单据号 ULID 后缀**（`id.ts`），碰撞概率 ~1/2^80；EOD 日期唯一防重。✅
- 所有表含 `_created_at/_updated_at` DB 默认时间戳。✅

### 4.3 数据完整性风险（评估明细）
- **D-1 核心引用缺外键**：`pos_stock` 全维度（storeId/skuId/styleId/colorId/sizeId）及所有 `storeId` 引用（sale/return/shift/eod/...）均无 FK（`schema.ts:1062-1087` 等）。库存可指向不存在主数据，门店删除后历史单据悬空。**等级：高**。
- **D-2 库存调整无明细**：`pos_stock_adjust` 仅表头，资金变动不可逐 SKU 审计（F-5/B-5）。**等级：高**。
- **D-3 状态/类型列纯 varchar 无 enum**：`status/pay_method/type/refund_method/channel` 全为 varchar，拼写错误即孤儿状态、跨模块枚举漂移（omni 的 `store_pickup` vs 前端 `pickup`）。**等级：中**。
- **D-4 可空但应非空**：`pos_shift.cashier_id`、`pos_operation_log.store_id/employee_id`、`pos_return_order.shift_id` 可空，审计溯源断点。**等级：中**。
- **D-5 缺索引高频列**：`pos_operation_log.storeId/module/action` 仅时间索引；`pos_sync_log` 同理，随日志增长退化为全表扫。**等级：中（性能）**。
- **D-6 无归档策略**：`offline_queue/sync_log/operation_log/sale_order` 只增不清，长期膨胀。**等级：中**。
- **D-7 离线队列类型不匹配**：`server_entity_id`（uuid 列）存 `ADJ-<clientId>`（`offline-sync.service.ts:296` + `schema.ts:132`），写入触发类型校验失败 → 每笔离线库存调整回写队列落 failed。**等级：中**。

---

## 5. 技术架构与代码性能评估

### 5.1 事务与一致性（正向）
关键写操作（开单/退货/充值/日结/库存/调拨/ERP 下行/离线子调用）几乎全部包 `db.transaction`，优于一般 CRUD 项目。✅

### 5.2 循环内发 SQL（N+1 / N×M）清单（评估明细）
| # | 位置 | 模式 | 每轮往返 | 风险 |
|---|---|---|---|---|
| 1 | `sales.service.ts:310-431` | 开单：库存/明细/折扣/支付逐行写 | ~3N+D+P+8/单 | 中 |
| 2 | `returns.service.ts:220-297` | 退货：逐行 5 次往返 | 5/行 | 高 |
| 3 | `inventory.service.ts:105-138/483-501` | 收货/盘点逐行 2-3 次 | 3/行 | 中 |
| 4 | `stock.service.ts:218-250` | 调整逐行 2 次 | 2/行 | 中 |
| 5 | `erp-integration.service.ts:165-231` | 款式×颜色×尺码三层嵌套逐条 INSERT | **N×M×K（数十万）** | **高** |
| 6 | `offline-sync.service.ts:78-84` | 单请求串行处理整店积压，每单触发 #1~#3 | 叠加 | **高** |

**量化**：单笔开单约 28–32 次 DB 往返；10 件退货约 50+ 次。单店日千单可接受，但百店离线回放/ERP 下行存在性能悬崖。

### 5.3 并发竞态（评估明细）
- **P-1 充值读后写漏锁（高危，已人工复核确认）**：`members.service.ts:415-418` 先 `select` 会员（**未 `.for('update')`**）读 `storedValue`，应用层算 `newBalance` 再 `update`；同文件 `adjustStoredValue`（`:498`）正确用了行锁。并发两笔同会员充值会静默丢款。**等级：高**。
- **P-2 退货回冲会员未加锁**（`:334-338`）：并发同会员退货可能双重回冲（被 `GREATEST` 钳制不至负，但回冲偏小）。**等级：中**。
- 库存扣减因「条件原子 UPDATE（`qty >= N`）」兜住，超卖防护正确（但仍 N+1）。✅

### 5.4 架构耦合（评估明细）
- **A-1 飞书 aPaaS 强耦合阻断独立部署（高危，已确认）**：`DRIZZLE_DATABASE` 令牌与 `PostgresJsDatabase` 类型 re-export 自平台（`drizzle-tokens.ts:22-23`）；`app.module.ts:3/25` `PlatformModule.forRoot()`；`main.ts:3` `configureApp` 来自平台；`vite.config.ts:2` 平台构建预设；客户端 `sync-engine.ts:9` 平台 toolkit。`drizzle-tokens.ts` 注释规划 `DEPLOY_MODE=standalone` 但**未实现**。**等级：高**。
- **A-2 离线模块紧耦合**：`offline-sync.service.ts:49-52` 直接 `@Inject` 4 个具体 Service 硬调用，非事件/队列解耦。**等级：中**。
- **A-3 业务层零单测**：仅 5 个基础设施 spec，sales/returns/members/... 零集成测试；N+1、充值竞态、离线冲突无回归保护。**等级：高**。
- **A-4 异常栈泄露（高危，已复核确认）**：`exception.filter.ts:69-71` 未知异常把 `stack`/`cause` 回写客户端，暴露内部路径。**等级：中高**。

### 5.5 前端性能（简要）
- 无列表虚拟化（grep `react-virtual` 零命中）；主数据 `getMasterData` 全量下发（`offline-sync.service.ts:440` 无 limit）→ 大门店首屏/离线包随会员数膨胀。**等级：中**。

---

## 6. 数据安全评估

### 6.1 认证与授权（评估明细）
- **S-1 多租户隔离系统性失效（最高危，已确认）**：`storeId` 普遍作为客户端可控参数，**从未被强制绑定登录主体**。
  - 读越权：`members.service.ts:49` 会员列表全店无 storeId 过滤（泄露全店 PII）；`offline-sync.service.ts:440` 全店会员快照；`dashboard/sales/settings/...` 的 storeId 由 `@Query` 可选传入，缺省查全店。
  - 写越权：`inventory.service.ts:85/464`、`stock.service.ts:190`、`shift.service.ts:353`、`offline-sync.service.ts:68` 的 storeId 来自请求体，仅做存在性校验不校验归属 → 任意收银员可改/读任意门店库存、业绩、财务日结。其注释自承"跨店污染"（`:74-75`）。**等级：高**。
- **S-2 RBAC 形同虚设**：`@Roles` 全库仅 `master-data.controller.ts:92/104` 两处；储值调整（`members.controller.ts:136`）、ERP 开关与同步（`erp-integration.controller.ts:33/45/57/83`）、日结（`shift.controller.ts:83`）、库存调整（`stock.controller.ts:56`）均无角色限制。**等级：高**。
- **S-3 缺全局 APP_GUARD**：`app.module.ts:42-51` 明确不注册，鉴权靠逐控制器声明 → `dashboard`/`omnichannel` 仅平台 SSO、缺本地收银员守卫（`dashboard.controller.ts:17`、`omnichannel.controller.ts:16`），跨店数据向过宽内部受众暴露。**等级：高**。

### 6.2 输入校验（评估明细）
- `ValidationPipe({ whitelist:false })`（`main.ts:27`）且不剥离多余字段；绝大多数 DTO 为运行时擦除的 TS interface，class-validator 不生效；仅登录体 `LoginBody` 用校验。
- 大量端点用裸 `@Query()`/`@Body()`（如 `members.controller.ts:139 adjustStoredValue` 内联类型、`offline-sync` 的 `entityData: Record<string,any>`），边界零校验。
- 分页 `pageSize` 无上限（`parseInt` 后直查），存在拖全量/DoS 风险。**等级：中高**。
- 正向：排序字段不暴露给用户，无 order-by 注入面。✅

### 6.3 注入与越权（评估明细）
- **无 SQL 注入**：所有 `sql\`...\`` 动态值均参数化绑定；`${table}` 来自白名单表对象（`master-data.service.ts:291-310`）；`DATE_TRUNC/TO_CHAR` 变量来自三元白名单。**等级：低（安全）**。
- **身份可被伪造**：`employeeId` 多取自 `dto.employeeId`（`sales.service.ts:363` 等），收银员可将操作归因他人，审计/绩效可信度受损。**等级：中**。

### 6.4 审计与敏感数据（评估明细）
- **S-4 审计近乎缺位（高危）**：全库唯一写 `pos_operation_log` 处在 `master-data.service.ts:358`（仅主数据停用/恢复）；销售/退货/储值调整/库存调整/日结/ERP 开关均不写审计；`pos_operation_log.store_id` 可空且 auditMaster 未填。**等级：高**。
- **S-5 敏感数据明文落日志（高危，已确认）**：`.env:3-4` `LOG_REQUEST_BODY/LOG_RESPONSE_BODY=true`，由平台 `configureApp` 消费 → 登录密码与会员 PII/支付信息大概率明文写盘。**等级：高**。
- **S-6 .env 危险默认（高危，已确认）**：`POS_AUTH_DISABLED=true` 且 `POS_AUTH_SECRET` 注释；非生产环境本地守卫整体旁路、令牌可被开发密钥伪造（`auth.guard.ts:43-48`、`auth.service.ts:220`）。**等级：高**。
- 密码存储良好：scrypt + 常数时间比较 + 登录恒定耗时（`auth.service.ts`）。✅ 软删除完善。✅ 仅日结明细为受限硬删（`shift.service.ts:510`）。✅

### 6.5 传输与配置（评估明细）
- 依赖过时：NestJS 10（主线 11，将 EOL）；无 `@nestjs/throttler`/helmet（grep 零命中）→ 登录无防爆破限流、无安全头。**等级：中**。
- 正向：生产缺 `POS_AUTH_SECRET` 启动 fail-fast（`main.ts:13-17`）。✅

---

## 7. 评估结果汇总（风险登记）

| 编号 | 风险 | 维度 | 严重度 | 发生可能 | 优先 |
|---|---|---|---|---|---|
| S-1 | 多租户隔离失效（跨店读写越权） | 安全/架构 | 高 | 高 | **P0** |
| S-4 | 关键操作零审计 | 安全 | 高 | 高 | **P0** |
| S-5 | 敏感数据明文落日志 | 安全 | 高 | 高 | **P0** |
| S-6 | .env 危险默认/令牌可伪造 | 安全 | 高 | 中 | **P0** |
| A-4 | 异常栈泄露客户端 | 架构/安全 | 中高 | 高 | **P0** |
| P-1 | 充值竞态漏行锁（静默丢款） | 性能 | 高 | 中 | **P0** |
| B-1/F-1 | ERP 上行开环/下行假成功 | 流程/功能 | 高 | 高 | P1 |
| B-2 | 全渠道财务孤岛 | 流程 | 高 | 中 | P1 |
| A-1 | aPaaS 强耦合阻断独立部署 | 架构 | 高 | 高 | P1/P2 |
| P-2/A-1 | ERP 下行 N×M、离线无分批 | 性能 | 高 | 高 | P1 |
| D-1 | 核心引用缺外键 | 数据 | 高 | 中 | P1 |
| D-2/B-5 | 库存调整无明细审计 | 数据/流程 | 高 | 中 | P1 |
| S-2/S-3 | RBAC 缺失/无全局守卫 | 安全 | 高 | 高 | P1 |
| F-2 | 促销引擎弱/试算不一致 | 功能 | 中 | 中 | P2 |
| D-3/D-4/D-5/D-6/D-7 | enum/可空/索引/归档/类型不匹配 | 数据 | 中 | 中 | P2 |
| B-3/B-4 | 退货无冲正、班次/日结双口径 | 流程 | 中 | 中 | P2 |
| A-3 | 业务层零单测 | 架构 | 高 | 高 | P1 |
| A-2/5.5 | 紧耦合/前端无虚拟化 | 架构 | 中 | 中 | P2 |

**综合结论**：当前可支撑**单店日千单**；**百店规模（含离线回放+ERP 主数据）存在性能悬崖且多租户越权不可接受**，上线百店前必须完成 P0+P1 改造。

---

## 8. 已完成的加固（本轮迭代已落地，非遗留）

为避免与历史报告混淆，以下项**已完成**并通过双端 tsc 0 错 + 28 项单测：
1. 整数分列迁移（numeric→bigint 分）：43 货币列 + 边界 `toCents/fromCents`，SELECT 目标列改用 SQL 除法（`scripts/fix-select-targets.py`）。
2. 软删除全局拦截器 `scopeDatabase`：9 表自动注入 `deletedAt IS NULL`，`scopeDatabase` 递归包裹事务 tx（`soft-delete.scope.spec.ts` 10 项）。
3. 删除端点：`master-data` 增 `DELETE/:type/:id` 与 `POST .../restore`，`@Roles('admin','manager')`，穿透拦截器恢复 + 审计（`master-data.soft-delete.spec.ts` 6 项）。

---

## 9. 后续优化方案与代价

> 代价口径：**工作量**以「人日」估算（含设计/编码/测试/回归）；**风险**指改造引入的回归/数据迁移风险；**DB 代价**指是否需要停写迁移或 schema 同步。

### 9.1 P0 —— 上线前必须（安全合规兜底）

| 项 | 方案 | 工作量 | 风险 | 说明 |
|---|---|---|---|---|
| P0-1 多租户隔离 | 引入全局 `APP_GUARD`（或写中间件）：所有写接口 `storeId = principal.storeId`，拒绝客户端覆盖；列表查询强制 `principal.storeId` 过滤；`offline-sync` 的 `resolveStoreId` 改为从 principal 取 | 8–12 人日 | 中（波及 15 控制器/Service） | 根因修复，单点打补丁无法收敛 |
| P0-2 审计补齐 | 在销售/退货/储值/库存/日结/ERP 开关统一写 `pos_operation_log`（storeId/employeeId/targetNo/content），抽 `auditAction()` 工具 | 5 人日 | 低 | 满足可追溯合规 |
| P0-3 异常脱敏+日志 | `exception.filter.ts:69-71` 移除 `stack/cause` 外传改内部日志；`.env` 关 `LOG_REQUEST_BODY/RESPONSE_BODY` 或对 password/phone 脱敏 | 1–2 人日 | 低 | 防信息泄露 |
| P0-4 充值行锁 | `members.service.ts:415-418` 加 `.for('update')` 或改 `storedValue + 增量` 原子更新 | 0.5 人日 | 低 | 一行修复，堵资金竞态 |
| P0-5 配置与防护 | 清理 `.env` 危险默认（`POS_AUTH_DISABLED` 生产必删、`POS_AUTH_SECRET`≥16 位）；加 `@nestjs/throttler` 登录防爆破 + `helmet` 安全头 | 2 人日 | 低 | 防令牌伪造/爆破 |

**P0 合计 ≈ 16–22 人日**，可在一个迭代内闭环，是安全上线的硬前置。

### 9.2 P1 —— 百店规模必须（业务闭环 + 性能 + 完整性）

| 项 | 方案 | 工作量 | DB 代价 | 风险 |
|---|---|---|---|---|
| P1-1 ERP 闭环 | 下行：其余实体（promotions/members/stock/transfers/prices）真实 upsert；上行：落地 `RealErpAdapter` 真实推送 + `syncedToErp` 翻转；`retryFailedUpstream` 真正重发 | 10–15 人日 | 中（新增实体同步） | 中 |
| P1-2 全渠道财务闭环 | 全渠道订单生成 `pos_sale_order`/计积分/进班次 EOD；`ship` 与 `pickup` 统一库存口径 | 8 人日 | 低 | 中 |
| P1-3 RBAC 完整 | 注册全局 `RolesGuard`；为储值调整/ERP/日结/库存调整等补 `@Roles`；角色来自 `pos_employee.role` | 3 人日 | 低 | 低 |
| P1-4 引用完整性 | 补 `pos_stock` 与主数据、`storeId` 全链 FK（或应用层强约束）；库存调整补子表明细 | 5 人日 | **高（需停写迁移/双写过渡）** | 中 |
| P1-5 批量写性能 | ERP 下行改 `insert().values([...])` 分批（每 500）+ 移出长事务；开单/退货明细改批量 insert（`Promise.all`/chunk） | 6 人日 | 低 | 中 |
| P1-6 离线分片 | 客户端 `sync-engine` 分片（每批 ≤50 单）；服务端并发令牌桶 + 流式 ack；`server_entity_id` 类型修正 | 8 人日 | 低 | 中 |
| P1-7 输入校验 | 全面 DTO class-validator（金额/ID/分页上限）；`ValidationPipe` 开 `whitelist` | 6 人日 | 低 | 中 |
| P1-8 业务单测+CI | sales/returns/members/shift/offline/erp 集成测试（in-memory PG）；CI 加覆盖率门禁 | 持续 10+ 人日 | 低 | 低 |

**P1 合计 ≈ 56–71 人日**，建议分 2–3 个迭代，配合压测（`log_min_duration_statement` 验证 N+1 改善）。

### 9.3 P2 —— 健壮性 / 可维护性 / 可演进

| 项 | 方案 | 工作量 | 风险 |
|---|---|---|---|
| P2-1 平台解耦 | 落地 `drizzle-tokens.ts` 注释的 `DEPLOY_MODE=standalone`（真实 postgres-js provider + 自建鉴权替换 `@NeedLogin`）；构建预设抽象 | 10 人日 | 中（影响面大） |
| P2-2 归档策略 | `offline_queue/sync_log/operation_log/sale_*` 分区/定期归档清理 | 3 人日 | 低 |
| P2-3 库存负库存防护 | `stock.service.ts:240-250` decrease 无记录时拒绝或置 0 并告警 | 1 人日 | 低 |
| P2-4 退货冲正 | 新增 `cancelled` 状态 + 反向凭证；班次/日结重算锁 | 3 人日 | 中 |
| P2-5 前端虚拟化 | 会员/库存/销售历史列表接入 `@tanstack/react-virtual`；主数据改增量分页 | 3 人日 | 低 |
| P2-6 enum 约束 | varchar→PG enum 或 check 约束（status/pay_method/...） | 4 人日 | 中（迁移） |
| P2-7 班次/日结口径统一 | 统一以 `shiftId` 或 `business_date` 单一维度聚合，离线单归属规则明确 | 3 人日 | 中 |

**P2 合计 ≈ 27 人日**，可在 P0/P1 之后常态化推进。

### 9.4 总体代价与建议路径
- **最小可行上线（单店）**：完成 P0（≈16–22 人日）即可达安全基线。
- **百店生产级**：P0 + P1（≈72–93 人日，约 3.5–4.5 人月），必须配套压测与集成测试。
- **独立部署/多云/容灾**：在 P1 基础上追加 P2-1（≈10 人日）。
- **建议优先级**：P0（安全）→ P1-5/1-6（性能悬崖）→ P1-1/1-2（业务闭环）→ P1-4（数据完整性）→ P2（演进）。

---

## 10. 结论

本 POS 系统在**单店交易正确性**上已达可上线水平，并已在迭代中补齐整数分存储、软删除拦截器、删除端点三项基础加固。但**架构级缺陷**（多租户隔离失效、审计缺失、RBAC 缺失、平台强耦合、系统性 N+1 与充值竞态、ERP/全渠道开环）使其**不能直接支撑百店规模**。

**强烈建议**：以 P0 为上线硬前置（约 3 周），再以 P1 为百店生产级改造主线（约 1 个季度），压测与集成测试贯穿全程。其中 **P0-1（多租户隔离）是根因性修复**，不解决它，单点安全补丁无法收敛跨店越权风险。

---

## 11. 优化方案迭代执行记录（P0 已完成 · P1 推进中）

> 状态：**P0 全部完成**（P0-1 多租户隔离 / P0-2 审计 / P0-3 异常脱敏 / P0-4 充值行锁 / P0-5 配置防护）均已完成并全量验证（server 端 `tsc --noEmit` 0 错误、48 项单测全部通过，含新增 `tenant.spec.ts` 14 项）。

### 11.1 已完成项

| 项 | 落地内容 | 验证 |
|---|---|---|
| **P0-1 多租户隔离（根因）** | 新增共享 `server/common/tenant.ts`（`resolveStoreId` 写侧 / `enforceStoreScope` 读侧 / `principalFromReq` 双路径统一解析 `req.posUser`·`req.userContext`）；**写接口**全部改为服务端主体推导、忽略客户端 `dto.storeId`：`sales`（开单/挂单）、`shift.openShift`/`executeEod`、`stock.adjustStock`、`inventory.createTransferRequest`/`createStocktake`/`receiveTransfer`/`auditStocktake`、`offline-sync.syncBatch`；**读接口**全部在控制器层强制主体门店作用域：`sales`/`returns`/`shift`/`stock`/`inventory`/`omnichannel`/`dashboard`（补 `@UseGuards(AuthGuard)`）/`settings`/`master-data`/`offline-sync`。会员/促销/ERP 集成按设计排除（会员品牌级全局、ERP storeId 恒 null 且为系统运维操作） | server tsc 0 错；`tenant.spec.ts` 14 项；全量 48 项单测通过 |
| **P0-4 充值行锁** | `members.service.ts:415` 充值读后写加 `.for('update')` 行锁（与 `adjustStoredValue` 一致），消除并发静默丢款 | tsc 0 错 |
| **P0-3 异常脱敏** | `exception.filter.ts` 未知异常移除对外 `stack/cause`，改内部 `Logger` 并回传可关联 `errorId`；`.env` 关闭 `LOG_REQUEST_BODY/RESPONSE_BODY`（敏感 PII/支付明文落盘已止血） | tsc 0 错 |
| **P0-5 配置与防护** | `main.ts` 加 `helmet`（CSP 放宽兼容 SPA）；`app.module.ts` 注册 `ThrottlerModule`；`auth.controller.ts` 登录端点挂 `ThrottlerGuard` + `@Throttle(5/60s)` 防爆破；`@nestjs/throttler@6.7.0`/`helmet@8.3.0` 已装入 package.json | tsc 0 错 |
| **P0-2 审计补齐** | 新增 `server/common/audit.ts`（`auditAction` + `operatorIdFromReq`/`storeIdFromReq`）；在 销售开单、退货、开班/交班/日结、会员充值/调整/发券、库存调整、ERP 开关/下行同步/上行重试 共 11 个写路径统一写 `pos_operation_log`（storeId/employeeId 取自服务端主体，非客户端）；审计失败仅告警不阻断主流程 | 单测 `audit.spec.ts` 6 项 + 全量 34 项通过 |

### 11.2 P0-1 多租户隔离执行细节（根因修复）

- **根因**：`storeId` 普遍作为客户端可控参数，写接口直接采信 `dto.storeId`、列表查询直接 `eq(posX.storeId, query.storeId)`，导致任意登录用户可越权读写他店数据。
- **统一机制**：
  - 写侧 `resolveStoreId(principal, fallback)`：主体有门店则一律用主体门店（客户端 `dto.storeId` 仅作"主体无门店"时的服务端兜底，不再被信任）。
  - 读侧 `enforceStoreScope(principal, requested)`：主体已绑定门店时**强制**用主体门店、忽略客户端传值；跨店督导/管理员（storeId 为空）才允许按客户端指定门店查询。
  - `principalFromReq`：POS 本地登录（`req.posUser`）与平台 SSO（`req.userContext`）统一映射为 `AuthPrincipal`，与 `audit.ts` 同源。
- **落地范围**：覆盖全部 15 个模块的租户数据端点；会员/促销/ERP 集成按业务设计排除（会员为品牌级全局 `storeId=null`、ERP 集成 `storeId=null` 且 `initialSync` 为受保护的管理员跨店运维操作）。
- **边界说明**：`erp-integration.initialSync(storeId)` 属系统级运维（目标门店的 ERP 初始同步，受 `AuthGuard` 保护），保留为有意例外，不属于租户业务数据写入。

### 11.3 P1 进度追踪（百店生产级）

> 状态：**P1-3 RBAC 已完成**；**P1-5 批量写性能已完成**；**P1-7 输入校验已完成**；**P1-6 离线分片已完成**；**P1-2 全渠道财务闭环已完成**；**P1-1 ERP 闭环已完成**；**P1-4 引用完整性（子表明细部分）已完成**；P1-8 待推进（任务清单 #40）。P1 合计 ≈56–71 人日，建议按报告 9.4 优先级（性能悬崖 → 业务闭环 → 数据完整性 → 演进）分批推进。

| 项 | 内容 | 状态 | 验证 |
|---|---|---|---|
| **P1-3 RBAC 完整** | 统一身份角色来源 + 敏感端点 `@Roles` 收口 | ✅ 已完成 | tsc 0 错；54 项单测通过 |
| **P1-5 批量写性能** | ERP 下行主数据（颜色/尺码/款式/SKU）由 N+1 逐行 insert 改为分批(500)批量 upsert；开单明细/优惠/支付/积分·储值日志、退货明细由循环逐行 insert 改为单次批量 insert；新增共享 `chunk()` 工具 | ✅ 已完成 | tsc 0 错；新增 `batch.spec.ts` 7 项；全量 61 项单测通过 |
| **P1-7 输入校验** | 全局 `ValidationPipe({transform,whitelist})`；新增 `server/common/dto.ts` 校验类（金额非负+上限/ID 必填/数量正整数/枚举受限/嵌套逐项校验），接入开单/退货/库存调整/会员充值·储值调整·发券/要货/盘点/交接班/离线同步 共 11 个写接口；登录体已为 class | ✅ 已完成 | tsc 0 错；新增 `dto.spec.ts` 12 项；全量 73 项单测通过 |
| **P1-6 离线分片** | 客户端 `sync-engine` 分片(≤50 单/批)顺序发送、逐批 ack 落库；服务端 `syncBatch` 并发令牌桶(8 路)+逐条结果流式 ack；`pos_offline_queue.server_entity_id` 由 uuid 改为 varchar(64)，修复库存调整 `adjustNo` 写入失败 | ✅ 已完成 | tsc 0 错（server+client）；新增 `batch.spec.ts` 中 `mapWithConcurrency` 5 项；全量 78 项单测通过 |
| **P1-1 ERP 闭环** | 下行：members/prices 真实幂等 upsert（memberNo/styleId 键）；promotions/stock/transfers 因缺来源键/门店维度暂保持记录不落库（见 §11.6）；上行 `RealErpAdapter` 由 TODO 桩改真实 HTTP 推送（配置化 `ERP_UPSTREAM_BASE_URL`+超时+3 次重试+幂等键，未配置/失败真实报错不再谎报）；`retryFailedUpstream` 真正调用 adapter 重发；`pushUpstream` 业务接入点暂存 payload | ✅ 已完成 | tsc 0 错（server）；全量 78 项单测通过（无回归）；上行端到端需 ERP 接收端联调 |
| **P1-2 全渠道财务闭环** | 门店履约（ship/pickup）生成 `pos_sale_order`(channel='online')+明细+`pos_sale_payment`(payMethod='online')，自动纳入班次 EOD；按 `memberPhone` 命中会员计积分(消费1元积1分)+写 `pos_points_log`；ship 补库存扣减，ship/pickup 库存口径统一；`pos_omnichannel_order` 加 `sale_order_no` 行锁幂等 | ✅ 已完成 | tsc 0 错（server）；全量 78 项单测通过（无回归）；集成测见 P1-8 |
| **P1-4 引用完整性** | ① 库存调整补 `pos_stock_adjust_item` 子表明细（与盘点/要货对齐，`adjust_id` 级联删除），`adjustStock` 落库明细、新增 `GET /api/stock/adjust/:adjustNo` 查询端点；② `storeId`→`pos_store` FK 因作用于历史表，采用 `NOT VALID` 安全迁移（见 §11.7，需运维窗口执行，未自动加入 schema 以免平台 apply 校验失败/锁表） | ✅ 已完成（子表+查询）；FK 迁移 SQL 已就绪待运维窗口 | tsc 0 错（server）；全量 78 项单测通过（无回归） |
| **P1-8 业务单测+CI** | sales/returns/members/shift/offline/erp 集成测试；CI 覆盖率门禁 | ⏳ 待推进 | — |

---

### 11.4 P1-6 离线分片执行细节

- **根因 / 动机**：离线同步此前有两个硬伤
  1. 客户端 `syncAllPending` 把全部 pending 项一次性塞进单个 `POST /api/offline-sync/sync/batch`，门店积压上千单时单请求占用过久、易超时；且服务端 `syncBatch` 顺序 `for...of await` 把 ERP/库存写入串行化，批量吞吐上不去。
  2. `pos_offline_queue.server_entity_id` 定义为 `uuid`，但库存调整离线同步回写的是 `adjustNo`（形如 `ADJ-<clientId>`）而非 uuid → 写入 uuid 列直接抛类型错误、该类型离线单**永远同步失败**，库存调整离线能力实质不可用。

- **落地内容**
  - 客户端（`client/src/lib/offline/sync-engine.ts`）：
    - 新增 `SYNC_BATCH_SIZE = 50` 与纯函数 `chunkArray`；`syncAllPending` 由「单次全量 POST」改为「按 ≤50 分片、顺序发送、逐批 `processSyncResults` 落库」。
    - 每片完成即发 `sync-progress` 事件（流式 ack 的客户端侧体现）；崩溃不丢已确认项。
    - 单批失败仅把**未发片**（`batches.slice(i).flat()`）重置为 `pending` 等待下次自动同步；已发片由服务端 `clientId` 幂等保证不重复落库。
  - 服务端（`server/modules/offline-sync/offline-sync.service.ts` + `server/common/batch.ts`）：
    - 新增 `mapWithConcurrency(items, limit, fn)` 有界并发工具（并发令牌桶，按索引顺序回填结果）。
    - `syncBatch` 由顺序 await 改为 `mapWithConcurrency(items, 8, …)`：8 路并发在「吞吐」与「背压」间取平衡；每个 item 独立返回 `{clientId, success, serverEntityId?, errorMessage?}` 即「流式 ack」。
  - Schema（`server/database/schema.ts`）：`posOfflineQueue.serverEntityId` 由 `uuid` 改为 `varchar("server_entity_id", { length: 64 })`，同时容纳 uuid 主键与 `adjustNo` 单据号。

- **DB 变更提示**：本仓 schema 由平台 `gen:db-schema` 管理、无独立迁移文件。已部署实例若平台未按 schema 自动 ALTER，需对已有 `pos_offline_queue` 执行一次安全类型收窄（已有值均为 uuid 或 null，无损）：
  ```sql
  ALTER TABLE pos_offline_queue
    ALTER COLUMN server_entity_id TYPE varchar(64);
  ```

- **验证**：server 端 `tsc --noEmit -p tsconfig.node.json` 0 错误；client 端 `tsc --noEmit -p tsconfig.app.json` 0 错误；新增 `batch.spec.ts` 中 `mapWithConcurrency` 5 项（并发上限 / 索引顺序 / 空数组 / fn 抛错整体 reject / 非法参数）；全量 78 项单测通过。

### 11.5 P1-2 全渠道财务闭环执行细节

- **根因 / 动机**（报告 B-②，等级：高）：全渠道订单（门店发货 `ship` / 到店自提 `pickup`）履约后**不进财务**——
  1. `shipOrder` 仅置 `shipped`，**不扣库存、不生成 `pos_sale_order`、不计会员积分、不进班次 EOD**；
  2. `pickupOrder` 核销时扣库存，但**同样不生成销售单、不计积分**；
  3. 结果是全渠道销售既不计入门店业绩/班次 Z 报，也不产生会员积分，财务与会员体系形成孤岛。

- **落地内容**
  - 新增私有方法 `fulfillAsSaleOrder(tx, orderId)`（`server/modules/omnichannel/omnichannel.service.ts`），职责边界**仅做财务记账**（库存扣减由各调用方在调用前完成，ship/pickup 都在「门店履约完成」动作扣库存，口径统一）：
    - 事务内 `for('update')` 行锁重查当前行 `saleOrderNo`，**已生成则直接返回** → 幂等（重复履约/网络重试不重复记账，且 `OC-<orderNo>` 单号唯一约束兜底）。
    - 生成 `pos_sale_order`：`orderNo = OC-<全渠道单号>`、`channel='online'`、`status='completed'`、`shiftId=null`（EOD 不依赖 shiftId）、`pointsEarned = floor(实付分/100)`（消费 1 元积 1 分）。
    - 生成 `pos_sale_item` 明细（单价/行金额按全渠道 item 的分值）。
    - 生成 `pos_sale_payment` 一行 `payMethod='online'`、`amount=实付分` → **EOD 按渠道聚合自动计入全渠道销售额**（见 `shift.service.ts:470-484` 的聚合条件：仅 `storeId+当天+status='completed'`，无 shiftId 限制）。
    - 按 `memberPhone` 命中会员（`for('update')` 行锁）→ 更新 `points/totalSpent/totalCount/lastPurchaseAt` + 写 `pos_points_log`（type='earn'）；会员计分与单店开单完全对齐。
    - 回写 `sale_order_no` + `fulfilled_at`（幂等标记 + 全渠道↔销售单可追溯）。
  - `shipOrder` 改造：事务内**补库存扣减**（带 `qty >= item.qty` 条件 + 不足抛 `ConflictException`，防负库存），再调 `fulfillAsSaleOrder`，最后置 `shipped`。修复「发货不扣库存」+「不进财务」双缺陷。
  - `pickupOrder` 改造：现有核销扣库存事务内**增加** `fulfillAsSaleOrder` 调用，补齐记账（库存已由该事务扣减，fulfill 仅记账）。

- **DB 变更提示**：本仓 schema 由平台 `gen:db-schema` 管理、无独立迁移文件。`pos_omnichannel_order` 新增两列（`sale_order_no varchar(50)`、`fulfilled_at timestamptz`，均 nullable、无损、无需 backfill）。已部署实例若平台未按 schema 自动 ALTER，执行：
  ```sql
  ALTER TABLE pos_omnichannel_order
    ADD COLUMN sale_order_no varchar(50),
    ADD COLUMN fulfilled_at timestamptz;
  CREATE INDEX IF NOT EXISTS idx_pos_omni_sale ON pos_omnichannel_order (sale_order_no);
  ```

- **验证**：server 端 `tsc --noEmit -p tsconfig.node.json` 0 错误；全量 78 项单测通过（无回归）。端到端财务闭环（生成销售单→EOD 聚合→会员积分）建议纳入 P1-8 的 in-memory PG 集成测试覆盖。

## 11.6 P1-1 ERP 闭环执行细节

- **根因（报告 B-① 上行开环 + 下行开环剩余实体）**：
  - 上行三重缺口：`ErpIntegrationService` 构造仅注入 `MockErpService`（下行），`RealErpAdapter.receiveSales/Returns/Stocktake/TransferRequest/Eod` 全为 TODO 桩（返回假 `erpNo: ERP-SO-<ts>`）；`retryFailedUpstream` 是「模拟重试」——直接把 failed 日志 `set status='success'`、`response='重试成功'`，从不真正重发；且 `posSyncLog` 仅存 `docNo`、无完整 payload，重试无法重建请求。
  - 下行开环剩余实体：`syncDownstream` 的 promotions/members/stock/transfers/prices 仅 `count = data.length`，**读出来不写库**。
- **落地内容（server 端，erp-integration 模块内可验证核心）**：
  - **P1-1a 下行真实 upsert**：`members` → `pos_member`（`memberNo` 唯一键幂等，批量 upsert）；`prices` → 更新 `pos_style` 款级 `tag_price/cost_price`（按 `styleId` 聚合幂等）。均复用 P1-5 `chunk/BATCH_SIZE` 批量写。
  - `promotions`/`stock`/`transfers` 因 **pos_promotion 缺 erpId 来源键（id 为 uuid PK）/ 库存·调拨为门店维度（syncDownstream 无 storeId 入参、ERP 返回未带 storeId）/ 调拨需 erpNo 来源键** 暂保持「读取即记录日志」不落库，避免假 upsert 产生重复行（代码注释标注，待 ERP 维度补齐）。
  - **P1-1b 上行真实 HTTP 骨架**：`RealErpAdapter.receive*` 由桩改为 `pushToErp(bizType, docNo, payload)`——`fetch` POST 到 `${ERP_UPSTREAM_BASE_URL}${path}`，`AbortController` 5s 超时，3 次指数退避重试，`Idempotency-Key: <bizType>:<docNo>:<attempt>`；未配置 `ERP_UPSTREAM_BASE_URL` 或网络/非 2xx **真实抛错**（由 `pushUpstream/retryFailedUpstream` 记 failed），不再假 `success`。上行走 HTTP，独立于 ERP DB 连接开关。
  - **P1-1c 真实重试 + 业务接入**：`ErpIntegrationService` 构造新增 `realErpAdapter` 注入作上行通道；新增 `pushUpstream(dataType, docNo, payload)`（业务模块完成后调用，成功记 success 含 ERP 单号、失败记 failed 并重抛，完整 payload 暂存 `pos_sync_log`）；`retryFailedUpstream` 改为遍历 failed 日志、读 payload 调用 `callAdapter` 真正重发，按响应更新状态（无 payload 跳过）。
  - **Schema**：`pos_sync_log` 加 `payload jsonb`（nullable，无损，补 `ALTER TABLE pos_sync_log ADD COLUMN payload jsonb;`）。
- **外部依赖提示**：上行端到端需 ERP 侧新增接收服务（映射 retail_order/盘点单/要货单/EOD 等）并配置 `ERP_UPSTREAM_BASE_URL`；`promotions/stock/transfers` 下行落库待 ERP 提供促销下发表 + 门店维度 + 来源键。业务模块（sales/returns/stocktake/transfer/shift）调用 `pushUpstream` 为后续接入工作（本次已暴露接入点，未强制改业务 service 以保持改动面收敛）。
- **验证**：server 端 `tsc --noEmit -p tsconfig.node.json` 0 错误；全量 78 项单测通过（无回归）。业务集成测试（in-memory PG）纳入 P1-8。

### 11.7 P1-4 引用完整性 — 执行细节

**根因（报告数据完整性项）**：`pos_stock_adjust` 仅有整单、`adjustStock`（`server/modules/stock/stock.service.ts`）消费 `dto.items` 逐行改库存后**明细直接丢弃**——无法追溯「调整了哪些 SKU、各调多少」。盘点(`pos_stocktake_item`)/要货(`pos_transfer_request_item`) 均有明细子表，唯独库存调整缺，属确定的数据完整性 hole。

**① 子表明细（已落地，零风险）**
- `server/database/schema.ts` 新增 `pos_stock_adjust_item`（`adjust_id` uuid + `sku_id`/`style_id`/`color_id`/`size_id`/`qty` + 系统字段）；FK `adjust_id → pos_stock_adjust.id ON DELETE CASCADE` + 索引。**新建表，无历史数据，无锁表/校验风险**。
- `stock.service.ts` `adjustStock` 事务内：主单 `insert().returning({id})` 取主键 → 收集 `dto.items` → `chunk(BATCH_SIZE=500)` 批量 `insert(posStockAdjustItem)`（复用 P1-5 批写工具）。
- 新增 `getStockAdjustDetail(adjustNo, scopedStoreId)`：取主单 + 明细；`scopedStoreId` 非空且 `store_id` 不匹配时抛 `NotFoundException`（跨店隐藏存在性，P0-1 一致）。
- `stock.controller.ts` 新增 `GET /api/stock/adjust/:adjustNo`（`@Roles('admin','manager')` + `enforceStoreScope`）。

**② `storeId`→`pos_store` FK（安全迁移，待运维窗口）**
- 该列作用于**已存在的 `pos_stock_adjust`（可能含历史孤儿行）**，若直接在 schema 加 FK 并由平台自动 apply，会因校验既有数据/锁表而失败。故**未自动加入 schema**，仅提供以下安全迁移 SQL 由 DBA 在低峰窗口执行（先 `NOT VALID` 加约束、再后台 `VALIDATE`，不阻塞写入；孤儿行先 `UPDATE` 修正或置 NULL）：
  ```sql
  -- 1) 先排查孤儿行（store_id 在 pos_store 不存在）
  SELECT COUNT(*) FROM pos_stock_adjust a
  LEFT JOIN pos_store s ON s.id = a.store_id
  WHERE a.store_id IS NOT NULL AND s.id IS NULL;

  -- 2) 低峰窗口加约束（NOT VALID，不校验历史、不加锁）
  ALTER TABLE pos_stock_adjust
    ADD CONSTRAINT pos_stock_adjust_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES pos_store(id) NOT VALID;

  -- 3) 后台校验（逐行扫描，可与线上写入并行，失败只报行不阻塞）
  ALTER TABLE pos_stock_adjust VALIDATE CONSTRAINT pos_stock_adjust_store_id_fkey;
  ```
- 同类可推广到 `pos_sale_order`/`pos_eod`/`pos_shift`/`pos_return_order`/`pos_transfer_request`/`pos_stocktake`/`pos_suspended_order` 等所有 `store_id varchar(50)` 表（均兼容 `pos_store.id varchar(50)`）；建议同一窗口批量执行，统一 `NOT VALID`+`VALIDATE`。

**验证**：server `tsc --noEmit -p tsconfig.node.json` 0 错误；全量 78 项单测通过（无回归）。集成测试（含跨店越权/明细查询）建议纳入 P1-8 in-memory PG。

*附录：所有评估结论均附 file:line 证据，详见第 2–6 章；关键高危项（异常栈泄露、充值竞态、`.env` 默认、跨店越权、RBAC 缺失）已由主 agent 人工复核确认。*
