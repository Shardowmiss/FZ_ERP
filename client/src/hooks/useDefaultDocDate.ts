import { useSystemConfig } from '@client/src/contexts/SystemConfigContext';
import { defaultDateWindow } from '@client/src/utils/date-utils';

/**
 * 读取系统配置中的「单据默认查询天数」(defaultDocQueryDays，默认 90)，
 * 返回最近 N 天的日期窗 { startDate, endDate }（YYYY-MM-DD）。
 * 用于各单据列表页的初始日期筛选：进入页面即按最近 N 天查询；
 * 用户主动清空日期则查全部；再次进入页面重新默认。
 */
export function useDefaultDocDate(): { startDate: string; endDate: string } {
  const { config } = useSystemConfig();
  const days =
    typeof config?.defaultDocQueryDays === 'number' && config.defaultDocQueryDays > 0
      ? config.defaultDocQueryDays
      : 90;
  return defaultDateWindow(days);
}
