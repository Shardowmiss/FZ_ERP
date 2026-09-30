/**
 * 图表配色常量
 *
 * ECharts 的配置项（itemStyle / lineStyle / axisLabel 等）需要**具体色值**，
 * 无法直接消费 CSS 变量，因此在此集中定义，避免各页面硬编码 hex。
 *
 * 必须与 client/src/tailwind-theme.css 的 token 保持同步：
 *   --pos-accent  #2563EB  品牌主色（已与 ERP --primary 统一）
 *   --pos-ink-3   #5A6A78  次级文字 / 轴标签
 *   --pos-line    #E8E4DA  轴线 / 分隔线
 * 修改主题时请同步更新本文件。
 */

/** 品牌主色（图表主序列用） */
export const CHART_BRAND = '#2563EB';

/** 轴标签 / 图例文字色 */
export const CHART_AXIS_LABEL = '#5A6A78';

/** 轴线 / 分隔线色 */
export const CHART_AXIS_LINE = '#E8E4DA';

/** 多序列图表色板（首位固定为品牌主色，其余按对比度与色相间隔选取） */
export const CHART_PALETTE = [
  '#2563EB',
  '#2E4A5E',
  '#B8A07E',
  '#3A7D5A',
  '#C08A2D',
];
