/**
 * 金额工具（P2-7 取整 + 整数分迁移）。
 *
 * ## 单位约定（整数分迁移 P2-7 进阶）
 * - 对外（DTO / 前端）一律用「元」(number，可含小数)，保持历史契约不变。
 * - 对内（数据库列 / 领域计算）一律用「分」(整数)，避免任何小数运算，
 *   从根本上消除浮点长尾与 decimal 精度问题。
 * - 仅在读写边界做转换：`toCents(元)` 入库、`fromCents(分)` 出参。
 *
 * 所有以「元」为单位的货币汇总在落库前都应经过 `round2`，
 * 以消除浮点长尾（如 0.1 + 0.2 = 0.30000000000000004）导致的对账不平。
 *
 * 此前各 service 各自内联 `Math.round(x * 100) / 100` 或 `toFixed`，
 * 口径不一致且易遗漏（交接班/日结/EOD 明细等聚合金额未取整即落库）。
 * 统一收口到此文件，后续新增金额计算一律引用此处。
 */

/** 元 → 分（四舍五入，返回整数）。非有限数按 0 处理。
 *  入参放宽到 number | string：DTO/查询结果常带 string|number 联合类型，
 *  内部统一 Number() 强转，避免每个调用点再包 Number()。 */
export const toCents = (yuan: number | string): number =>
  Math.round((Number(yuan) || 0) * 100);

/** 分 → 元（保留两位小数的数值）。非有限数按 0 处理。入参同 toCents。 */
export const fromCents = (cents: number | string): number =>
  Math.round((Number(cents) || 0) * 100) / 100;

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

