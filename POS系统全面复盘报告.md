# 云裁智慧门店 POS 系统 · 全面复盘报告

> 复盘对象：`pos-review/`（已执行第一轮修复后的代码）
> 代码规模：39,394 行 / 294 个源文件（client 32,363 · server 8,041 · shared 1,006）
> 复盘方式：静态代码全量通读 + 关键路径交叉验证
> 报告日期：2026-09-17
> 结论性质：**仅出具结论与建议，未改动任何代码，待你确认后再执行**

---

## 一、执行摘要（结论先行）

**一句话结论：第一轮修复解决了"看得见的资损"，但系统仍处在"任何人接触收银台都能在几分钟内套现"的状态；此外，第一轮声称完成的部分修复经实测并未落盘，且引入了 2 个新的回归缺陷。**

### 1.1 三条最关键的发现

| # | 发现 | 性质 |
|---|---|---|
| **1** | **第一轮修复存在未落盘**：P0-1（在线积分支付不扣积分）在 `sales.service.ts` 中仍是原代码，整条积分抵现链路依旧"给了优惠、不扣分、现金少收" | 修复未生效 |
| **2** | **第一轮修复引入了回归缺陷**：P2-3（抹零）只改了前端、服务端无对应字段，导致**任何一笔使用抹零的交易必然下单失败**；P2-1（单击加购）与双击弹窗共存，导致**双击一次多买 2 件** | 修复引入新 bug |
| **3** | **服务端是"零校验"状态**：全 server 无 DTO、无 ValidationPipe、无金额/数量边界校验、无门店级与角色级鉴权。所有资金校验都放在前端，前端可被绕过 | 架构级缺陷 |

### 1.2 问题总览

| 维度 | 致命 | 高危 | 中 | 低 | 小计 |
|---|---:|---:|---:|---:|---:|
| 资金安全与漏洞 | 6 | 9 | 7 | 1 | **23** |
| 产品设计与人性化 | 3 | 11 | 8 | 6 | **28** |
| 代码架构 | 4 | 2 | 8 | 4 | **18** |
| 程序性能 | 3 | 6 | 9 | 2 | **20** |
| **合计** | **16** | **28** | **32** | **13** | **89** |

### 1.3 修复优先级建议

| 批次 | 内容 | 条数 | 预估工作量 | 风险 |
|---|---|---:|---|---|
| **批次 0（立即）** | 第一轮未落盘 + 回归缺陷 | 3 | 0.5 天 | 不修=持续资损 |
| **批次 1（本周）** | 致命级资金漏洞 | 6 | 3 天 | 可被即时套现 |
| **批次 2** | 高危资金漏洞 | 9 | 3 天 | 对账失真 |
| **批次 3** | 服务端零校验的根治（DTO + 鉴权 + 整数分） | 3 | 4 天 | 架构性修复 |
| **批次 4** | 产品与体验 | 28 | 5 天 | 效率与客诉 |
| **批次 5** | 性能与架构治理 | 38 | 8 天 | 规模化瓶颈 |

---

## 二、第一轮修复落实情况核验

**这一节是本轮复盘最重要的产出。** 我对第一轮修复报告中的每一项做了"代码级"核验，结果如下。

### 2.1 未落盘的修复（声称已修，实际未修）

| 编号 | 声称的修复 | 实测现状 | 位置 |
|---|---|---|---|
| **P0-1** | 在线积分支付扣减积分 | ❌ **未生效**。仍为 `const pointsUsed = dto.pointsUsed ?? 0;`，而客户端 `createOrder` 根本不下发 `pointsUsed` 字段（全仓 grep 仅命中 2 个死文件的写死 `pointsUsed: 0`）。`payAmount` 计算中的 `- pointsUsed` 恒等于 `- 0` | `sales.service.ts:87,90` |
| — | 同上派生：积分流水永不产生 | ❌ `pointsDeduction`（:105）是死变量，从未参与任何计算与写库 | `sales.service.ts:105` |

> **⚠️ 该项为持续性资损：** 顾客用 1000 积分抵 ¥10 + 现金 ¥90 完成 ¥100 订单 → 服务端 payAmount=¥100、实收现金 ¥90、会员积分未扣一笔。每笔损失 = 积分抵扣面值，且不受任何发现机制约束（因为积分根本没有变动流水的对照）。
>
> 注：`generateOrderNo` 的并发修复（P1-1）经核验**已生效**（`:50-60` 已是无参 + 随机数版本），此项无问题。

### 2.2 引入回归缺陷的修复（修复造成新问题）

