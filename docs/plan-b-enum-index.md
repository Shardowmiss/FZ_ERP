# B 部分（P1 枚举约束 + 索引 schema 化）迁移设计方案

> 结论先行：A 部分（N+1 第二批 F1/F2）已闭环，黑盒回归 **18/0 全绿**。
> B 部分为高风险 schema 约束改动，先出设计方案，执行前需确认。已完成现状侦察 + dev 库数据兼容性探针。

---

## 一、现状侦察结果

### 1.1 枚举列清单
- 共 **82 个候选枚举列**，分布在 **64 张表**。
- 列族分布：`status` ×58、`type` ×5、`flowType` ×2、`itemType` ×3、`submitterType` ×2、`bizType` ×3、`docType` ×2、`source` ×1、`direction` ×1、`level` ×2、`gender` ×1、`category` ×2。

### 1.2 dev 库实际取值（数据兼容性探针，决定 CHECK 是否可安全落地）
- 所有实际取值均落在「代码已知值 ∪ 实测值」范围内，**无脏数据越界**；但发现 1 处代码未覆盖值：
  - `trade_show.status` 实测含 `ongoing`（代码 grep 未捕获）→ 白名单必须补 `ongoing`。
- 关键枚举族实测值（括号内为代码候选并集，CHECK 取并集以保证安全）：
  - `inventory_flow.flow_type`：`garment_purchase_inbound, retail_outbound, sales_outbound, transfer_in_transit, transfer_out`（代码共 21 个）
  - `inventory_flow.direction`：`in, out`
  - `item_type`（3 表）：`sku`（代码另含 `material`）
  - `submitter_type`：`dealer, direct`（allocation_item）；`dealer`（pre_order）
  - `biz_type`：`garment_purchase_inbound / sales_outbound / pos_checkout`（代码另含 2 个）
  - `doc_type`：空（代码 `retail, sales, transfer`）
  - `warehouse.type`：`dealer, finished, main, self, store`
  - `retail_order.source`：`pos`（代码另含 `store_pos, outbound`）

### 1.3 索引现状（#182）
- 唯一索引：已在 `schema.ts` 经 `uniqueIndex(...)` 声明（约 30+ 个）。
- 非唯一 `idx_*` 性能索引：约 **60 个**仅存在于手写迁移 SQL（0001~0012），`schema.ts` 未声明 → 索引定义「分裂」在迁移里，schema 非单一事实源。

---

## 二、#181 枚举约束 — 方案对比

| 方案 | 说明 | 优点 | 风险 / 缺点 |
|---|---|---|---|
| **A. 逐表 CHECK 精确白名单** | 每列按其合法值集合加 `CHECK (col IN (...))` | 最强约束、可防非法状态 | 工作量大（82 列需 curate）；需与代码/数据双核对 |
| **B. status 共享联合白名单** | 所有 `status` 列统一 `CHECK (status IN (29 值))` | 工作量小、可挡垃圾值/注入 | 宽松（允许某表出现不该有的状态） |
| **C. Postgres ENUM 类型** | 建 `erp_status` 等枚举类型替换 varchar | 类型级约束 | 改列类型需重写数据；加值需 `ALTER TYPE ADD VALUE`；与现有 varchar/ORM 不兼容，回滚难 |
| **D. 仅文档** | 不落地 | 零风险 | 无运行时保护 |

**推荐：A（精确）用于枚举族 + B（安全网）用于 status** —— 即 Tier1 精确 + Tier2 安全网。

---

## 三、落地路线图（分阶段、可回滚、幂等）

### Phase 1（推荐本轮执行）
- **Tier1 精确 CHECK（约 18 列）**：`flowType`、`direction`、`itemType`、`submitterType`、`bizType`、`docType`、`type`、`source` —— 每列按「代码候选值 ∪ 实测值」精确白名单。
- **Tier2 status 安全网**：58 个 `status` 列统一 `CHECK (status IN (29 值，含 ongoing))`（宽松但挡垃圾/注入）。
- **迁移文件**：`migrations/0013_enum_constraints.sql`（幂等：PG 不支持 `ADD CONSTRAINT IF NOT EXISTS`，需用 `DO $$` 判存在性后添加，避免重复执行报错）。
- **数据兼容性**：探针已确认现状数据全部合规，可安全 `ALTER`。

### Phase 2（后续，可选）
- 对核心事务表（`sales_order` / `purchase_order` / `payable` / `receivable` / `inventory_transfer` / `allocation_order` 等）将 `status` 收紧为逐表精确白名单，强化状态机完整性。

### 跳过（不建议硬约束）
- `category`（自由业务分类：上衣/外套/裤装…）、`customer.level`、`gender` 等自由/低危列 → 仅文档化。

---

## 四、#182 索引 schema 化 — 方案
- 将 60 个 `idx_*` 索引从迁移 SQL「镜像」声明进 `schema.ts` 的 `index("idx_...").on(...)`，使 `schema.ts` 成为单一事实源。
- 迁移 SQL 保持为「执行机制」（已幂等 `IF NOT EXISTS`），`schema.ts` 为「声明/文档源」。
- 风险：若后续跑 `drizzle-kit push` 可能出现 schema↔迁移漂移；本方案不触发 push，仅收敛声明。
- 需逐个核对索引名 / 列 / 顺序与迁移一致，避免重复或漂移。

---

## 五、待确认决策（见对话提问）
1. **枚举落地方式**：A 精确 / B 安全网 / C ENUM / D 文档
2. **本轮范围**：Phase1 全做（Tier1+Tier2）/ 仅 Tier1 枚举族 / 全量逐表精确
3. **是否在 dev 库执行 DDL**：已验证数据合规，可执行并落地迁移文件 / 仅产出迁移 SQL 不执行
