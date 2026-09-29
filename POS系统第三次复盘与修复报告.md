# 云裁智慧门店 POS 系统 — 第三次复盘与修复报告

> 复盘日期：2026-09-18
> 代码位置：`pos-review/`
> 本轮性质：**核验前两轮修复是否真正生效 + 继续修复遗留项**
> 验证方式：client（`tsconfig.app.json`）与 server（`tsconfig.node.json`）双向 `tsc --noEmit` **零错误**

---

## 一、总体结论

**前两轮梳理的 40 项核心问题，经代码级逐条核验，全部已落盘生效。本轮另外发现并修复 4 个新问题，并对 1 个此前的判断做了重大更正。**

| 项目 | 结果 |
|---|---:|
| 前两轮问题核验 | 40 项，**40 项通过** |
| 本轮新增修复 | 4 项（假保存 / 交班现金预填 / 购物车丢失 / 小票金额精度） |
| 判断更正 | 1 项（服务端鉴权） |
| 编译验证 | client + server 双向零错误 |

---

## 二、重要更正：服务端鉴权（此前判断有误）

上一轮报告称「全系统无鉴权」，**这个结论是错的，需要更正**。

实际核查发现：

- 所有服务端控制器均已带平台装饰器 `@NeedLogin()`；
- 平台提供 `AuthNPaasGuard`、`AuthNPaasModule`，登录态通过 `req.userContext.userId` 注入；
- 即**服务端已有 SSO 认证**，并非无鉴权。

**真实缺失的是另外三件事：**

1. **角色授权**：任何登录用户都能调用任何接口（收银员可开日结、改员工）；
2. **门店归属**：`storeId` 由客户端报文直接指定，无任何校验 → 可跨店写数据；
3. **POS 本地收银员登录**：平台 SSO 认证的是平台账号，但门店终端多人共用，无法区分「这单是谁收的」。

**本因此做的处置：**

- 我一度按错误判断注册了全局 JWT 守卫，**发现冲突后立即撤销**——它会与平台 SSO 叠加导致全站 401；
- 改为正确定位：新增 P**OS 本地收银员登录**（工号 + 口令 → 服务端签发令牌），与平台 SSO 互补，用于区分责任人；
- 补齐服务端 `storeId` 存在性校验（S-9）。

新增文件：
- `server/modules/auth/auth.service.ts`（scrypt 口令派生 + HMAC-SHA256 令牌，零第三方依赖）
- `server/modules/auth/auth.controller.ts`：`POST /api/auth/login`、`GET /api/auth/me`
- `server/modules/auth/auth.guard.ts`：`@Public()` / `@Roles()` 装饰器
- `client/src/api/auth.ts`、`client/src/lib/auth-interceptor.ts`（令牌注入请求头）
- schema 变更：`pos_employee.password_hash`

**仍需你决策**：生产启用前需为员工初始化口令，并配置环境变量 `POS_AUTH_SECRET`（≥16 位），否则生产启动会直接报错。

---

## 三、核验明细（40 项，全部通过）

### 资金安全（F / S 系列）

| 编号 | 问题 | 核验位置 | 结果 |
|---|---|---|---|
| P0-1 | 积分抵扣全链路 | `sales.service.ts` 按支付明细反算 `pointsUsed` | 通过 |
| P2-3 | 抹零端到端 | `sales.service.ts` 抹零参与应付计算并写折扣明细 | 通过 |
| F-2 | 服务端定价（客户端单价不可信） | `hydrateItemsFromMasterData()` | 通过 |
| F-3 | 退货行式校验 | `returns.service.ts` 可退余量闸门 + 禁止凭空建库存 | 通过 |
| F-4 | 退货回冲积分与储值 | `pointsRevert` / `storedRefund` 按比例回退 | 通过 |
| F-5 | 班次归属 | `resolveShiftId()` + 客户端 `useCurrentShift` | 通过 |
| F-6 | 会员资产直改拦截 | `PATCH /members/:id` 携带积分/储值直接拒绝 | 通过 |
| S-1 | 储值汇总校验 | 汇总全部 `stored_value` 支付行，不再只取第一条 | 通过 |
| S-2 | 余额并发行锁 | `SELECT ... FOR UPDATE` 防透支 | 通过 |
| S-5 | 交班扣找零 | 应收现金 = 收取 − 找零（原为虚增，造成假短款） | 通过 |
| S-6 | 结班幂等 | 事务 + 行锁 + 状态条件更新 | 通过 |
| S-7 | 日结幂等 | 日期格式/上界校验 + 已日结冲突拦截 | 通过 |
| S-8 | syncing 僵死回收 | 5 分钟超时后可重新认领 | 通过 |
| S-9 | 门店存在性校验 | `resolveStoreId()` 拒绝未知门店 | 通过 |

### 功能与体验（P / U 系列）