| 编号 | 修复内容 | 引入的问题 | 位置 |
|---|---|---|---|
| **P2-3 抹零** | 新增抹零按钮 | ❌ **必现下单失败**。抹零只在前端 `PaymentDialog` 生效，服务端 `CreateSaleOrderDto` 无 `roundingAmount` 字段。抹零 ¥0.50 后 `payments` 合计 ¥99.5，服务端算 `payAmount = 100 - 0 - 0 = 100`，`\|99.5 - 0 - 100\| = 0.5 > 0.01` → 抛「支付金额与应付金额不符」。**在线交易直接失败，离线单则 5 次重试后转死信（钱已收、单丢失）** | `PaymentDialog.tsx:52,169-179` ↔ `sales.service.ts:88-103` |
| **P2-1 单击加购** | 单击色码格直接加购 1 件 | ❌ **双击多买 2 件**。浏览器双击 = 2 次 `click`（各加购 1 件）+ 1 次 `dblclick`（弹窗）。顾客要 3 件 → 双击后输入 3 确认 → 实际入车 **5 件** | `SkuMatrix.tsx:50-83,185-189` |

### 2.3 经核验已正确落盘的修复

以下各项经代码核验确认生效，本轮不再列入清单：

P1-1 订单号并发 · P0-2 促销死循环 · P0-3 库存回滚 · P0-4 在线取单销挂 · P0-6 离线促销字段映射 · P0-7 余额校验 · P2-7 非现金找零 · P1-2 离线退货持久化 · P1-3 退货优惠分摊 · P1-8 Z报支付方式键 · P2-8 Fragment key + 备用金置空 · P0-5 客户端登录守卫 · P1-4 死信工作台 · P1-7 打印 · P2-2 快捷键 · P2-6 触屏适配 · P2-9 横幅统一 · P2-10 DialogFooter · `lib/store.ts` 常量收口

### 2.4 核验结论

> 第一轮修复在**客户端展示层与离线层**落实较好，但在**服务端资金链路**上没有留下痕迹。这说明当时的修复策略偏向"补前端体验"，而真正的资金闭环从未被打通。
> **建议：批次 0 必须优先执行，之后才谈其他治理。**

---

## 三、致命级风险（F 类 · 可直接造成资金损失）

> 判定标准：任何接触收银台的人可在数分钟内套现，且系统在财务侧不可见。

### F-1 积分抵现 = 白送钱，后端扣 0 分

- **位置**：`server/modules/sales/sales.service.ts:87,90,105`
- **触发**：收银员在支付弹窗选「积分抵扣」→ 前端校验通过 → 服务端 `pointsUsed = dto.pointsUsed ?? 0 = 0`
- **后果**：会员积分永不清零（可反复使用），门店每笔少收积分抵扣面值。单店日损失可达数千至上万元
- **修复**：`(1)` `CreateSaleOrderDto` 补 `pointsUsed` 并必填；`(2)` 服务端从 `payments` 汇总 `payMethod==='points'` 的金额反算 `pointsUsed = Math.round(amt * 100)`；`(3)` `payAmount = totalAmount - discountAmount - pointsUsed/100`；`(4)` 校验 `pointsUsed <= member.points`；`(5)` 扣减并写 `pos_points_log`

### F-2 服务端不校验商品单价与优惠金额，可 0 元提货

- **位置**：`sales.service.ts:82-91,98`
- **触发**：直接 `POST /api/sales/orders`，body 里 `items[0].tagPrice = 0.01` 或 `discounts:[{amount: 9999}]`
- **后果**：任意商品可 0 元出库，损失 = 吊牌价全额。客户端限制形同虚设
- **修复**：按 `skuId` 从服务端 `pos_sku/pos_style` 取吊牌价**覆盖**客户端传值；服务端调用 `PromotionsService.calculatePromotions` **重算**并用结果覆盖 `dto.discounts`；加断言 `tagPrice > 0`、`qty > 0`、`discountAmount <= totalAmount`

### F-3 退货无任何校验：同一行可无限退、可凭空造库存

- **位置**：`server/modules/returns/returns.service.ts:118-119,143-188`
- **触发**：¥1000 买 1 件 → 对同一 `originalItemId` 连续提交 10 次退货 → 退款 ¥10000 + 库存 +10
- **后果**：退款金额无上限；`qty` 传负数可反向减少已退数；`storeId` 可传他店实现跨店回补库存；SKU 无库存记录时 `:179-187` 直接 INSERT 出新库存行
- **修复**：`(1)` 事务内 `SELECT ... FROM pos_sale_item WHERE id IN (...) FOR UPDATE`；`(2)` 校验 `item.qty - refundedQty >= item.qty`；`(3)` 校验 `SUM(lineAmount) <= 原单 payAmount - 已退金额`；`(4)` 校验原单 `status='completed'` 且 `storeId` 一致；`(5)` 库存回补改为 `UPDATE`，禁止新建行

### F-4 退货不回退积分/储值，可循环刷分

