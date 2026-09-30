// C.2 keep-alive LRU 上限策略：把“全量挂载所有打开过的 tab”收敛为
// “保留最近 N 个（含当前激活 tab 与常驻 dashboard）”。
// 抽成纯函数以便 node 环境单测覆盖，避免引入 jsdom/RTL 重依赖。

export const DEFAULT_MAX_KEEP_ALIVE = 8;

export interface KeepAliveStrategyInput {
  /** 当前在页签栏中“打开着”的 tab key 列表 */
  openTabKeys: string[];
  /** 当前激活（可见）的 tab key */
  activeKey?: string;
  /** 激活时间顺序：索引 0 = 最近激活，索引越大越早 */
  recency: string[];
  /** 最多保留的挂载数，默认 8 */
  max?: number;
  /** 始终保留的 key（如 dashboard），不参与 LRU 淘汰 */
  alwaysKeep?: string[];
}

/**
 * 计算应当保持挂载（keep-alive）的 key 集合。
 * - 候选 = alwaysKeep ∪ 当前打开的 tab key
 * - 排序：alwaysKeep（常驻/当前激活）优先，其次按 recency 升序（最近优先）
 * - 硬上限 max：截取前 max 个，alwaysKeep 也占用名额（保证总挂载数 ≤ max）
 */
export function computeKeepAliveKeys(input: KeepAliveStrategyInput): string[] {
  const max = input.max ?? DEFAULT_MAX_KEEP_ALIVE;
  const alwaysKeep = new Set<string>(input.alwaysKeep ?? ['dashboard']);
  if (input.activeKey) alwaysKeep.add(input.activeKey);

  const candidates = new Set<string>(alwaysKeep);
  input.openTabKeys.forEach((k) => candidates.add(k));

  const recency = input.recency;
  const recencyIndexOf = (k: string): number => {
    const i = recency.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const ordered = [...candidates].sort((a, b) => {
    const pa = alwaysKeep.has(a) ? 0 : 1;
    const pb = alwaysKeep.has(b) ? 0 : 1;
    if (pa !== pb) return pa - pb; // 常驻/激活优先
    return recencyIndexOf(a) - recencyIndexOf(b); // 其余按最近优先
  });

  // 硬上限：alwaysKeep 数量本就很少（dashboard + 当前激活），必然落在前 max 内
  return ordered.slice(0, max);
}
