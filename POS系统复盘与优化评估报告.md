# 云裁 POS 系统 — 全量复盘与优化评估报告

> 审计对象：`pos-review`（服装门店 POS，React 19 + NestJS 10 + TypeScript + Drizzle ORM + PostgreSQL，运行于飞书 aPaaS）
> 审计方式：源码级静态走读 + 反模式扫描 + 关键路径 file:line 复核（未运行、未改动任何文件）
> 配套：`POS系统代码评估报告.md` / `POS系统修复完成报告.md` / `POS系统全面复盘报告.md` / `POS系统第三次复盘与修复报告.md`
> 版本状态：双端 `tsc --noEmit` 零错误，结构完整，可迭代；本报告聚焦"是否具备优化空间"与"达到成熟生产级 POS 的差距"

---

## 一、总体结论（成熟度判定）

**业务骨架成熟，工程与安全底座偏"内部 MVP/原型"，距生产级成熟 POS 有明显差距。**

- ✅ 业务覆盖对得起"服装门店 POS"：**13 类业务单据**齐全（销售/退换/挂单/预售/全渠道/库存调整/盘点/调拨/调拨申请/交接班/日结/储值/积分），核心交易链路可跑、领域建模正确。
- ✅ 财务与并发的"硬骨头"已做对：整数分方向有 `Math.round(x*100)/100`、下单/退货/库存/交接班均包 `db.transaction`、会员/班次/退货用 `.for('update')` 行锁防并发透支、退款防负值、单号唯一约束齐备。
- ⚠️ **最大短板在"落地"而非"设计"**：POS 自建鉴权子系统（`AuthGuard` + `AuthModule`）已实现却**未真正启用**；金额行项由客户端直写未做服务端权威覆写；离线同步幂等有缺口；全站无 `ValidationPipe`；零测试零 CI。

一句话：**算法层合格、边界层不及格**。作为 demo/内部试用已可用，作为多门店、多收银、对公对账的成熟 POS，需先补 P0/P1。

---

## 二、系统概览

| 维度 | 数据 |
|---|---|
| 代码规模 | 约 40.7k 行（client 30.8k / server 9.0k / shared 1.0k），304 个代码文件 |
| 后端模块 | 15 个：`sales` `returns` `members` `promotions` `inventory` `shift` `stock` `dashboard` `omnichannel` `settings` `erp-integration` `offline-sync` `master-data` `view` `auth` |
| 数据表 | 36 张：`server/database/schema.ts`，金额列统一 `numeric`（无 float/real/double） |
| 业务单据 | 13 类（23 张表头/明细表支撑） |
| 前端页面 | 10 个业务页 + 登录页，路由与角色守卫 `RequireAuth role=` 已接好 |
| 契约 | `shared/api.interface.ts` 统一前后端 DTO |
| 编译 | server / client `tsc --noEmit` 均 **exit=0** |

---

## 三、成熟度评分卡（对标"成熟生产级服装 POS"）

| 维度 | 评分 | 说明 |
|---|---|---|
| 业务覆盖度 | ⭐⭐⭐⭐ | 13 类单据齐全，前店交易+库存+班次资金+会员权益完整 |
| 财务正确性 | ⭐⭐⭐ | 整数分方向对、退款防负值；但行金额客户端直写、头金额浮点长尾 |
| 安全 / 鉴权 | ⭐⭐ | 子系统已实现却未启用，跨店越权、可旁路、无全局校验 |
| 数据一致性 | ⭐⭐⭐⭐ | 核心写均事务化 + 行锁，正向突出 |
| 并发与性能 | ⭐⭐⭐ | 行锁到位；3 个明细表外键缺索引、离线主数据全量下发 |
| 离线 / 同步 | ⭐⭐⭐ | 基础幂等有；挂单/无 clientId 调整单不幂等，ERP 同步无事务 |
| 可观测 / 测试 | ⭐ | 无单测/CI；异常过滤器泄露堆栈；无软删除 |
| 可维护性 | ⭐⭐⭐ | 结构清晰、CTE 风格好；含大量 lark 脚手架死代码 |

---

## 四、优化空间分级

### P0 — 严重红线（必须立即处理）

#### P0-1 门店/员工归属由客户端控制 + POS 鉴权未真正启用 → 跨店越权
- **证据**
  - `server/modules/sales/sales.service.ts:291` `const storeId = dto.storeId || STORE_ID;`，`:37` `STORE_ID='HZ-HB-YT-001'`（硬编码默认门店）。
  - `server/modules/offline-sync/offline-sync.service.ts:86` `resolveStoreId` **只校验门店存在性，不强制会话归属**。
  - `server/modules/auth/auth.guard.ts` 定义了 `AuthGuard`，但 `app.module.ts` 明确注释"不注册全局守卫"，全仓无 `@UseGuards(AuthGuard)`；所有 controller 仅挂平台 `@NeedLogin()`（SSO）。
  - `auth.guard.ts:41` `if (process.env.POS_AUTH_DISABLED === 'true') return true;` 可整体旁路。