- **位置**：`returns.service.ts:192-199`（仅 `totalSpent -= refundAmount`）
- **触发**：现金买 ¥1000 → 得 1000 积分 → 退货选「现金退款」拿回 ¥1000，积分保留 → 循环
- **后果**：每轮净赚 1000 分（≈¥10），可无限放大
- **修复**：按退货金额占原单比例回冲 `pointsEarned`（写 `pos_points_log type='return_revert'`）；`refundMethod` 为 `original`/`stored_value` 时原路退回储值并写 `pos_stored_log`

### F-5 班次与订单完全脱钩，长短款机制整体失效

- **位置**：客户端 `PosPage`/`ReturnPage` 零处下发 `shiftId`（已 grep 确认）；`shift.service.ts:145-170`
- **后果**：`saleCount/saleAmount/cashPayment` 恒为 0 → `cashExpected == openingCash` → `cashDiff` 永远等于「实点 − 备用金」。**交班无法发现任何长短款，Z 报与班次永远对不上**
- **修复**：`shiftId` 改为必填；服务端校验该班次 `status='open'` 且属于当前门店；未开班禁止交易

> **这条是"放大器"**：它让 F-1 至 F-4 的所有损失在财务侧不可见。必须与前四条同批修复。

### F-6 会员积分/储值可被任意接口直接改写

- **位置**：`members.controller.ts:56-61` + `members.service.ts:137-138`
- **触发**：`PATCH /api/members/:id {storedValue: 999999}`
- **后果**：凭空造储值。无流水、无上下界、无角色校验
- **修复**：删除 `patch.points / patch.storedValue` 分支；改为独立 `POST /members/:id/recharge` 与 `/adjust`，走流水 + 金额上界 + 店长角色 + 可选二次授权

---

## 四、高危风险（S 类）

| 编号 | 问题 | 位置 | 后果 | 修复方案 |
|---|---|---|---|---|
| **S-1** | 储值只校验/扣减**第一条**支付行 | `sales.service.ts:246-274` | `payments=[{stored_value:100},{stored_value:100}]`（余额150）→ 只扣100，白得100 | 用 `filter(...).reduce()` 汇总后统一校验扣减；`cashPayment` 同理汇总所有 cash 行 |
| **S-2** | 储值余额并发透支（读后写无锁） | `sales.service.ts:250-274`；`members.service.ts:410-416` | 离线补传并发 / 双端消费 → 余额变负；schema 无 `CHECK(>=0)` | 改条件更新：`UPDATE ... SET stored_value = stored_value - :amt WHERE id=:id AND stored_value >= :amt RETURNING`，无返回行即回滚；补 `CHECK` 约束 |
| **S-3** | 抹零必失败（**回归缺陷**） | `PaymentDialog.tsx:52,169-179` ↔ `sales.service.ts:88-103` | 见 §2.2。在线失败、离线丢单 | 新增 `roundingAmount` 字段随单下发，服务端 `payAmount` 减去抹零，并计入 `pos_sale_discount(type='rounding')` |
| **S-4** | 负数量 / 负金额未校验 | `sales.service.ts:115-153,217-225` | `qty=-5` 使 `qty - (-5)` 反而**加**库存；`payment.amount` 可为负反冲金额 | 入口加 `qty > 0 && Number.isInteger(qty)`、`p.amount >= 0`、`changeAmount <= cash amount` |
| **S-5** | 交班应收现金算法错误 | `shift.service.ts:153-170` | 只 `SUM(amount)` 未减 `changeAmount` → **每笔找零都虚增应收，系统性假短款**；非现金退货也全额从现金扣 | 改 `SUM(amount) - SUM(change_amount)`；`cashRefund = SUM(refundAmount) WHERE refundMethod='cash'` |
| **S-6** | 开班/交班非原子，可重复 | `shift.service.ts:72-82,126-136` | 并发双开班 → 订单归属错乱；重复交班 → 后一次覆盖前一次统计 | 加部分唯一索引 `UNIQUE (store_id) WHERE status='open'`；`closeShift` 整体入事务，用 `UPDATE ... WHERE status='open' RETURNING` 判空 |
| **S-7** | Z 报可重复执行、日期可任意指定 | `shift.service.ts:312-323,405-459` | 重复日结 → 支付方式明细翻倍；可对**未来日期**日结 | 先 `DELETE FROM pos_eod_payment WHERE eod_id=?`；`eodDate` 校验 `<= CURRENT_DATE`；日结前校验所有班次已 closed 且无 pending 离线单 |
| **S-8** | 离线队列 `syncing` 永久死锁 | `offline-sync.service.ts:87-93,306-325` | 进程重启/超时留下的 `syncing` 记录永不恢复，单据**静默丢失** | `processItem` 开头做超时回收：`UPDATE ... SET sync_status='pending' WHERE sync_status='syncing' AND updated_at < now() - interval '5 minutes'` |
| **S-9** | 离线同步 storeId 越权 | `offline-sync.service.ts:191,205,232,246`；`sales.service.ts:111` | `data.storeId \|\| storeId` 客户端优先 → 可把单据写进任意门店 | 一律使用登录态绑定的门店，忽略报文内 `storeId` |

