/**
 * 统一金额/数量精度工具
 *
 * 问题背景：
 * 1) 旧实现 `(Math.round(n * 100) / 100).toFixed(2)` 受二进制浮点误差影响，
 *    例如 `round2(1.005)` 因 `1.005 * 100 = 100.49999999999999` 被 Math.round 成 100，
 *    得到 `"1.00"`（应为 `"1.01"`），造成金额累计偏差。
 * 2) 各 service 内重复定义 round2/round3，且返回类型不一致（string / number），
 *    当返回 string 时 `round2(a) + round2(b)` 会变成字符串拼接，引发严重计算错误。
 *
 * 约定：本项目 Drizzle 多数数值列（金额/数量）在 schema 中定义为 string（varchar），
 * 故 round 系列统一返回 string 以兼容 insert/.set 赋值；需要数值参与运算时，
 * 调用方应使用 `Number(round2(x))` 或直接使用内部 number 工具 `roundMoneyNum`。
 */

/** 半进位四舍五入到指定小数位（修正浮点误差），返回 number */
export function roundMoneyNum(n: number, decimals = 2): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const factor = 10 ** decimals;
  // 1e-9 级别的修正量抵消二进制浮点表示误差（业务金额量级 < 1e9 时安全）
  const corrected = Math.abs(n) * factor + 1e-9;
  return (sign * Math.round(corrected)) / factor;
}

/** 金额：2 位小数（返回 string，兼容 Drizzle varchar 列） */
export function round2(n: number): string {
  return roundMoneyNum(n, 2).toFixed(2);
}

/** 数量：3 位小数（返回 string） */
export function round3(n: number): string {
  return roundMoneyNum(n, 3).toFixed(3);
}

/** 单价：4 位小数（返回 string） */
export function round4(n: number): string {
  return roundMoneyNum(n, 4).toFixed(4);
}