- **影响**：平台 SSO 只证明"某人登录了飞书"，不提供门店/收银员上下文。任意登录者可为任意门店伪造销售/退货/库存调整/会员注册，污染业绩、库存与现金长短款口径。
- **建议**：① 从登录态→`pos_employee.store_id` 推导 `storeId`，服务端强制覆盖、拒绝采信 `dto.storeId`；② 将 `AuthGuard` 注册为 `APP_GUARD`，落实 `@Roles`/`@Public`；③ `POS_AUTH_DISABLED` 仅允许 `NODE_ENV=development`。
- **Before / After**
  ```ts
  // Before: sales.service.ts:291
  const storeId = dto.storeId || STORE_ID;
  // After: 从会话员工推导并强制覆盖
  const principal = this.request['posUser'];            // AuthGuard 注入
  const emp = await this.employeeSvc.getByCode(principal.employeeCode);
  const storeId = emp.storeId;                           // 服务端权威，忽略 dto.storeId
  ```

#### P0-2 销售单行金额由客户端直写、未被服务端权威覆写 → 财务对账断裂 + 可低报营收
- **证据**
  - `sales.service.ts:377-380` 直接落库 `item.unitPrice` / `item.lineAmount` / `item.discountAmount`（均取 `dto.items`）。
  - `hydrateItemsFromMasterData`（`sales.service.ts:83-142`）只覆写 `tagPrice/styleId/styleName`，**不覆写上述三项**；但同文件 `:79` 注释本意是"防止客户端伪造 0 元提货"——只防住吊牌价，漏了行金额。
  - 订单头 `totalAmount` 服务端按 `Σ qty*tagPrice` 重算（`:206-209,350`），与客户端 `lineAmount` 之和**必然不一致**。
- **影响**：客户端可传 `lineAmount:0`/`unitPrice:0`，使"用于收款的订单头金额"与"用于财务的明细金额"背离，营收被低报、对账永远不平。
- **建议**：在 `hydrateItemsFromMasterData` 内按 `tagPrice` 与折扣规则重算 `unitPrice/lineAmount/discountAmount`，并断言 `ΣlineAmount + discountAmount + roundingAmount === order.totalAmount`（含四舍五入闭合）。
- **Before / After**
  ```ts
  // Before: 直接采用客户端值
  unitPrice: item.unitPrice.toString(),
  lineAmount: item.lineAmount.toString(),
  // After: 服务端按吊牌价×折扣重算
  const lineGross = info.tagPrice * it.qty;
  const disc = computeLineDiscount(info.tagPrice, it.qty, orderDiscountRate);
  it.unitPrice = round2(info.tagPrice - disc / it.qty);
  it.lineAmount = round2(lineGross - disc);
  it.discountAmount = round2(disc);
  // 校验闭合
  assert(Math.abs(sum(it.lineAmount) + discount + rounding - total) < 0.005);
  ```

---

### P1 — 重要（应尽早处理）

#### P1-3 离线同步幂等不完整 → 重复入账风险
- **证据**
  - `pos_suspended_order.clientId` **无唯一索引**（`schema.ts:643+` `clientId` 仅为 `varchar`，对照 `pos_sale_order.clientId` `:205` `.unique()` + `idx_sale_order_client`）。
  - `server/modules/stock/stock.service.ts:191-201` 库存调整仅在 `dto.clientId` 存在时按 `ADJ-${clientId}` 幂等；**缺 clientId 时 `ADJ${Date.now()}…` 随机号不幂等**。
  - `offline-sync.service.ts:144-201` "置 syncing" 与 "业务写入+置 synced" **不在同一事务**。
- **影响**：网络抖动/重试会重复插入挂单、重复调整库存（尤其无 clientId 的调整单）。
- **建议**：给 `pos_suspended_order.clientId` 加 `.unique()` + `idx`；库存调整强制要求 `clientId`；业务写入与队列终态绑进同一事务。

#### P1-4 ERP 下行主数据同步无事务包裹 → 部分写入却报成功
- **证据**：`erp-integration.service.ts:145-278` 在循环内逐个 `insert…onConflictDoUpdate` 颜色/尺码/款式/SKU（`:159-217`），**整段无 `db.transaction`**；`:272` `status: success ? 'success' : 'failed'`，中途失败留半成品主数据不回滚。
- **影响**：款式/SKU 主数据不一致，POS 端出现孤儿 SKU、价格错乱。
- **建议**：用 `db.transaction` 包整批写入，失败整体回滚；以真实已写数量回填 `count`。