---

## 五、中风险（M 类）

| 编号 | 问题 | 位置 | 建议 |
|---|---|---|---|
| **M-1** | 主数据快照全量下发会员手机号（PII） | `offline-sync.service.ts:374` `select().from(posMember)` 无门店过滤 | 仅下发本店有消费记录的会员并分页 + 服务端限流 |
| **M-2** | 离线防超卖**只在客户端** | `OfflineContext.tsx:296-306` | 补传失败需区分「库存不足」可重试码并进人工处理台；服务端下发安全水位 |
| **M-3** | `clientId`/单号可预测可碰撞 | `OfflineContext.tsx:308`（Date.now+6位）；`sales.service.ts:59`（同秒碰撞 1/1296） | 改 `crypto.randomUUID()`；单号冲突捕获后重试 |
| **M-4** | 促销摊分尾差 | `PosPage.tsx:136-153,204-215` | 改整数分计算 + 最大余数法把尾差分给金额最大的行 |
| **M-5** | 金额用浮点、单位混乱 | 全 server；`pointsUsed` 同时被当元和分用（`:87` vs `:105`） | 全链路改整数分，DB 统一 `numeric(14,2)` |
| **M-6** | 服务端不复核促销状态 | `promotions.service.ts:103-161` 仅试算，`createOrder` 不复算 | 结算时服务端重算并覆盖（见 F-2） |
| **M-7** | 支付校验容差允许少收 1 分；`payAmount=0` 直接放行 | `sales.service.ts:98` | 容差改 `1e-9`；0 元订单强制审批 |
| **M-8** | SQL 注入专项结论 | 全 server `sql\`...\`` 均为 Drizzle 参数化绑定 | **未发现注入**。但 `ILIKE '%'+kw+'%'` 未转义 `%`/`_`，建议加 `ESCAPE` |

---

## 六、产品设计与人性化（U 类）

> 判定标准：真实门店高峰期场景下，会不会坑到收银员、引发客诉、或造成隐性错误决策。

### 高危（会影响钱与账）

| 编号 | 问题 | 位置 | 场景与后果 |
|---|---|---|---|
| **U-1** | 设置页全「假保存」，还提示成功 | `SettingsPage.tsx:154-160` | `doSave` 是 `setTimeout(600)` + toast 成功，**无任何 API**。店长改了积分规则、关了某支付方式，第二天全是旧值 |
| **U-2** | 退货明细行金额 ≠ 底部「预计退款」 | `ReturnPage.tsx:371` 用 `unitPrice*q` vs `:171` 用分摊后单价 | 打折单退货时，行显示 ¥199、合计 ¥168.67。收银员按行金额解释，实际退款少了 → 当场争执 |
| **U-3** | 购物车不持久化，跨页即丢单 | `PosPage.tsx:48-66` cart 为组件内 state | 散客想现场开卡 → 侧边栏无入口 → 去「会员中心」再回来，购物车与已识别会员清零，队伍堵住 |
| **U-4** | 挂单无反馈 + 取单不可辨识 + 静默覆盖购物车 | `PosPage.tsx:479-524`；`PosDialogs.tsx:178-201` | 挂单成功无 toast 无单号；列表只有「散客 / ¥xxx / 14:32」，五单散客分不清；当前车有货时点错直接覆盖，商品全丢 |
| **U-5** | 交易完成弹窗关不掉 + 小票金额取整 + 二维码是假的 | `PosPage.tsx:685` `onClose={() => undefined}`；`ReceiptDialog.tsx:150,153,239-246` | X 和 Esc 都调空函数，用户以为卡死；小票 `toFixed(0)` 与下方实收 `toFixed(2)` 对不上；打印出来一个空方框 |
| **U-6** | 死按钮集群：点了完全没反应 | `PromotionsPage.tsx:114,184,187`；`ReturnPage.tsx:328`；`InventoryPage.tsx:248`；`SettingsPage.tsx:290`；`ErpSyncPage.tsx:187` | 「终止活动」是危险操作却是个空壳，店长误以为已停用，活动继续跑 |
| **U-7** | 硬编码假数据直接暴露在 UI | `InventoryPage.tsx:461` `¥1,286,540`；`ErpSyncPage.tsx:220-221` `23ms`；`MembersPage.tsx:376` 恒「正常」 | 店长看着 128 万库存总值做要货决策；运维看着 23ms 判断网络正常 |
| **U-8** | 交班「实点现金」被预填成系统应收 | `ShiftPage.tsx:63` `setCashCount(String(data.cashExpected))` | 一进页面就显示「✓ 账实相符」，不数钱直接交班，长短款永远是 0（已核验属实） |

### 中危（认知负担与效率）

