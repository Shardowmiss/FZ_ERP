/**
 * 生成离线端唯一 ID
 * 格式: prefix_timestamp_random
 */
export const generateClientId = (prefix: string = 'cli'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