#### P1-5 全局缺少 `ValidationPipe` → 输入边界零自动校验
- **证据**：`main.ts` 无 `app.useGlobalPipes`；全仓（除 `node_modules`）无 `ValidationPipe`/`@IsString`；DTO 是 `shared/api.interface.ts` 的 `type`（运行期擦除），`@Body() dto` 即原始对象。
- **影响**：`remark`/`employeeId`/`name`/`phone` 等无长度/格式约束，易写超长字段或触发隐含漏洞。
- **建议**：注册 `ValidationPipe({ whitelist:true, transform:true })`，关键写接口改 class DTO + class-validator。

#### P1-6 凭据安全：默认密钥可伪造 + 可整体旁路
- **证据**：`auth.service.ts:208-217` 未配 `POS_AUTH_SECRET` 时回退硬编码 `'pos-dev-secret-do-not-use-in-production'`（`.env` 确实未配）；`auth.guard.ts:41` `POS_AUTH_DISABLED=true` 可全站免鉴权。
- **影响**：一旦启用 `AuthGuard` 却未设 env，任何人都可用公开密钥伪造合法 Bearer。
- **建议**：启动强制 `POS_AUTH_SECRET`（≥16 位）并 CI 检查；`POS_AUTH_DISABLED` 仅允许本地。

---

### P2 — 改进（值得做）

#### P2-7 金额浮点长尾：`totalAmount` 落库前未取整
- **证据**：`sales.service.ts:206-209` `totalAmount = reduce(sum + qty*Number(tagPrice))` 后 `:350` `totalAmount.toString()` **未 round**；而 `payAmount/discountAmount` 已 `Math.round(x*100)/100`（`:245-248`）。`tagPrice` 浮点乘法累积误差会写成 `599.9699999999999`。
- **建议**：所有金额落库前统一 `round2()`，或优先用 Drizzle numeric 表达式在服务端完成运算。

#### P2-8 离线主数据快照返回全量、无门店过滤
- **证据**：`offline-sync.service.ts:399-519` `select().from(posSku)` `:417` 无 where、`posMember` `:419` 无 where。
- **影响**：多门店下每次离线拉取巨大，且把别店会员下发到本店（数据越权/隐私）。
- **建议**：按 `storeId` 过滤 + 增量（`updatedAt`/version）分页。

#### P2-9 三个明细表外键缺索引
- **证据**：`schema.ts:215-221` `posPreorderItem.preorderId`、`304-310` `posOmnichannelItem.orderId`、`360-366` `posEodPayment.eodId` 仅 FK 无 `index()`（对照 `posSaleItem` 等均有）。
- **建议**：补 `index()`。

#### P2-10 全局无软删除
- **证据**：全 `schema.ts` 无 `deletedAt`；明细 FK 多 `onDelete("cascade")`。
- **建议**：核心主数据引入软删除或操作日志兜底，便于审计与误删恢复。

---

### P3 — 锦上添花

- **P3-11 前端脚手架死代码**：`client/src/components/business-ui/**`（约 60+ 文件）、`ExamplePage`、`server/modules/hello` 与业务无关，建议清理或明确为内部组件库。
- **P3-12 单号用 `Math.random()` 后缀**：`sales.service.ts:72`、`returns.service.ts:186`、`stock.service.ts:201` 依赖唯一索引兜底碰撞，建议改用序列/ULID。
- **P3-13 手写 SQL 转义**：`schema.ts:83,107` 的 `sql.raw(\`ARRAY[${elements}]::user_profile[]\`)` 用于复合类型数组序列化，仅限内部 ID、风险低，但建议迁移到参数化数组绑定。
- **P3-14 异常过滤器泄露堆栈**：`exception.filter.ts:69-71` 把未知异常 `stack/cause` 直接返前端，建议仅非生产环境返回。
- **P3-15 无自动化测试与 CI**：确认无 `*.spec.ts`/`e2e`、无 `.github`/`.gitlab-ci`。建议核心金额/库存/幂等路径补 e2e + CI。

---

## 五、正向确认（做得对、不必"修"）

- 金额列**全 `numeric`**（无 float/real/double）—— 比很多生产系统都稳。
- 密码 **scrypt 派生 + 常数时间 `timingSafeEqual` 比较 + 登录恒定耗时**（防时序枚举，`auth.service.ts:74-80,170-181`）。
- 下单/退货/库存调整/交接班/全渠道**均包 `db.transaction`**（`sales.service.ts:293`、`returns.service.ts:194`、`inventory.service.ts:99/257/428`、`shift.service.ts:90/144/457`、`omnichannel.service.ts:165`）。
- **行锁 `.for('update')`** 防并发透支（`sales.service.ts:425`、`returns.service.ts:229`、`shift.service.ts:97/151`、`members.service.ts:497`）。
- 退款服务端重算、积分/储值回冲 `Math.min(…, 余额)` / `GREATEST(0,…)` 防负值（`returns.service.ts:247-250,335-336`）。
- 单号唯一约束齐备（`order_no/return_no/adjust_no/shift_no/transfer_no…` 均有 `uniqueIndex`）。
- 全局异常过滤器已归一（`exception.filter.ts`）。
- 双端 TypeScript 类型检查零错误——迭代改动有安全保障。