| 编号 | 问题 | 位置 | 建议 |
|---|---|---|---|
| **U-9** | 看板 KPI 与趋势图口径不一致 | `DashboardPage.tsx:66-99` | 切「本月」后趋势变 30 天，KPI 卡仍是今日值且全标「较昨日」。KPI 接口随 period 传日期区间 |
| **U-10** | 无权限菜单静默重定向，零反馈 | `RequireAuth.tsx:24-26`；`Layout.tsx:11-42` | 点「门店库存」URL 变 /pos、页面纹丝不动。加 toast + 按角色隐藏菜单项 |
| **U-11** | 会员储值显示取整，校验精确到分 | `PosSidebar.tsx:190` `toFixed(0)` vs `PaymentDialog.tsx:101` `toFixed(2)` | 显示「储值 ¥100」实际 99.40，刷 100 被拦且不明原因。统一 `fmtMoney` |
| **U-12** | 加载失败被伪装成空状态 | `OmnichannelPage.tsx:52-55`；`InventoryPage.tsx:139-163`；`DashboardPage.tsx:78-82` | 网络抖动显示「暂无订单」，店员以为今天没单 → 漏发货。失败态与空态必须区分，给重试按钮 |
| **U-13** | 「清空购物车」无确认，Esc 却弹原生框 | `CartPanel.tsx:40-46`；`PosPage.tsx:553` | 手滑点清空整单消失不可撤销。统一走自定义确认弹窗（显示件数与金额） |
| **U-14** | 支付弹窗缺收银台标配效率设计 | `PaymentDialog.tsx:293-306` | 现金需手输 100；不足时按钮灰着不说明「还差 ¥X」；无法回车确认。加快捷面额 + 差额提示 + Enter 确认 |
| **U-15** | 全渠道「今日新增订单」被 Tab 过滤污染 | `OmnichannelPage.tsx:79-82` | 切到「待自提」，顶部变成待自提单数。店长据此排班错误 |
| **U-16** | 退出登录无确认；登录后不回跳原页面 | `Layout.tsx:93-96`；`LoginPage.tsx:35` 固定 `navigate('/pos')` | 收银中途误点退出 → 未结算购物车全丢；登录后看不到原来在看的 Z 报 |
| **U-17** | 矩阵数量输入框「卡死」 | `SkuMatrix.tsx:273-283` | 想输 12 件，先按 1 再按 2 被拒；清空后 `parseInt('')` 为 NaN 也吞。改 onChange 存字符串、onBlur 再 clamp |
| **U-18** | 库存页盘点/调整只读，无新建入口 | `InventoryPage.tsx:410-449` | 盘点差异只能看不能改，系统形同报表。补入口或明确标注「只读」 |
| **U-19** | 断网模拟开关无二次确认 | `ErpSyncPage.tsx:262-275`；`SettingsPage.tsx:354-363` | 演示时误触 → 全店交易转本地暂存且收银员无感知。加二次确认 + 常驻红色横幅 + 操作日志 |

### 低危

`U-20` 热销款推荐名不副实（`PosPage.tsx:92-94` 取的是 `pageSize:4` 而非销量）· `U-21` 断码预售话术无依据（写死「总仓有货」未校验）· `U-22` 充值支付方式用中文枚举（`RechargeDialog.tsx:15` 与全系统 `wechat/alipay` 键不一致，可能落库错误）· `U-23` 新建会员弹窗「取消」走 `onSuccess`（`CreateMemberDialog.tsx:219`）· `U-24` 设置页切换分类不提示未保存 · `U-25` 促销 Tab 只有选中项有计数

---

## 七、代码架构（A 类）

### 高危

| 编号 | 问题 | 位置 | 建议 |
|---|---|---|---|
| **A-1** | OfflineContext 已成"上帝 Context"，且自身穿透到 IndexedDB 层 | `OfflineContext.tsx:451-493` 手写 `db.transaction`；`:281-537` 七个 `createOfflineXxx` 是同一模板复制 | 删除 `addLocalStockBatch`（已有 `db.batchAddLocalStock`）；七个方法收敛为 `createOfflineEntity(type, data)` + `ENTITY_CONFIG` 表；Context 只做编排，IO 全部下沉 |
| **A-2** | 跨层用 `window.CustomEvent` 传递 pendingCount | `OfflineContext.tsx:266-279` 派发 ↔ `sync-engine.ts:601` 监听同一字符串 | 无类型约束、改名即静默失效。改为 SyncEngine 暴露方法由 Context 直接调用 |
| **A-3** | 服务端零 DTO / 零入参校验 | 全部 `*.controller.ts` 的 `@Body() dto` 均为 shared 里的 **type-only interface**；全 server 检索不到 `ValidationPipe`/`class-validator` 用法（依赖其实已在 `package.json:44-45`） | 引入 `ValidationPipe({whitelist, transform})`，为每个写接口建 class DTO，把散落在 service 的手工校验迁移进去 |
| **A-4** | 鉴权双轨 + 身份模型冲突 | `AuthContext.tsx:48-83`（前端 DEMO_ROSTER + 自签 hash token） vs 服务端 `@NeedLogin()`；`AuthContext.tsx:31` 的 `Employee` 与 `shared/api.interface.ts:819` 同名不同构 | 服务端实现 `/api/auth/login` 签发 JWT + 全局 Guard；客户端类型重命名 `SessionEmployee`；`RequireAuth` 增加服务端会话校验失败即登出 |

