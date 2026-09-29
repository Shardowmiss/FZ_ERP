# 云裁智慧门店 POS —— 修复完成报告

> 依据《POS系统代码评估报告.md》，按用户确认的「**全部修**」范围执行。
> 覆盖范围：7 个 P0 + 8 个 P1 + 10 个 P2，全部完成。
> 验证结果：client 与 server 双向 `tsc --noEmit` **零错误**。

---

## 一、修复总览

| 优先级 | 数量 | 状态 | 说明 |
|---|---|---|---|
| P0（资金/数据/安全） | 7 | ✅ 全部完成 | 涉及资损、死循环、丢单、越权 |
| P1（功能正确性） | 8 | ✅ 全部完成 | 涉及数据丢失、统计造假、体验 |
| P2（体验与规范） | 10 | ✅ 全部完成 | 涉及操作效率、UI 一致性、适配 |
| 代码质量收口 | — | ✅ 完成 | 门店硬编码、横幅重复、弹窗规范 |

---

## 二、P0 修复明细（资金安全 / 数据一致性 / 安全）

| 编号 | 问题 | 修复方案 | 涉及文件 |
|---|---|---|---|
| P0-1 | 在线积分支付不扣会员积分 | 从 payments 识别 `points` 抵扣额，换算积分并扣减；校验改为「非积分实付 + 找零」与应付比对 | `server/modules/sales/sales.service.ts` |
| P0-2 | 促销计算触发 setState 死循环 | 用 `useRef` 记录购物车签名（skuId:qty），签名不变则跳过计算 | `PosPage.tsx` |
| P0-3 | 离线写库失败导致库存永久泄漏 | catch 中调用 `batchAddLocalStock()` 回滚本地库存 | `OfflineContext.tsx`、`db.ts` |
| P0-4 | 在线取单未销挂，可重复结算 | 取单时调用 `activateSuspendedOrder`，失败则禁止恢复 | `PosDialogs.tsx` |
| P0-5 | 全系统无登录鉴权 | 新增登录页 + 会话 + 角色守卫（收银员/店长/督导）；`DEMO_CASHIER_ID` 改为登录态取；操作日志留痕 | 新增 `AuthContext.tsx`、`LoginPage.tsx`、`RequireAuth.tsx`、`operation-log.ts`；改 `app.tsx`、`Layout.tsx`、`ShiftPage.tsx` |
| P0-6 | 离线促销永不生效（字段不匹配） | 快照落地时用 `normalizePromotion()` 转换字段；离线结算接线本地促销引擎并按行摊分 | `master-data-cache.ts`、`PosPage.tsx` |
| P0-7 | 储值/积分无余额校验，可超额扣 | 新增余额校验，超额时禁用确认并提示 | `PaymentDialog.tsx` |

---

## 三、P1 修复明细

| 编号 | 问题 | 修复方案 | 涉及文件 |
|---|---|---|---|
| P1-1 | 订单号「查最大+1」并发重号 | 改为 `XS + 日期时间 + 2位随机`，无需查库 | `sales.service.ts` |
| P1-2 | 离线退货记录刷新即丢 | 改为从 IndexedDB 读取（`getOfflineReturnList`） | `ReturnPage.tsx`、`OfflineContext.tsx`、`db.ts` |
| P1-3 | 退货按原价退款导致多退钱 | 按行实付金额 / 整单折扣率分摊优惠后再退款 | `ReturnPage.tsx` |
| P1-4 | 同步失败重试耗尽后静默丢单 | 超重试次数转「死信」→ 待处理工作台，支持人工重提 | `sync-engine.ts`、`db.ts`、`OfflineQueuePanel.tsx` |
| P1-5 | 同步统计为 100ms 轮询 mock | 改为订阅 sync-engine 真实事件 | `OfflineContext.tsx` |
| P1-6 | 扫码后仅展示不能加购 | 识别扫码枪特征，命中条码直接加购 1 件 | `PosSidebar.tsx`、`PosPage.tsx` |
| P1-7 | 小票/Z报打印按钮为占位 | 实现 80mm 热敏小票打印；Z报支持打印与 CSV 导出 | 新增 `pos-receipt-print.ts`、`print.ts`；改 `ReceiptDialog.tsx`、`ShiftPage.tsx` |
| P1-8 | Z报支付方式键不匹配（`stored`/`card`） | 对齐为 `stored_value` / `bank_card`，补 `points` | `ShiftPage.tsx`、`OfflineQueuePanel.tsx` |

