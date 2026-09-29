/**
 * 报表 / 分析 / 看板查询的「强制时间窗」（P1-c④）。
 *
 * 背景：报表类接口的 WHERE 里只要缺了 `时间列 >= 常量`，PG 就只能全表扫。
 * 这套代码里大量报表把 startDate/endDate 声明成**可选**，前端不传就成了无界扫描；
 * 更糟的是部分方法（如透视表 inventory 分支）虽然收了 startDate，
 * 却因为 dateCol 为空把参数静默丢弃，where 里连时间条件都不存在。
 *
 * 本模块提供统一的兜底策略：
 *   1. 显式传参时，口径与改造前**完全等价**（半开区间 [start, end+1)，与原有的
 *      `gte(start)` + `lt(endDate)` 一致）——因此现有前端不需要改。
 *   2. 一个参数都不传时，注入默认回看窗口（DEFAULT_REPORT_WINDOW_DAYS 天），
 *      杜绝无界扫描；实际生效的窗口会写进响应/日志，便于核对口径。
 *   3. 确有全量需求时，必须显式声明 allowFullRange=true（或 windowDays<=0），
 *      会打警告日志，把「我知道这是全表扫描」这件事留痕。
 *
 * 口径约定：一律使用**半开区间** `[start, endExclusive)`。
 *   · endExclusive = 原 endDate + 1 天，等价于原有 `lt(endDate)`；
 *   · endExclusive 缺省为「明天」，等价于原有 `lt(明天)`（即含到今天为止）。
 * 因此把 endDate 从"不传"变成"传今天"不会造成任何数据差异。
 */

import { BadRequestException, Logger } from '@nestjs/common';

/** 默认回看天数；可用环境变量 REPORT_WINDOW_DAYS 覆盖（运维调整，不改代码）。 */
export const DEFAULT_REPORT_WINDOW_DAYS: number =
  Number.parseInt(process.env.REPORT_WINDOW_DAYS ?? '90', 10) || 90;

/** 超过该跨度时打告警（不强制截断——传超长区间通常是业务有意为之，静默改数比全扫更危险）。 */
export const MAX_REPORT_LOOKBACK_DAYS: number = 1825; // 5 年

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportWindow {
  /** 闭区间下界，格式 YYYY-MM-DD。等价于原有 `gte(col, start)`。 */
  start: string;
  /** 半开区间上界，格式 YYYY-MM-DD。等价于原有 `lt(col, endExclusive)`。 */
  endExclusive: string;
  /** 下界由服务端默认窗口补齐（即调用方没传 startDate）。 */
  startDefaulted: boolean;
  /** 上界由服务端补齐为「明天」（即调用方没传 endDate）。 */
  endDefaulted: boolean;
  /** 实际生效的回看跨度天数。 */
  windowDays: number;
}

export interface ResolveReportWindowInput {
  startDate?: string;
  endDate?: string;
  /** 显式豁免时间窗（全量扫描）。默认 false。 */
  allowFullRange?: boolean;
  /** 覆盖默认回看天数；<= 0 等价于 allowFullRange。 */
  windowDays?: number;
  /** 注入基准时刻，仅便于测试固定结果。 */
  now?: Date;
}

/** 校验并规范化日期串为 YYYY-MM-DD；非法直接 400，避免脏值进 SQL。 */
export function normalizeReportDate(value: string, field: string): string {
  const v = (value ?? '').trim();
  if (!DATE_RE.test(v)) {
    throw new BadRequestException(`${field} 日期格式应为 YYYY-MM-DD`);
  }
  // 正则只管形状，挡不住 2026-13-40 / 2026-02-30：Date.UTC 会静默溢出
  // （2026-13-40 → 2027-02-09），得到一个"看起来合法"的日期再进 SQL，
  // 结果是报表口径悄悄偏移一整年。这里做一次 UTC 回环校验。
  const [y, m, d] = v.split('-').map((n) => Number.parseInt(n, 10));
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  if (
    roundTrip.getUTCFullYear() !== y ||
    roundTrip.getUTCMonth() !== m - 1 ||
    roundTrip.getUTCDate() !== d
  ) {
    throw new BadRequestException(`${field} 不是有效的日历日期：${value}`);
  }
  return v;
}

function toUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((n) => Number.parseInt(n, 10));
  return Date.UTC(y, m - 1, d);
}

function toStr(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function addDays(dateStr: string, n: number): string {
  return toStr(toUtcMs(dateStr) + n * 86400000);
}

function daysBetween(from: string, toExclusive: string): number {
  return Math.round((toUtcMs(toExclusive) - toUtcMs(from)) / 86400000);
}

/**
 * 解析报表查询的时间窗。
 * @returns ReportWindow；返回 undefined 表示**不做任何时间过滤**（全量，仅 allowFullRange 时发生）。
 */
export function resolveReportWindow(
  input: ResolveReportWindowInput = {},
  logger?: Logger,
): ReportWindow | undefined {
  const { allowFullRange, windowDays } = input;

  // 显式豁免：全量扫描需要「知道自己在做什么」，留一行日志。
  if (allowFullRange === true || (windowDays !== undefined && windowDays <= 0)) {
    logger?.warn(
      '[report-window] 已显式豁免时间窗，将执行全表扫描（startDate/endDate 均被忽略）。' +
        '如非必要请补齐日期范围。',
    );
    return undefined;
  }

  const explicitStart: string | undefined = input.startDate
    ? normalizeReportDate(input.startDate, 'startDate')
    : undefined;
  const explicitEnd: string | undefined = input.endDate
    ? normalizeReportDate(input.endDate, 'endDate')
    : undefined;

  const now: Date = input.now ?? new Date();
  const today: string = toStr(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );

  const days: number = windowDays && windowDays > 0 ? windowDays : DEFAULT_REPORT_WINDOW_DAYS;

  // 上界：显式 end 视为"含当天的最后一天"，半开上界 = end + 1 天；缺省则为明天（覆盖到今天）。
  const endDefaulted: boolean = !explicitEnd;
  const endExclusive: string = explicitEnd
    ? addDays(explicitEnd, 1)
    : addDays(today, 1);

  let start: string;
  let startDefaulted: boolean;
  if (explicitStart) {
    start = explicitStart;
    startDefaulted = false;
  } else {
    // 没传 startDate：以窗口末端往回推 days 天（含末端当天）。
    start = addDays(addDays(endExclusive, -1), -(days - 1));
    startDefaulted = true;
  }

  const win: ReportWindow = {
    start,
    endExclusive,
    startDefaulted,
    endDefaulted,
    windowDays: Math.max(daysBetween(start, endExclusive), 1),
  };

  if (win.windowDays > MAX_REPORT_LOOKBACK_DAYS) {
    logger?.warn(
      `[report-window] 请求的时间窗跨度 ${win.windowDays} 天，超过 ${MAX_REPORT_LOOKBACK_DAYS} 天告警线，请确认是否预期。`,
    );
  }
  if (win.startDefaulted || win.endDefaulted) {
    logger?.log(
      `[report-window] 调用方未传全日期参数，已注入默认窗口：[${win.start}, ${win.endExclusive})`,
    );
  }

  return win;
}

/** 便于日志/测试打印的可读摘要。 */
export function describeReportWindow(win: ReportWindow | undefined): string {
  if (!win) return 'FULL_RANGE';
  return win.startDefaulted || win.endDefaulted
    ? `[${win.start}, ${win.endExclusive}) (defaulted)`
    : `[${win.start}, ${win.endExclusive})`;
}
