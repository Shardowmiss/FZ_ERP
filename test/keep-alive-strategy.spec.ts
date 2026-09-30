// C.2 回归测试：keep-alive LRU 上限策略
import { describe, it, expect } from 'vitest';
import {
  computeKeepAliveKeys,
  DEFAULT_MAX_KEEP_ALIVE,
} from '../client/src/components/Tabs/keepAliveStrategy';

describe('computeKeepAliveKeys（keep-alive LRU 上限）', () => {
  it('默认最多保留 8 个', () => {
    const open = Array.from({ length: 15 }, (_, i) => `tab-${i}`);
    const recency = [...open].reverse(); // tab-14 最近，tab-0 最早
    const keys = computeKeepAliveKeys({
      openTabKeys: open,
      activeKey: 'tab-14',
      recency,
    });
    expect(keys.length).toBe(DEFAULT_MAX_KEEP_ALIVE);
  });

  it('当前激活 tab 永不被淘汰', () => {
    const open = Array.from({ length: 20 }, (_, i) => `tab-${i}`);
    // recency 里 activeKey 排最后（最旧）
    const recency = ['tab-0', ...open.slice(1).reverse(), 'tab-19'];
    const keys = computeKeepAliveKeys({
      openTabKeys: open,
      activeKey: 'tab-19',
      recency,
    });
    expect(keys).toContain('tab-19');
    expect(keys.length).toBe(DEFAULT_MAX_KEEP_ALIVE);
  });

  it('dashboard 始终保留', () => {
    const open = Array.from({ length: 12 }, (_, i) => `tab-${i}`);
    const recency = [...open].reverse();
    const keys = computeKeepAliveKeys({
      openTabKeys: open,
      activeKey: 'tab-11',
      recency,
    });
    expect(keys).toContain('dashboard');
  });

  it('LRU：最久未激活的先被淘汰（dashboard 占 1 个名额）', () => {
    // 打开 10 个，recency: t9(最近) ... t0(最旧)
    const open = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const recency = [...open].reverse();
    const keys = computeKeepAliveKeys({
      openTabKeys: open,
      activeKey: 't9',
      recency,
      max: 6,
      alwaysKeep: ['dashboard'],
    });
    // 名额 6 = 当前激活 t9 + dashboard + 最近 4 个(t8,t7,t6,t5)，t4 起淘汰
    expect(keys).toContain('t9');
    expect(keys).toContain('dashboard');
    expect(keys).toContain('t5');
    expect(keys).not.toContain('t4'); // 第 7 顺位，被淘汰
    expect(keys).not.toContain('t0'); // 最旧，被淘汰
  });

  it('已关闭（不在 openTabKeys）的 tab 不保留', () => {
    const keys = computeKeepAliveKeys({
      openTabKeys: ['tab-a', 'tab-b'],
      activeKey: 'tab-a',
      recency: ['tab-a', 'tab-b', 'closed-x'],
    });
    expect(keys).not.toContain('closed-x');
  });

  it('打开数 <= 上限时全部保留', () => {
    const open = ['tab-1', 'tab-2', 'tab-3'];
    const keys = computeKeepAliveKeys({
      openTabKeys: open,
      activeKey: 'tab-1',
      recency: ['tab-1', 'tab-2', 'tab-3'],
      max: 8,
    });
    expect(keys.sort()).toEqual(['dashboard', 'tab-1', 'tab-2', 'tab-3'].sort());
  });
});
