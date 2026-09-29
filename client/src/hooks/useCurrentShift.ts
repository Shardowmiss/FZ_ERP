import { useState, useEffect, useCallback } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import * as shiftApi from '@client/src/api/shift';

/**
 * 当前班次。
 *
 * F-5：此前销售单与退货单都不带 shiftId，导致班次的销售额/现金/退款恒为 0，
 * 长短款机制完全失效（cashExpected 恒等于备用金）。现在下单前必须拿到当班班次。
 *
 * 离线时不请求网络，直接返回 null。离线单会在联网后连同当时记录的 shiftId
 * 一并同步；若同步时服务端判定班次已关闭或不存在，会在同步结果中给出错误，
 * 由离线队列处理台人工重试。
 */
/**
 * 本地缓存键。离线时无法请求班次接口，退化为读取上一次在线时拿到的班次，
 * 这样离线单同步时仍然能归属到班次（若该班次已结，服务端会记录告警并交由人工核对）。
 */
const SHIFT_CACHE_KEY = 'yuncaipos_current_shift';

export function useCurrentShift(storeId: string, enabled: boolean = true) {
  const [shiftId, setShiftId] = useState<string | null>(
    () => readCachedShift(storeId),
  );
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      // 离线：用上一次缓存的班次兜底，保证单据仍能归属
      const cached = readCachedShift(storeId);
      if (cached) setShiftId(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await shiftApi.getCurrentShift(storeId);
      const id =
        data && typeof data === 'object' && 'id' in data
          ? String((data as { id?: unknown }).id ?? '')
          : '';
      setShiftId(id || null);
      if (id) writeCachedShift(storeId, id);
    } catch (e) {
      logger.error('[useCurrentShift] load failed', e as Error);
      // 请求失败时用缓存兜底，避免一次抖动就堵住收银
      const cached = readCachedShift(storeId);
      setShiftId(cached);
      setError(
        e instanceof Error ? e.message : '获取当前班次失败，可能影响交班统计',
      );
    } finally {
      setLoading(false);
    }
  }, [storeId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { shiftId, loading, error, reload: load };
}

function readCachedShift(storeId: string): string | null {
  try {
    const raw = localStorage.getItem(`${SHIFT_CACHE_KEY}_${storeId}`);
    return raw || null;
  } catch {
    return null;
  }
}

function writeCachedShift(storeId: string, shiftId: string): void {
  try {
    localStorage.setItem(`${SHIFT_CACHE_KEY}_${storeId}`, shiftId);
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
}

export default useCurrentShift;
