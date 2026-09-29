# 云裁智慧门店 POS 系统代码评估报告

> 评估范围：`client/src`（10 个业务页面 + 离线引擎 db/sync-engine/master-data-cache）、`server/modules`（15 个模块）、`server/database/schema.ts`（37 张表）
> 技术栈：React 19 + Vite + Tailwind 4 / NestJS 10 + Drizzle + PostgreSQL
> 评估维度：产品功能完整性、资金安全、离线链路、UI/UX、操作难易、代码质量

---

## 一、总体结论

系统整体架构思路清晰（款-色-码三维模型、离线优先设计、IndexedDB 同步队列），UI 视觉规范统一（品牌橙红 + 墨蓝，与 ERP 一致）。**但目前是一套"演示可跑、上生产会出事"的系统**：

- 有 **7 个 P0 级问题**（资损、数据错误、死循环、无鉴权）
- 有 **8 个 P1 级问题**（功能闭环缺失、同步失败丢单）
- 有 **10+ 个 P2 级体验问题**（收银效率、触屏适配、死按钮）

---

## 二、P0 问题（必须修复，涉及资损/数据正确性）

| # | 问题 | 位置 | 现状 | 修复建议 |
|---|------|------|------|---------|
| P0-1 | **在线积分支付不扣积分** | `PaymentDialog.tsx` + `sales.service.ts` | 前端把"积分抵扣"当支付方式传 `amount`（元），服务端只写入 payment 明细；`dto.pointsUsed` 前端从未传 → `member.points` 不扣减。顾客用积分买单但积分永远不减，且实际现金少收 | 服务端从 payments 中识别 `points` 方式并换算 `pointsUsed = amount×100` 参与校验与扣减；或前端单独传 `pointsUsed` 字段 |
| P0-2 | **促销计算死循环** | `PosPage.tsx` L100-172 | useEffect 依赖 `[cart]`，`calcPromotion` 回填行级折扣时 `setCart` → cart 变化 → 再次触发 → 每 300ms 调一次促销接口，只要有促销活动命中就无限请求 | 将"促销折扣回填"与"购物车"状态分离（折扣字段用单独 state 或 ref），或回填时用 `useRef` 标记跳过下一次 effect |
| P0-3 | **离线库存扣减失败无回滚** | `OfflineContext.tsx` `createOfflineOrder` | 先 `batchDeductLocalStock` 扣本地库存，再写订单；写单失败时注释写"尽力回滚"但**没有任何回滚代码** → 本地库存永久泄漏，后续离线单会误报"库存不足" | 写单失败时在同一事务语义下调用 `batchAddLocalStock` 回滚；或将扣减+写单放进同一个 IndexedDB transaction |
| P0-4 | **在线取单不销挂** | `PosDialogs.tsx` `handleRestore` + `PosPage.tsx` `handleRestoreSuspended` | 离线取单会删本地记录；在线取单既不调用 `activateSuspended` 也不删除服务端挂单 → 同一挂单可被反复取出、反复结算，重复收款 | 在线分支调用 `salesApi.activateSuspended(id)`（API 已存在但无人调用），取单失败则禁止恢复 |
| P0-5 | **全系统无登录/鉴权/权限** | 所有 controller（无任何 Guard）、`app.tsx`、`ShiftPage.tsx` | 无登录页、无 token、无角色权限；收银/退货/日结/设置全部裸奔；收银员写死 `DEMO_CASHIER_ID='emp_001'` | 增加 JWT 登录 + 角色守卫（收银员/店长/督导）；操作日志落 `pos_operation_log`（表已建未用）；导购/收银员从登录态取而非硬编码 |
| P0-6 | **离线促销永远不会生效（字段不匹配）** | `offline-sync.service.ts getMasterData` vs `master-data-cache.ts` | 服务端快照返回 `startDate/endDate`（ISO 字符串），本地 `PromotionLite` 期望 `startAt/endAt`（number 毫秒）→ `now >= p.startAt` 恒 false；且 `PosPage` 离线时直接 `setDiscounts([])`，本地 `calculatePromotions` 引擎根本没接线 | 统一字段映射（快照转换时换算时间戳）；PosPage 离线分支改调 `offline.calculatePromotions()` |
| P0-7 | **储值/积分支付前端无余额校验** | `PaymentDialog.tsx` | 输入金额可超过会员储值余额/可用积分，无任何提示。在线模式服务端会拒单（还好）；离线模式当场收了钱、同步时才失败 → 丢单且无法向顾客追偿 | PaymentDialog 实时校验 `amount ≤ member.storedValue` / `amount×100 ≤ member.points`，超限禁用确认按钮；离线储值支付也应在本地余额校验 |

---

## 三、P1 问题（重要功能闭环缺失）