---

## 六、迭代路线图（优先级）

| 阶段 | 必做项 | 目标 |
|---|---|---|
| **P0（红线）** | P0-1 门店归属服务端强制 + 启用 `AuthGuard`；P0-2 行金额服务端权威重算 + 闭合校验 | 消除跨店越权与财务对账断裂 |
| **P1（重要）** | P1-3 离线幂等补全；P1-4 ERP 同步事务；P1-5 `ValidationPipe`；P1-6 凭据安全收口 | 数据一致性 + 输入边界 + 鉴权可用 |
| **P2（改进）** | P2-7 金额取整；P2-8 离线按店过滤；P2-9 外键索引；P2-10 软删除 | 性能 + 多门店合规 |
| **P3（打磨）** | P3-11 清死代码；P3-12 ULID 单号；P3-14 堆栈脱敏；P3-15 补测试/CI | 可维护性与可观测 |

**最小修复 PR（建议先行）**
1. PR-A：服务端用登录态推导 `storeId` 覆盖 DTO + `AuthGuard` 注册为 `APP_GUARD`（解决 P0-1）。
2. PR-B：`hydrateItemsFromMasterData` 内重算 `unitPrice/lineAmount/discountAmount` 并断言 `ΣlineAmount + discount + rounding === totalAmount`（解决 P0-2）。

---

## 七、验证步骤

> 因 DB 连接由 `@lark-apaas/fullstack-nestjs-core` 注入、登录用平台 SSO，纯本地无法 `npm start`。验证建议两路：
> 1. **类型/静态**：`node_modules/.bin/tsc --noEmit -p tsconfig.node.json`（server）与 `-p tsconfig.app.json`（client），应零错误。
> 2. **逻辑级 e2e**：仿 ERP 的 `sim-*.cjs` 做法——直连 Postgres 实例化 Service，事务内建表+种子+断言，验证 P0/P1 修复：
>    - P0-1：用 A 员工令牌为 B 门店下单，断言 `store_id` 落为 A 所属门店、非传入值。
>    - P0-2：客户端传 `lineAmount:0`，断言落库行金额 = `tagPrice×qty`、且 `ΣlineAmount+discount+rounding` 与 `totalAmount` 闭合（误差 < 0.005）。
>    - P1-3：同 `clientId` 重复 `syncBatch(suspended_order)`，断言仅 1 行（唯一索引生效）。
>    - P1-4：ERP 下行同步中途抛错，断言整批回滚、无孤儿 SKU。

---

## 八、与既往报告的关系

- 本报告 P0-1（鉴权未启用 / 门店归属）、P2-7（整数分/取整）、P2-10（无迁移）、P3-15（零测试）与既往《第三次复盘与修复报告》的 M-5 / 角色授权 / 门店归属 等结论**方向一致**，本报告以真实 file:line 复核并补充了 P0-2（行金额未覆写）、P1-3（挂单幂等缺口）、P1-4（ERP 同步事务）等新发现。
- 既往报告曾出现"声称已修、实际未落盘"的教训；本报告所有条目均经源码复核，未采信报告自述。

---

## 九、P0-1 / P0-2 修复实施记录（已落地）

按报告建议，已实施两个最小修复 PR，双端 `tsc --noEmit` 均 **exit=0**。

### P0-2 销售单行金额服务端权威重算（sales.service.ts）
- `hydrateItemsFromMasterData`（`:146-147`）：覆写 `it.unitPrice = info.tagPrice`、`it.lineAmount = round2(info.tagPrice * it.qty)`，杜绝客户端伪造 0 元提货/低报营收。
- `createOrder`（`:225-228`）：`totalAmount = round2(Σ item.lineAmount)`（= 服务端权威行金额合计），并顺带修复 P2-7 浮点长尾。由于 `totalAmount` 由 `Σ行金额` 定义，行金额合计与订单金额**天然闭合**，对账不再因客户端值背离而平不了。
- 新增 `round2`（`:44`）按分取整工具函数。
- 注：`returns.service` 此前已实现"服务端重算退款行金额"（`:246` 注释），故本次仅改 sales。

### P0-1 门店归属服务端权威推导 + 启用 POS 鉴权
- `sales.service.ts` 新增 `resolveStoreId(principal, dtoStoreId)`（`:187-191`）：优先 `principal.storeId`（AuthGuard 从 Bearer 令牌注入的 `AuthPrincipal.storeId`），忽略客户端 `dto.storeId`；无登录态时回退（本地/离线兼容）。`createOrder` / `suspendOrder` / `resolveShiftId` 统一改用该权威 `storeId`（`:218-219`、`:305`、`:762`），消除"班次用客户端门店、订单用权威门店"的不一致。
- `auth.module.ts`：导出 `AuthGuard`。
- 11 个写控制器（`sales/returns/inventory/stock/shift/members/promotions/settings/erp-integration/offline-sync/master-data`）统一挂 `@UseGuards(AuthGuard)`——**按架构注释意图"按需挂在敏感写接口上"，未全局注册**以免与平台 `@NeedLogin()` SSO 冲突。
- 11 个对应模块均引入 `AuthModule` 使守卫可解析。
- `.env` 增加 `POS_AUTH_DISABLED=true` 本地开发旁路；生产须删除该开关并配置 `POS_AUTH_SECRET`（≥16 位），否则令牌可被伪造、且 `auth.service.readSecret` 在生产缺密钥时直接抛错。

