/**
 * 图表配色常量
 *
 * ECharts 的配置项（itemStyle / lineStyle / color 等）需要**具体色值**，
 * 无法直接消费 CSS 变量，因此在此集中定义，避免各页面硬编码 hex。
 *
 * 必须与 client/src/tailwind-theme.css 的 token 保持同步：
 *   --primary  hsl(221 83% 53%) ≈ #2563EB  品牌主色
 * 修改主题时请同步更新本文件。
 *
 * 注意：本文件与 POS（pos-review）的 client/src/lib/chart-colors.ts 为对称实现，
 * 两处需保持一致，否则跨系统图表视觉会再次分叉。
 */

/** 品牌主色（图表主序列用，对应 --primary） */
export const CHART_PRIMARY = '#2563EB';

/** 次级序列色（正向指标常用，如增长、达成） */
export const CHART_POSITIVE = '#10B981';

/** 警示序列色 */
export const CHART_WARNING = '#F59E0B';

/** 负向 / 异常序列色 */
export const CHART_NEGATIVE = '#EF4444';

/** 多序列图表色板（首位固定为品牌主色） */
export const CHART_PALETTE = [
  CHART_PRIMARY,
  CHART_POSITIVE,
  CHART_WARNING,
  CHART_NEGATIVE,
  '#8B5CF6',
];