### 中危

| 编号 | 问题 | 位置 |
|---|---|---|
| **A-5** | 核心业务状态（购物车）只活在页面组件里，向子组件传 10+ props | `PosPage.tsx:48-66,637-678` |
| **A-6** | 支付方式映射 **8 处**重复且键仍不一致（含服务端 `settings.service.ts:111` 用 `unionpay` 而非 `bank_card`） | `PaymentDialog.tsx:32` `pos-receipt-print.ts:10` `ShiftPage.tsx:23` `OfflineQueuePanel.tsx:49` `OfflineDetailDialog.tsx:22` `ReceiptDialog.tsx:184` `ReturnPage.tsx:13` `settings.service.ts:111` |
| **A-7** | 金额/日期格式化 4 份实现、3 种风格 | `sync-constants.tsx:51` `InventoryListTable.tsx:156` `ReturnPage.tsx:24` `ShiftPage.tsx:31` |
| **A-8** | 单号生成三套规则（服务端 2 位年 / PosPage 4 位年 / pos-offline-orders.ts `LX`·`GD` 前缀） | `sales.service.ts:50` `PosPage.tsx:453` `pos-offline-orders.ts:28` |
| **A-9** | `as unknown as` 强转暴露"两套并行类型体系"：`master-data-cache.ts:36-109` 自建 Lite 类型与 shared 重复定义同一实体 | `PosPage.tsx:90,601` `master-data-cache.ts:348,419` `db.ts:1117` |
| **A-10** | 巨型文件：db.ts 1182 / schema.ts 1190 / master-data-cache.ts 793 / sidebar.tsx 727 / OfflineContext 692 / PosPage 690 / sales.service 662 / sync-engine 617 | 拆分路线见下表 |
| **A-11** | 错误处理无统一拦截，`catch {/* ignore */}` 与空 catch 多处；`api/` 下 14 个文件的 try/catch 是纯模板重复 | `sales.ts:15-85`（示例）`AuthContext.tsx:135,165` |
| **A-12** | 环境变量与魔法数字：`STORE_ID` 前后端各硬编码一份；localStorage key 三处硬编码；无 `.env.example` | `lib/store.ts:8` `sales.service.ts:32` `OfflineContext.tsx:162,252` |

### 巨型文件拆分建议

| 文件 | 行数 | 拆分方案 |
|---|---:|---|
| `schema.ts` | 1190 | 按域拆 `schema/{master,sales,stock,member,system}.ts` + barrel |
| `db.ts` | 1182 | `db/core.ts`（连接）· `db/entities.ts`（单据 CRUD）· `db/stock.ts`（库存事务）· `db/types.ts` |
| `master-data-cache.ts` | 793 | 拆出独立的 `promotion-engine.ts` |
| `sales.service.ts` | 662 | `createOrder`（`:113-312`，单方法 200 行）拆出 `order-no.ts` / `payment-validate.ts` / `stock-deduct.ts` / `order-mapper.ts` |
| `PosPage.tsx` | 690 | 抽 `useCart`（reducer）· `usePromotion` · `usePosShortcuts`，页面只做布局编排 |
| `OfflineContext.tsx` | 692 | 见 A-1 |

### 低危

`A-13` 死代码占比过高：`components/business-ui/**`（约 40 文件 3000+ 行，业务零引用）、`ui/` 60 个 shadcn 组件中约 40 个未使用（`sidebar.tsx` 727 行仅自引用）、`ExamplePage`、`hooks/use-example.ts`、`server/modules/hello/`（未注册进 app.module）、`pos-offline-orders.ts` 与 `pos-offline-mock.ts`（自述不参与运行）· `A-14` 零测试零 CI（仓库 `*.test.*` 数量为 0，`package.json` 无 test 脚本）· `A-15` 导航菜单未声明 `minRole`，与路由守卫不一致 · `A-16` 文件命名 kebab/Pascal 混用、导入别名 `@/`·`@client/src/`·`@shared/` 三套并存

> **代码复用率的量化参考**：支付方式映射 ×8、日期格式化 ×4、`try/catch` 模板 ×60+、`createOfflineXxx` ×7、页面 `useEffect` 加载模板 ×5。第一轮收口 `STORE_ID` 到 `lib/store.ts` 是正确范式，建议用同样思路处理这五类重复。

---

## 八、程序性能（P 类）

> 判定标准：以「SKU 数万 / 门店库存十万 / 日订单数百 / 低配安卓触屏一体机」为压力场景。