### P1 修复实施记录（已落地，2026-09-22）

按报告建议继续推进 P1，4 项全部实施，双端 `tsc --noEmit` 均 **exit=0**。

#### P1-3 离线同步幂等加固
- `server/database/schema.ts`（`posSuspendedOrder`，`:654-655`）：`clientId` 加 `.unique()`，DB 层唯一索引兜底，防止离线重试/并发重复落挂单（此前仅靠应用层 pre-check，存在竞态窗口）。
- `server/modules/offline-sync/offline-sync.service.ts`（`processItem` catch，`:210-216`）：捕获 Postgres 唯一冲突（`SQLSTATE 23505` / duplicate）按**已同步**处理返回成功，使应用层与 DB 层双重幂等。
- ⚠️ 操作项：需在目标环境执行一次 DB schema 同步以真正落地唯一索引（本仓库为 code-first，索引由 `db-schema-sync`/迁移生成）。

#### P1-4 ERP 下行同步包事务
- `server/modules/erp-integration/erp-integration.service.ts`（`syncDownstream` 的 `styles` 分支，`:156-159`）：将「颜色→尺码→款式→SKU」整批主数据写入包进 `this.db.transaction(async (tx) => {...})`，中途任一步失败整体回滚，消除"写到一半崩溃留下半成品主数据"。`mockErpService.getStyles()` 网络调用保留在事务外，避免长事务。

#### P1-5 全局输入校验
- `server/main.ts`（`:27-28`）：注册 `app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }))`。`transform` 让入参按 DTO 类转型；`whitelist:false` 兼容既有 `shared` 中 interface 型 DTO（无装饰器，不被误删字段），待逐步迁移为 class 后可开启 `whitelist:true`。
- `server/modules/auth/auth.controller.ts`（`:7-18`）：把登录 `LoginBody` 从 `interface`（运行时擦除、无法校验）改为带 `@IsOptional() @IsString()` 的 `class`，使登录入参类型/必填真正生效（最高风险边界先落地）。

#### P1-6 凭据安全收口
- `server/modules/auth/auth.guard.ts`（`:42-46`）：`POS_AUTH_DISABLED` 旁路改为**仅非 production 生效**；生产环境即便误设该开关也绝不旁路，杜绝"上线即裸奔"。
- `server/main.ts`（`:11-16`）：启动期 fail-fast——`NODE_ENV=production` 且缺失 `POS_AUTH_SECRET` 时直接抛错退出，避免上线后鉴权形同虚设。
- `.env`：补充 P1-6 说明（缺失 `POS_AUTH_SECRET` 的启动校验约束）。

> P1 未覆盖项：`promotions/members/stock/transfers/prices` 等下行同步分支当前仅为桩（返回"同步 N 成功"但未真正落库，见 `syncDownstream` 各 case），属于功能性缺口，非事务问题，需另立项补全写入逻辑。P2（整数分、门店过滤、外键索引、软删除）、P3（死代码、单号随机、零测试 CI）仍待办。

### 第十节 P2 实施记录（已落地，2026-09-22）

在「场景 B（不破坏飞书 aPaaS 部署）」前提下推进 P2 四项，服务端 `tsc --noEmit --project tsconfig.node.json` **exit=0、零类型错误**。

#### P2-7 金额浮点长尾：集中 `round2` + 落库前取整
- 新增 `server/database/money.ts`：导出唯一权威 `round2`，统一取代各处内联 `Math.round(x*100)/100` 与 `toFixed`，消除口径不一致。
- `server/modules/shift/shift.service.ts`：`closeShift` 的 `saleAmount/refundAmount/cashExpected/cashDiff`、`executeEod` 的 `totalSales/totalRefund/totalDiscount/netSales`、EOD 支付方式明细 `saleAmount/netAmount` 改由 `SUM(numeric)` 经 `round2` 后再 `.toString()` 落库（此前直接落库、浮点长尾会污染对账）。
- `server/modules/returns/returns.service.ts`：最终 `refundAmount` 落库前再 `round2`（防御性双重保障）。
- `server/modules/sales/sales.service.ts`：`suspendOrder` 的 `totalAmount` 由 `dto` 直写改为 `round2(Number(dto.totalAmount))` 取整（避免客户端浮点无截断落库）。
- 销售订单头金额已由 P0-2 服务端重算并 `round2`，本次保持一致。全渠道单/预售单在 app 层**无写入路径**（仅查询/ERP 桩），不在本次范围。
- ⚠️ 决策说明（**已推翻并执行**）：原评估以"落库前取整"收口、将整数分列迁移列为独立 track。后续已按"对外元、对内分"策略**完成**全量列迁移，见下方「P2-7 进阶」。

