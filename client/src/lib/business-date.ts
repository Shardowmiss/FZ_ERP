/**
 * 门店**本地**业务日期（YYYY-MM-DD）。
 *
 * 为什么不能用 `new Date().toISOString().slice(0, 10)`：
 * toISOString 返回的是 UTC，而门店在东八区。北京时间 00:00~08:00 之间，
 * UTC 还是"前一天"，取出来的业务日期就会**整整差一天**——
 * 晚上 16:00 之后下单也会被记成次日。这类"差一天"的日期错误在报表里
 * 表现为"跨日单莫名落在错误的营业日"，且极难从数据本身察觉。
 *
 * 业务日期是**日历概念**（哪一天卖的），不是时间点，因此必须用本地日历日算。
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** 取 Date 的本地日历日 YYYY-MM-DD。 */
export function toLocalBusinessDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 门店当前营业日（离线开单时打戳用）。 */
export function todayBusinessDate(): string {
  return toLocalBusinessDate();
}