### 高危

| 编号 | 问题 | 位置 | 场景量化 | 建议 |
|---|---|---|---|---|
| **P-1** | 主数据快照全量拉取，无增量无分页 | `offline-sync.service.ts:354-376`；`master-data-cache.ts:371-426` | SKU 5万+库存10万+会员1万 → 单次快照 20-40MB；`version` 只是 `Date.now()` 无增量比对 | 改 `?since=<version>` 增量；库存按 `updatedAt` 分批 2000；会员不下发全表；接口开 gzip/br |
| **P-2** | IndexedDB 批量写库存 = 逐条 put 的单个巨型事务 | `db.ts:723-767` | 10 万条 put 在一个 `readwrite` 事务，低配安卓常见 30s-数分钟白屏，无分片无进度 | 按 1000 条切分为多个事务串行提交；首屏优先写 SKU，库存后台分片 + 进度回调 |
| **P-3** | OfflineContext value 每次渲染都失效 → 全应用高频重渲染 | `OfflineContext.tsx:597-668`（deps 含每渲染重建的函数）；`master-data-cache.ts:765-776`（返回新对象字面量） | 收银员每敲一个键都传导到 Layout/PosPage/所有消费者 | `useMemo` 化 hook 返回值；依赖改为稳定引用；`setSyncStats` 加相等判断；**按读写拆分 Context** |
| **P-4** | 网络抖动即触发全量主数据重拉 | `network.ts:109-131`（离线时 5s ping）；`master-data-cache.ts:472-475` | 一次抖动 → 在线状态翻转 → 全量 HTTP + 全量重写 IndexedDB | 在线状态做连续 2 次失败的滞后判定；主数据加 TTL（10 分钟内不重拉） |
| **P-5** | createOrder 事务内串行 N+1，长事务持锁 | `sales.service.ts:113-312` | 30 件商品 = 70+ 次串行往返，全部在一个事务里，行锁持有时间 = 整个事务；多 POS 同店并发时锁等待雪崩 | 明细改一次多值 insert；库存改 `UPDATE ... FROM (VALUES ...)` 单条语句；事务外只留 getOrderDetail |
| **P-6** | 关键表缺失索引 + 报表无时间窗全表扫 | `schema.ts:877-903`（`pos_promotion` 零索引）、`643-665`（`pos_suspended_order` 零索引）；`dashboard.service.ts:181-232,295-326` | `calculate()` 每次加购都全表扫促销；Top Styles 对 `pos_sale_item ⋈ pos_sale_order` 全历史聚合，运行一年即数百万行 → 秒级到十秒级 | 加 `index(status, priority)`、`index(store_id, status)`、`(created_at)` 复合；Top styles 强制默认近 30 天或改物化汇总表 |

### 中危

| 编号 | 问题 | 位置 |
|---|---|---|
| **P-7** | 离线同步：服务端串行逐单 + 客户端串行逐条回写 | `offline-sync.service.ts:56-62`；`sync-engine.ts:168-178,296-341` |
| **P-8** | 同步日志与离线单据表只增不减，无清理逻辑 | `db.ts:1169-1171`；`getOfflineOrders()` 直接 `getAllRecords` 全表 |
| **P-9** | `getAllItemsByStatus` 串行扫 7 张表，且排序键 `Number(clientId.split('_')[1])` 解析为 NaN → FIFO 失效 | `db.ts:1108-1124,1072-1077` |
| **P-10** | 扫码取款用线性 `find`，放弃已维护的 Map 索引 | `PosPage.tsx:239-240` vs `master-data-cache.ts:275` |
| **P-11** | POS 高频子组件无 memo，父组件每次传新引用；20色×12码每次重建 480 个闭包 | `PosPage.tsx:601,616-626`；`SkuMatrix.tsx:48,169-202` |
| **P-12** | 每次离线下单都全量重建库存 Map（十万级对象 churn + Major GC） | `master-data-cache.ts:726-763` |
| **P-13** | 每次加购触发一次促销**网络请求** + 服务端全表扫 | `PosPage.tsx:160-168`；`promotions.service.ts:87-97` |
| **P-14** | 首屏无路由懒加载，echarts 进主包（10 个页面全静态 import） | `app.tsx:8-18`；`DashboardPage.tsx:6-7`；`vite.config.ts` 无 manualChunks |
| **P-15** | 样式搜索用 `(id \|\| ' ' \|\| name) ILIKE '%kw%'` | `master-data.service.ts:70-74`；`stock.service.ts:45`；`promotions.service.ts:38` |
| **P-16** | 收货/库存调整在事务内逐条 SELECT+UPDATE | `inventory.service.ts:99-134`；`stock.service.ts:213-246` |
| **P-17** | 仪表盘 5 个接口每次切周期重查，无缓存（`@tanstack/react-query` 已是依赖却全项目未用） | `DashboardPage.tsx:60-86` |

### 低危