#### P2-7 进阶：整数分列迁移（`numeric → bigint 分`）✅ 已完成
> 目标：从根本上消除 decimal 精度/浮点长尾与"元/分"口径混乱，所有金额在 DB 列与领域计算层一律以「分」(整数) 存储，仅在读写边界与「元」互转。

**单位约定（对外元、对内分）**
- 对外（DTO / 前端）一律「元」`number`，**保持历史契约不变 → 前端零改动**。
- 对内（DB 列 / 领域计算）一律「分」`bigint` 整数。
- 仅在边界转换：`toCents(元)` 入库、`fromCents(分)` 出参，集中收口于 `server/database/money.ts`。

**Schema（`server/database/schema.ts`）**
- 43 个货币列由 `numeric(...)` 改为 `bigint("name", { mode: 'number' })`；2 个比率列（`attachRate` / `memberSaleRatio`）**保留 `numeric`**，不转分。
- 比率列默认值保留 `'0'`（字符串），货币列默认值由 `.default('0')` 改为 `.default(0)`（数字）。

**边界转换落地**
- **写侧 `toCents()`**：`sales`(order/items/discounts/payments/suspendOrder/会员累计)、`returns`(refundPrice/lineAmount/refundAmount/会员储值回冲)、`shift`(openingCash/closingCash/cashActual/EOD 聚合)、`members`(储值充值日志)、`erp-integration`(tagPrice/costPrice) 全部包 `toCents`。
- **读侧·变量 `fromCents(Number(row.x))`**：`sales/returns/shift/members/dashboard/offline-sync/omnichannel/stock/promotions/master-data` 读取行内货币列处统一包 `fromCents`。
- **读侧·SELECT 目标列用 SQL 除法**：`posX.col` 是列引用**不能套 JS 函数**，改用 `sql<number>\`${posX.col} / 100.0\``（可空列 `closingCash` 用 `COALESCE(.../100.0, 0)`）直接在 SQL 层转元；涉及 `sales/returns/shift/stock` 多处 SELECT。
- `money.ts` 的 `toCents`/`fromCents` 签名放宽到 `number | string`（入参常带 `string|number` 联合类型），内部统一 `Number()` 强转，避免每个调用点再包 `Number()`。

**顺带修复的迁移引入 Bug**
- `returns.service` 储值退款日志 `balance` 原写为 `fromCents(member.storedValue) + toCents(storedRefund)`（**元+分混加，维度错误**），改为 `toCents(Math.max(0, fromCents(member.storedValue) + storedRefund))`（先算元再转分）。
- `members/returns` 的 `posStoredLog` 写库原误传 `.toString()` 字符串（bigint 列只收 number），改为 `toCents(元)`。
- `returns` 的 `posReturnOrder.refundAmount` 初值原误为字符串 `'0'`，改为数字 `0`。

**DB 侧**
- `scripts/migrate-money-columns.cjs` 已执行：货币白名单列改 `bigint`、跳过比率列，并修复默认值。
- ⚠️ code-first 约束：列类型变更需在目标环境执行一次 **DB schema 同步**（或重跑迁移脚本）才真正落库；DTO/前端因保持「元」而无需改动。

**验证**
- 服务端 `tsc --noEmit --project tsconfig.node.json` → **exit=0，0 错误**。
- 客户端 `tsc --noEmit --project tsconfig.app.json` → **exit=0，0 错误**。

#### P2-8 离线主数据快照：增量同步（since 游标）
- `server/modules/offline-sync/offline-sync.service.ts` `getMasterData(storeId, since?)`：新增 `since` 参数，对 color/size/style/sku/promotion/member/stock 七张表按 `updatedAt > since` 增量过滤；`store` 作为本店锚点不过滤（始终可取到本店基础信息）。
- `controller` 透传 `@Query('since')`；客户端以响应 `snapshotAt` 作为下次 `since` 回传即可实现增量拉取。
- 向后兼容：无 `since` 时退回全量（与旧行为一致）；`version` 字段保留兼容。

#### P2-9 三个明细表外键缺索引
- `server/database/schema.ts` 补支撑索引（此前仅有 FK 无索引，级联删除/连表查询会全表扫）：
  - `pos_omnichannel_item.order_id` → `idx_pos_omni_item_order`（`:308`）
  - `pos_preorder_item.preorder_id` → `idx_pos_preorder_item_pid`（`:218`）
  - `pos_eod_payment.eod_id` → `idx_pos_eod_pay_eod`（`:365`）
- ⚠️ 操作项：code-first，需在目标环境执行一次 DB schema 同步以真正落地三个索引。