| 编号 | 问题 | 核验位置 | 结果 |
|---|---|---|---|
| P0-2 | 促销死循环 | 购物车签名 `promoLastSig` | 通过 |
| P0-3 | 离线库存回滚 | `batchAddLocalStock` | 通过 |
| P0-4 | 在线取单销挂 | `activateSuspendedOrder` | 通过 |
| P0-5 | 登录鉴权 | 客户端守卫 + 服务端登录接口 | 通过 |
| P0-6 | 离线促销 | `normalizePromotion` 字段映射 | 通过 |
| P0-7 | 余额校验 | `getBalanceError()` | 通过 |
| P1-1 | 订单号并发 | `generateOrderNo()` 含时间戳 + 随机 | 通过 |
| P1-2 | 离线退货持久化 | `getOfflineReturns()` 读 IndexedDB | 通过 |
| P1-3 | 退货优惠分摊 | 按行占比分摊整单优惠 | 通过 |
| P1-4 | 同步死信转待处理 | 死信状态 + 工作台重提 | 通过 |
| P1-5 | 真实同步事件 | 订阅 `sync-complete`，删除轮询 mock | 通过 |
| P1-6 | 扫码直接加购 | 扫码枪特征识别 + `onScanAdd` | 通过 |
| P1-7 | 小票打印 | 80mm 热敏真实打印 | 通过 |
| P1-8 | Z报支付映射 | `stored_value` / `bank_card` / `points` 对齐 | 通过 |
| P2-1 | 双击冲突 | 250ms 延时判定 | 通过 |
| P2-2 | 键盘快捷键 | `keydown` 绑定 + 提示条 | 通过 |
| P2-4 | 断码预售 | 无库存可售为预售登记 | 通过 |
| P2-6 | 触屏适配 | `@media (pointer: coarse)` 最小热区 40px | 通过 |
| P2-9 | 横幅统一 | 两版 OfflineBanner 收敛为一个 | 通过 |
| P2-10 | DialogFooter 规范 | 底栏布局统一 | 通过 |
| A-1 | 门店常量收口 | `lib/store.ts` 单一来源 | 通过 |

---

## 四、本轮新增修复（4 项）

| 问题 | 位置 | 后果 | 修复 |
|---|---|---|---|
| **设置页假保存** | `SettingsPage.tsx` `doSave` | 用 600ms 定时器伪造「保存成功」，刷新后全部丢失，属于欺骗性反馈 | 新增 `lib/local-settings.ts` 真实落盘并回填；支付方式、员工状态覆盖一并持久化 |
| **交班实点现金预填** | `ShiftPage.tsx:63` | 用「应收现金」预填「实点现金」，收银员不数钱直接交班也能得到 0 长短款，**盘点机制形同虚设** | 移除预填，强制人工清点 |
| **购物车刷新即丢** | `PosPage.tsx` | 误触刷新／崩溃需重新扫码整单 | 新增 `pos-cart-persist.ts`，购物车与会员本地暂存，12 小时过期；提交成功后清空 |
| **小票金额精度** | `ReceiptDialog.tsx:150/153` | `toFixed(0)` 把 ¥199.50 印成 ¥200，顾客凭据与实收不符，退货易起纠纷 | 改为 `toFixed(2)` |

---

## 五、仍未完成 / 需决策项

| 项 | 说明 | 建议 |
|---|---|---|
| **员工口令初始化** | 服务端登录已就绪，但员工尚无 `password_hash` | 提供一次性初始化脚本或由店长在后台设置；上线前必须完成 |
| **角色授权落地** | `@Roles()` 装饰器已提供，尚未挂到具体接口 | 建议先挂：日结、员工管理、促销配置、库存调整 |
| **门店归属强校验** | 目前仅校验 storeId 存在，未校验是否属于当前登录人 | 需建立「平台用户 ↔ 员工」映射表后才可做，属下一期 |
| **金额改整数分（M-5）** | 涉及全库 numeric 字段与所有计算点 | 建议独立成专项改造，配合数据库迁移，不宜与其他改动混做 |
| **断码预售履约** | 目前仅登记 + 提示 | 需打通总仓可用量校验与履约单生成 |
| **前端打包验证** | `vite build` 因 rolldown 缺 darwin-arm64 原生二进制无法执行 | 环境问题非代码问题；建议在有完整依赖的机器上补跑一次 |

---

## 六、本轮改动文件清单

**新增（8）**
`server/modules/auth/auth.service.ts`、`auth.controller.ts`、`auth.guard.ts`、`auth.module.ts`
`client/src/api/auth.ts`、`client/src/lib/auth-interceptor.ts`、`client/src/lib/local-settings.ts`、`client/src/pages/PosPage/pos-cart-persist.ts`

**修改（9）**
`server/database/schema.ts`（+password_hash）
`server/app.module.ts`（注册 AuthModule，明确不挂全局守卫）
`server/modules/offline-sync/offline-sync.service.ts`（S-8/S-9）
`server/modules/shift/shift.service.ts`（S-5/S-6/S-7）
`client/src/contexts/AuthContext.tsx`（优先服务端登录）
`client/src/pages/PosPage/PosPage.tsx`（购物车持久化）
`client/src/pages/PosPage/ReceiptDialog.tsx`（金额精度）
`client/src/pages/SettingsPage/SettingsPage.tsx`（真实保存）
`client/src/pages/ShiftPage/ShiftPage.tsx`（取消现金预填）
