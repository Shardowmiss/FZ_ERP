/**
 * Wave 3（P1-c④ 报表强制时间窗）的真实验收回归。
 *
 * 这个模块是"报表不再全表扫"的唯一守门人：任何一处返回了 `undefined` 或把 startDate
 * 悄悄丢掉，对应的报表就会退化成全表扫描，而且**不报错、只是变慢**。所以这里把口径
 * 钉死：显式传参必须与改造前完全等价，缺省必须注入窗口，豁免必须显式。
 */
import { describe, it, expect } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';
import {
  resolveReportWindow,
  normalizeReportDate,
  describeReportWindow,
  DEFAULT_REPORT_WINDOW_DAYS,
  MAX_REPORT_LOOKBACK_DAYS,
} from '@server/common/report-window';

/** 固定基准时刻，避免"跑测试的今天"影响断言。 */
const NOW = new Date(2026, 8, 24, 15, 30, 0); // 2026-09-24 本地时间

describe('resolveReportWindow 口径', () => {
  it('显式传参保持半开区间 [start, end+1)，与改造前的 gte+lt 等价', () => {
    const win = resolveReportWindow(
      { startDate: '2026-03-01', endDate: '2026-03-31', now: NOW },
    );
    expect(win).toBeDefined();
    expect(win!.start).toBe('2026-03-01');
    expect(win!.endExclusive).toBe('2026-04-01'); // 4-1 不在区间内
    expect(win!.startDefaulted).toBe(false);
    expect(win!.endDefaulted).toBe(false);
  });

  it('只传 endDate 时按默认窗口往前推，下界被补齐', () => {
    const win = resolveReportWindow({ endDate: '2026-09-30', now: NOW });
    expect(win!.startDefaulted).toBe(true);
    expect(win!.endDefaulted).toBe(false);
    expect(win!.endExclusive).toBe('2026-10-01');
    expect(win!.windowDays).toBe(DEFAULT_REPORT_WINDOW_DAYS);
    // 末端 09-30 含当天，往前数 90 天 → 07-03（7/3~9/30 正好 90 天）
    expect(win!.start).toBe('2026-07-03');
  });

  it('两个参数都不传时注入默认窗口，杜绝无界扫描', () => {
    // 固定 now，使该用例与"跑测试的今天"无关（此前硬编码 '2026-09-25' 会在跨日后过期）
    const win = resolveReportWindow({ now: NOW }, new Logger('t'));
    expect(win).toBeDefined();
    expect(win!.startDefaulted).toBe(true);
    expect(win!.endDefaulted).toBe(true);
    expect(win!.endExclusive).toBe('2026-09-25'); // 明天
    expect(win!.start).toBe('2026-06-27');
  });

  it('allowFullRange=true 时返回 undefined（明确表示"不过滤"，且留下 warn 留痕）', () => {
    const logger = new Logger('t');
    const warns: string[] = [];
    (logger as unknown as { warn: (m?: unknown, ...a: unknown[]) => void }).warn = (
      m?: unknown,
    ) => warns.push(String(m));

    const win = resolveReportWindow(
      { allowFullRange: true, startDate: '2020-01-01', now: NOW },
      logger,
    );
    expect(win).toBeUndefined();
    expect(warns).toHaveLength(1); // 全量扫描必须留痕
  });

  it('windowDays<=0 等价于显式豁免，不必依赖调用方额外传 allowFullRange', () => {
    expect(resolveReportWindow({ windowDays: 0, now: NOW })).toBeUndefined();
    expect(resolveReportWindow({ windowDays: -5, now: NOW })).toBeUndefined();
  });

  it('windowDays 覆盖默认回看天数', () => {
    const win = resolveReportWindow({ windowDays: 7, now: NOW });
    expect(win!.windowDays).toBe(7);
    // 末端为今天(09-24)，含末端往前数 7 天 → 09-18 ~ 09-24
    expect(win!.start).toBe('2026-09-18');
  });

  it('跨度超过告警线时打 warn，但不静默截断', () => {
    const logger = new Logger('t');
    const warns: string[] = [];
    (logger as unknown as { warn: (m?: unknown) => void }).warn = (m?: unknown) =>
      warns.push(String(m));

    const win = resolveReportWindow(
      { startDate: '2020-01-01', endDate: '2026-09-30', now: NOW },
      logger,
    );
    // 静默改数比全扫更危险：这里必须原样返回，只告警
    expect(win!.start).toBe('2020-01-01');
    expect(win!.windowDays).toBeGreaterThan(MAX_REPORT_LOOKBACK_DAYS);
    expect(warns.some((w) => w.includes('告警线'))).toBe(true);
  });

  it('非法日期一律 400，脏值进不了 SQL', () => {
    // 形状非法
    for (const bad of ['2026/09/01', 'abc', '2026-1-1']) {
      expect(() => resolveReportWindow({ startDate: bad, now: NOW })).toThrow(HttpException);
      expect(() => resolveReportWindow({ endDate: bad, now: NOW })).toThrow(HttpException);
    }
    // 形状合法但日历上不存在（Date.UTC 会静默溢出，必须在这里拦住）
    for (const bad of ['2026-13-40', '2026-02-30', '2026-00-10']) {
      expect(() => resolveReportWindow({ startDate: bad, now: NOW })).toThrow(HttpException);
    }
  });

  it('空串等价于"没传"（按默认窗口处理，而不是当成非法值）', () => {
    const win = resolveReportWindow({ startDate: '', endDate: '', now: NOW });
    expect(win!.startDefaulted).toBe(true);
    expect(win!.endDefaulted).toBe(true);
  });
});

describe('normalizeReportDate / describeReportWindow', () => {
  it('normalizeReportDate 合法值原样返回并去空白', () => {
    expect(normalizeReportDate(' 2026-01-01 ', 'startDate')).toBe('2026-01-01');
  });

  it('describeReportWindow 对全量返回 FULL_RANGE', () => {
    expect(describeReportWindow(undefined)).toBe('FULL_RANGE');
    expect(describeReportWindow({ start: 'a', endExclusive: 'b', startDefaulted: false, endDefaulted: false, windowDays: 1 })).toBe('[a, b)');
    expect(
      describeReportWindow({ start: 'a', endExclusive: 'b', startDefaulted: true, endDefaulted: true, windowDays: 1 }),
    ).toBe('[a, b) (defaulted)');
  });
});