#### P2-10 核心主数据软删除脚手架
- `server/database/schema.ts`：为 9 张表加 `deletedAt timestamptz` 可空列（style/sku/member/employee/promotion/store/color/size/stock），加性、零行为变化。
- 新增 `server/database/soft-delete.ts`：`notDeleted(table)` 生成 `deletedAt IS NULL` 过滤；`softDelete(db, table, id)` 将行置为已删（不硬删）。
- 读取路径接入 `notDeleted`：`master-data.service`（getColors/getSizes/getStyles/getStyleDetail/getSkus 共 5 处）、`offline-sync.getMasterData`（7 处，且不向离线下发已删主数据）。
- 后续项：① 删除端点（运营后台停用/恢复主数据）——**已完成**，见下方「P2-10 进阶（续）」；② 全局查询拦截器（统一注入 `notDeleted`）**已完成**，见下方「P2-10 进阶」；③ 审计已结合既有 `pos_operation_log`（删除/恢复自动写审计）。

#### P2-10 进阶：软删除全局拦截器（`scopeDatabase`）✅ 已完成
> 目标：在「查询边界」统一自动注入 `deletedAt IS NULL`，覆盖全部 9 张软删表，无需在任一查询调用点手写 `notDeleted`，从根本上消除「漏过滤导致已删主数据被读出」的回归风险。

**实现（`server/database/soft-delete.ts` 新增 `scopeDatabase`）**
- 以 Proxy 包裹注入的 drizzle `db`：`select / update / delete` 命中「带 `deletedAt` 列的表」时自动注入 `deletedAt IS NULL`；
  - 显式 `.where(c)` → 包裹为 `and(c, notDeleted(t))`；
  - 无显式 `.where` → 在执行终结点（`then / execute / get / all / values / run`）补 `.where(notDeleted(t))`。
- `insert` 完全透传（写入不受影响）；原始 `db.execute(sql)` 透传（责任在调用方）。
- `db.transaction(cb)` / `db.$transaction(cb)` 内的 `tx` 递归包裹，事务内同样自动过滤。
- 非软删表（如 `posSaleOrder` / `posShift` / `posEod` / …）及 `posEodPayment` 日结明细清理（唯一硬删，子表无 `deletedAt`）均**不加过滤、行为零变化**。

**落地（零查询调用点改动）**
- 14 个注入 `DRIZZLE_DATABASE` 的 service 构造函数统一加 `this.db = scopeDatabase(this.db)`（脚本 `scripts/wrap-soft-delete-scope.py` 批量完成，幂等）。
- 既有 `master-data` / `offline-sync` 中手写 `notDeleted` 保留为防御性冗余：拦截器已保证全局覆盖，即使其他 service 忘记手写也不会漏过滤。

**验证**
- 新增 `soft-delete.scope.spec.ts`（8 项）：覆盖 select/update/delete（含/不含显式 where）、insert 不注入、非软删表不注入、orderBy 链路不重复注入、事务内 tx 同样被包裹；`vitest run` 全量 **22 项通过**。
- 服务端 `tsc --noEmit --project tsconfig.node.json` → **0 错误**；客户端 `tsc` → **0 错误**。

#### P2-10 进阶（续）：删除端点（运营后台停用 / 恢复主数据）✅ 已完成
> 目标：提供运营后台「停用（软删除）/ 恢复」主数据的 HTTP 端点，复用 P2-10 既有的 `softDelete` 脚手架，确保删除路径绝对安全、可审计、可恢复。

**端点（`server/modules/master-data/master-data.controller.ts`）**
- `DELETE api/master-data/:type/:id` —— 停用主数据（置位 `deletedAt`），`@Roles('admin','manager')` 守卫；
- `POST api/master-data/:type/:id/restore` —— 恢复主数据（清空 `deletedAt`），`@Roles('admin','manager')` 守卫。
- `:type` 白名单：`store / coupon / member / employee / sku / style / size / color`（`posStock` 为运营库存量，不纳入通用停用/恢复入口）。非法 `:type` → 400；记录不存在 → 404。

**实现（`server/modules/master-data/master-data.service.ts`）**
- 构造函数保留 `rawDb`（原始未包裹拦截器的 db）：删除/恢复需穿透 `notDeleted` 过滤——软删除经 `softDelete(rawDb, ...)`，恢复用原始 `UPDATE ... SET deleted_at = NULL`（已删除行不在 `notDeleted` 范围内，必须用 raw 才能命中）；
- 删除/恢复前以 `rawDb.execute(SELECT 1 ... WHERE id=...)` 做存在性校验（穿透拦截器，能区分「不存在」与「已删除」）；
- 每次删除/恢复写入 `pos_operation_log`（`module='master-data'`、`action='delete'|'restore'`、`targetNo='type:id'`、`employeeId=操作人`），审计失败仅告警不影响主流程。