`P-18` `OfflineContext.tsx:209` 的 setTimeout 未跟踪未 clear · `P-19` `handleSelectStyleOffline` 依赖整个 `offline` 对象导致连带重渲染

### 大数据量下最易崩溃的三条链路

1. **启动时**：P-1 + P-2 叠加 → 低配一体机直接 ANR / 首屏超时
2. **每次网络抖动**：P-4 + P-3 叠加 → 自动全量重拉并把十万级数组重新灌进内存
3. **结算路径**：P-5 + P-7 + P-11 叠加 → 下单长事务持锁 + 同步串行 + UI 全表重渲染，**高峰期"结算秒级完成"无法保证**

---

## 九、优化建议与执行方案

### 9.1 建议采用的修复批次

> **注意：本节为建议，未执行任何改动。请确认后再动手。**

#### 批次 0 — 未落盘项与回归缺陷（0.5 天，建议立即）

| 项 | 动作 |
|---|---|
| P0-1 重新修复 | 打通 `pointsUsed` 全链路（DTO → 客户端下发 → 服务端反算 → 校验 → 扣减 → 流水） |
| P2-3 抹零打通 | 服务端补 `roundingAmount` 字段并参与 `payAmount` 计算 |
| P2-1 双击冲突 | 单击改 250ms 延时判定，或取消双击改为格子角标按钮/长按 |

#### 批次 1 — 致命级资金漏洞（3 天）

F-1 ~ F-6 全部。**F-5（班次脱钩）必须与 F-1~F-4 同批**，否则损失在财务侧不可见。

#### 批次 2 — 高危资金漏洞（3 天）

S-1 ~ S-9。

#### 批次 3 — 服务端零校验的根治（4 天）

| 项 | 动作 |
|---|---|
| A-3 DTO 化 | 引入 `ValidationPipe`，为全部写接口建 class DTO |
| A-4 服务端鉴权 | `/api/auth/login` 签发 JWT + 全局 Guard + 门店/角色级鉴权 |
| M-5 整数分 | 全链路金额改整数分，DB 统一 `numeric(14,2)` |

#### 批次 4 — 产品与体验（5 天）

U-1~U-8 高危优先（假保存、假数据、口径不一致、跨页丢单），其余按条推进。

#### 批次 5 — 性能与架构治理（8 天）

A-1/A-2/A-5/A-6 架构主干 → P-1~P-6 性能高危 → A-10 巨型文件拆分 → A-13 死代码清理 → A-14 补测试（优先覆盖 `createOrder` / `calcRefundUnitPrice` / `batchDeductLocalStock` / `calculatePromotions` 四个资金敏感函数）

### 9.2 需要你先做业务决策的三件事

| # | 决策点 | 影响 |
|---|---|---|
| 1 | **抹零的业务性质**：是"少收"（走费用科目）还是"计入折扣"？ | 决定 `roundingAmount` 落哪个会计科目，影响 Z 报口径 |
| 2 | **断码预售是否要做真**：当前只有登记 + 提示，无总仓校验无履约单 | 做真需要打通履约/Todo 单，工作量约 3-5 天 |
| 3 | **离线可售库存的安全水位**：离线允许卖到 0 还是有保留？ | 直接决定超卖率与"已收款但同步失败"的发生频率 |

### 9.3 关于首轮修复教训的建议

第一轮修复暴露出的流程问题是：**"改了前端没改后端就报完成"**。建议在修复验收环节强制加入一条检查：

> 任何涉及金额/库存/会员资产的字段，必须验证它在 **DTO 定义 → 客户端下发 → 服务端接收 → 参与计算 → 落库 → 写流水** 六个环节全部贯通，缺失任一环节不得标记完成。

本轮报告的 §2 就是按这个标准核验出来的结果——它查出了 1 项声称完成但实际未打穿的资金修复，以及 2 项未验证服务端兼容性就上线的回归缺陷。

---

## 十、总结

**这个系统目前的状态可以用一句话概括：前端做得像个成熟产品，后端停在原型阶段，两边没有形成资金闭环。**

- 客户端交互、离线能力、可视化完成度较高，继续打磨的是体验细节；
- 服务端**没有一道防线**——没有入参校验、没有服务端金额复算、没有门店/角色鉴权、没有资金流水对照。所有"防线"都在前端，而前端可以被绕过；
- 因此本轮清单里，**致命级与高危级共 25 条几乎全部集中在服务端**，且大多是小改动（补校验、改条件更新、挪到服务端算），投入产出比极高。

**如果只做一件事**：先做批次 0 + 批次 1（约 3.5 天），把"白套现"和"赔钱在财务侧不可见"这两件事堵上。这是唯一有紧迫性的部分，其余可以按节奏推进。

---

*报告完毕。以上结论均基于静态代码通读，关键资金结论已通过代码级交叉验证。是否启动修复、按哪个批次启动，请告知。*