---

## 四、P2 修复明细

| 编号 | 问题 | 修复方案 |
|---|---|---|
| P2-1 | 加购需两步 | 矩阵单击直接加购 1 件，双击开数量弹窗（`SkuMatrix.tsx`） |
| P2-2 | 无键盘快捷键 | F2 会员 / F3 挂单 / F4 结算 / Esc 清空，并在页面给出提示条（`PosPage.tsx`） |
| P2-3 | 无抹零 | 支付弹窗支持抹零/取消抹零，从最大金额支付方式扣减（`PaymentDialog.tsx`） |
| P2-4 | 断码无法预售 | 无库存色码可「登记预售单」并提示到货时效（`SkuMatrix.tsx`） |
| P2-5 | 收银台一直显示「待开单」 | 开单即生成真实格式单号（`PosPage.tsx`） |
| P2-6 | 触屏热区过小 | 粗指针设备下按钮最小 40px、表格内按钮 32px（`index.css`） |
| P2-7 | 找零计算错误（非现金也算找零） | 仅现金超额计算找零（`PaymentDialog.tsx`） |
| P2-8 | 交接班 Fragment 缺 key、备用金默认 500 | 改 `Fragment key`；备用金默认置空（`ShiftPage.tsx`） |
| P2-9 | 两套 OfflineBanner 各写一遍 | 收敛为唯一实现，页面版改为适配器（`OfflineBanner.tsx`、`ui/offline-banner.tsx`） |
| P2-10 | 弹窗底栏样式不统一 | 统一 `DialogFooter`：移动端反序、桌面端右对齐居中（`dialog.tsx`） |

---

## 五、代码质量收口

| 项目 | 处理 |
|---|---|
| 门店硬编码散落 10+ 处 | 收敛到 `client/src/lib/store.ts`（`STORE_ID` / `STORE_NAME` 唯一来源），全部引用改为导入 |
| 支付方式键混乱 | 全系统统一为 `cash / wechat / alipay / bank_card / stored_value / points` |
| 打印/导出重复逻辑 | 抽 `lib/print.ts`（`printHtmlDocument` + `downloadTextFile`） |

---

## 六、新增文件清单

| 文件 | 作用 |
|---|---|
| `client/src/lib/store.ts` | 门店常量唯一来源 |
| `client/src/contexts/AuthContext.tsx` | 登录态、角色、会话持久化、操作日志 |
| `client/src/pages/LoginPage/LoginPage.tsx` | 登录页（工号 + PIN，含演示快捷登录） |
| `client/src/components/RequireAuth.tsx` | 路由守卫（未登录跳登录页，角色不足跳 /pos） |
| `client/src/lib/operation-log.ts` | 操作留痕（优先上报服务端，离线降级本地队列） |
| `client/src/lib/print.ts` | 通用打印（隐藏 iframe）与 CSV 下载 |
| `client/src/pages/PosPage/pos-receipt-print.ts` | 80mm 热敏小票 HTML 生成与打印 |

---

## 七、验证结果

```bash
# 客户端类型检查
./node_modules/.bin/tsc --noEmit --project tsconfig.app.json   # 零错误

# 服务端类型检查
./node_modules/.bin/tsc --noEmit --project tsconfig.node.json   # 零错误
```

> 说明：`vite build` 未能执行，原因是 rolldown 缺少 darwin-arm64 原生二进制（依赖安装环境问题，非代码问题）。

---

## 八、重要说明与后续建议

1. **P0-5 鉴权为客户端门禁（演示级）**：本项目服务端基于 `@lark-apaas` 私有框架、且无本地可安装依赖，因此登录校验在客户端用内置演示名册 + PIN 完成，会话存 localStorage。**生产环境必须**改为服务端 `/api/auth/login` 校验密码并签发 JWT，再用全局守卫校验，否则前端校验可被绕过。
2. **断码预售（P2-4）**目前仅做「登记 + 提示」，未打通总仓可用量校验与履约单生成，需补充后段流程。
3. 建议补充：离线单据的人工改单界面（当前仅支持「重提」）、会员密码/手机号二次验证、以及针对 P0-1 积分与 P1-3 退款分摊的单元测试。