**验证**
- 新增 `master-data.soft-delete.spec.ts`（6 项）：存在时置位/恢复并写审计、不存在→404、非法类型→400、恢复穿透拦截器执行原始 UPDATE、8 类主数据类型映射覆盖；`vitest run` 全量 **28 项通过**。
- 服务端 / 客户端 `tsc` 均 **0 错误**。

> P2 遗留/待评估：原「软删除删除端点」已落地（见上）；全局拦截器（P2-10 进阶）**已完成**；整数分列迁移（P2-7 进阶）**已完成**。P2 主线（软删除）已全部收口。

## 十一、P3 实施记录（死代码清理 / 单号 ULID / 单测与 CI）

P3 三项全部落地，验证：`server tsc` exit 0、`client tsc` exit 0、`vitest run` 14 项全过。

### P3-12 单号随机改 ULID（消除碰撞隐患，零新增依赖）
- 新增 `server/database/id.ts`：自实现 `ulid()`（26 位、Crockford Base32、按毫秒时间可排序、随机部分 ~2⁸⁰ 碰撞概率）+ `generateDocNo(prefix)`（`prefix` + ULID，如 `SO01JZ...`），不引入任何第三方包。
- 替换原 `Date.now()+Math.floor(Math.random()*1000)` 随机单号共 **8 处**：
  - `sales.service.ts`：`generateOrderNo()` 改为 `generateDocNo('SO')`（并保留 `XS` 前缀可读性，落库处直接调用）。
  - `returns.service.ts`：`RT` 退货单号、`shift.service.ts`：`SH` 交班单号、`stock.service.ts`：`ADJ` 调拨/调整单号、`inventory.service.ts`：`TR` 调拨申请 + `ST` 盘点单号、`members.service.ts`：`M` 会员号 + `CP` 优惠券码。
- 验证：全文检索 `Date.now()}${Math.floor(Math.random()` 已**零残留**；单号列均为 `varchar(50)`，`prefix+ULID(26)` 最大 28 字符，安全无截断。
- 说明：此前这些随机单号靠唯一索引兜底碰撞，高并发门店（秒级多单）存在极小概率冲突导致写入失败；ULID 从根本上消除该风险且保留可排序性（利于按时间检索/对账）。

### P3-11 死代码清理（已核实零外部引用后删除）
- 删除 `client/src/components/business-ui/**`（~60 文件，均为平台业务组件内部互引，业务页面外部引用 0）。
- 删除 `client/src/pages/ExamplePage`（未路由）。
- 删除 `server/modules/hello`（已整段注释、未装配进 `app.module`）。
- 验证：双端 `tsc` 仍 exit 0，删后无悬空 import。以上均为脚手架/平台绑定孤儿代码，删除不影响任何收银/库存/会员业务路径。

### P3-15 单测与 CI（从零建立质量门禁）
- 新增 `vitest@^2.1.9`（选用 v2 而非 v5，规避 v5 的 rolldown 原生绑定在 macOS/CI 的安装 bug）；`package.json` 加 `test`/`test:watch` 脚本；`vitest.config.ts` 配 `environment: node` + `@server/@shared` 别名 + `css.postcss.plugins: []`（覆盖项目根 `postcss.config.js`，避免加载 tailwindcss/lightningcss 缺失的原生绑定）。
- 为三个纯逻辑、零平台/数据库依赖模块补单测（`*.spec.ts` 已被 `tsconfig.node.json` 的 `exclude` 排除，不污染服务类型检查）：
  - `money.spec.ts`（5）：`round2` 四舍五入、半值向偶、浮点长尾收敛。
  - `id.spec.ts`（7）：ULID 长度/字母表/单调递增、同毫秒不重复、`generateDocNo` 前缀拼接与长度上限。
  - `soft-delete.spec.ts`（2）：`notDeleted` 生成 `IS NULL`、`softDelete` 置 `deletedAt`。
  - 结果：**14 passed (14)**，耗时 < 1.2s。
- 新增 `.github/workflows/ci.yml`（GitHub Actions）：`ubuntu-latest` + Node 22，步骤 `npm ci --ignore-scripts`（跳过飞书平台 `postinstall` fullstack-cli）→ `type:check:server` → `type:check:client` → `test`。触发于 main/master/dev 的 push 与 PR。

### 实施约束与验证说明
- 因 DB 由飞书 aPaaS 注入、登录用平台 SSO，纯本地无法 `npm start` 跑通真实交易链；本次以双端 `tsc --noEmit` 零错误作为编译正确性证据。
- 运行期需保证：① 前端 `auth-interceptor` 已把 Bearer 挂到所有请求（已具备）；② 生产配置 `POS_AUTH_SECRET` 且现金ier 经 `/api/auth/login` 拿服务端令牌；③ 本地联调设 `POS_AUTH_DISABLED=true`。
- ⚠️ 工具注意：同文件多条 Edit 并发会互相覆盖（各自基于原始快照写入、末条胜出），编辑同一文件须**逐条串行**。