| # | 问题 | 位置 | 修复建议 |
|---|------|------|---------|
| P1-1 | **订单号并发冲突**：`generateOrderNo` 用"查最大号+1"，无锁；并发下单触发 unique 冲突直接报错 | `sales.service.ts` L42-65 | 改用 PG 序列或 `INSERT ... ON CONFLICT DO NOTHING` 重试；或按门店+日期建计数表行锁自增 |
| P1-2 | **离线退货记录刷新即丢**：`loadRecords` 离线分支只读内存 state，不读 IndexedDB | `ReturnPage.tsx` L132-146 | 离线分支改从 `offline.getOfflineReturnList()` 读取 |
| P1-3 | **退货金额不摊优惠**：按 `unitPrice`（行折后价）退，整单级优惠（满减）不参与分摊，多退钱 | `ReturnPage.tsx` L151,177 | 按行金额占整单比例分摊整单优惠后计算退款额 |
| P1-4 | **离线单同步失败 = 丢单**：同步时按新单重新校库存，失败重试 5 次后进入"死信"，无人工处理界面；钱已收、单没了 | `sync-engine.ts` + `OfflineQueuePanel.tsx` | 冲突/超限单进入"待处理"工作台：展示失败原因、支持改单重提/作废登记；服务端对同步单放宽为"负库存预警"而非硬拒 |
| P1-5 | **同步统计是假的**：`OfflineContext` 用 100ms 轮询 mock 进度，完成事件 `succeeded` 恒为 0，`syncStats` 不可信 | `OfflineContext.tsx` L186-243 | sync-engine 已有真实事件（`on('sync-complete')`），直接订阅，删掉轮询 mock |
| P1-6 | **扫码体验断裂**：条码判定靠 `length>10 && /^[A-Za-z0-9]+$/` 猜测；扫码后只打开 SKU 矩阵，还需再点格子加购 | `PosSidebar.tsx` L67-85 | 扫码枪识别用"快速连续输入+回车"特征判断；条码命中 SKU 直接加购 1 件并清空输入框，仅歧义时弹选择 |
| P1-7 | **小票无打印功能**：`ReceiptDialog` 无 `window.print`、无打印样式、无小票机 ESC/POS 对接；Z 报"导出/打印"也是死按钮 | `ReceiptDialog.tsx`、`ShiftPage.tsx` L341-346 | 至少实现浏览器打印（58/80mm 热敏布局 @media print）；按钮接入真实行为或先隐藏 |
| P1-8 | **Z 报支付方式映射错位**：`PAY_METHODS` key 为 `stored`，实际写入为 `stored_value`，且缺 `points` → 显示原始 code | `ShiftPage.tsx` L22-28 | key 对齐 `stored_value`，补 `points` 映射 |

---

## 四、P2 问题（体验与 UI 设计）

### 4.1 收银操作效率（POS 核心场景）

| # | 问题 | 建议 |
|---|------|------|
| P2-1 | 加购 1 个 SKU 要 3 次点击：点格 → 弹窗 → 确认 | 单击格子默认加 1 件（微交互提示"已加入"），需要多件时长按或弹窗；弹窗内支持数量直接键入 |
| P2-2 | 全站无键盘快捷键：收银高频操作（识别会员、挂单、取单、结算、清空、聚焦扫码框）全靠鼠标 | 定义快捷键体系（如 F2 会员 / F3 挂单 / F4 取单 / F8 结算 / ESC 关闭弹窗），扫码框失焦自动回归 |
| P2-3 | 购物车数量只能 +/-，不能直接输入；无行内改价、整单折扣、抹零（服装零售刚需） | 数量支持输入；增加"改价/折让"（需权限）与"抹零"按钮，操作留痕 |
| P2-4 | 断码预售是空壳：0 库存格点击显示"可预售 3-5 日到货"文案，但**没有创建预售单的入口**（`pos_preorder` 表已建、无 API、无页面） | 补预售单创建流程，或先隐藏该文案避免误导店员 |
| P2-5 | 收银台头部单号 `XS+日期+随机4位` 纯摆设，与真实单号无关 | 显示"待开单/离线单号"，成交后再回填真实单号 |

### 4.2 UI 设计

| # | 问题 | 建议 |
|---|------|------|
| P2-6 | 三栏固定宽度（280px + 自适应 + 360px），无触屏/平板适配；按钮普遍偏小（数量步进仅 24px 高） | 收银页增加触屏断点：步进按钮 ≥ 44px、结算键 ≥ 56px；考虑一体贴合 1366×768 收银一体机 |
| P2-7 | 找零逻辑不严谨：任何方式多付都算成"现金找零"（如微信多付也显示现金找零） | 找零仅在含现金支付时计算，且仅按现金超额部分 |
| P2-8 | 交接班历史表格 `<>` fragment 缺 key → React 控制台告警；开班备用金默认预填 500 易误开班 | 补 key；备用金默认为空 |
| P2-9 | 离线提示散落各处（图标/角标/横幅样式不一），且"离线模拟开关"混在生产 UI 里 | 统一 `OfflineBanner` 组件规范；模拟开关移入设置页并加"演示专用"标识 |
| P2-10 | 视觉整体统一良好（品牌色、圆角、tabular-nums 落实到位），但弹窗标题层级/按钮主次在 PaymentDialog 与其他弹窗间略有出入；金额大数字与标签对比度可再强化 | 按 AGENTS.md 视范抽一套 DialogFooter 规范组件 |

### 4.3 代码质量（顺带）

- `STORE_ID`/`STORE_NAME` 在 8+ 个文件重复硬编码 → 收敛到全局配置/Context。
- `OfflineContext` 中 10 个 `createOfflineXxx` 几乎完全重复 → 抽通用 `createPendingEntity(type, data)`。
- `sales.service.ts` 挂单三处重复的 items 映射 → 抽私有方法。
- `pos_operation_log`、`pos_preorder`、`pos_coupon`（发券弹窗已有 UI）等表已建但无 API，属"半成品"。

---

## 五、建议修复顺序（供确认）

| 批次 | 内容 | 理由 |
|------|------|------|
| 第 1 批 | P0-1 积分、P0-2 死循环、P0-3 回滚、P0-4 销挂、P0-6 离线促销、P0-7 余额校验 | 纯前端+服务端逻辑修复，不动架构，消除资损与数据错误 |
| 第 2 批 | P0-5 登录鉴权 + P1-1 单号并发 | 涉及登录体系，工作量中等，上生产前置条件 |
| 第 3 批 | P1-2/3/4/5/6/7/8 + P2-1/2/3 | 收银效率与功能闭环，体验提升最明显 |
| 第 4 批 | 其余 P2 + 代码重构收敛 | 打磨项 |

---

*报告生成于 2026-09-17，基于静态代码审阅（未连接数据库实测）。*
