/**
 * 网络状态管理
 * - 监听浏览器 online/offline 事件
 * - 定期 ping 后端健康接口检测服务器可达性
 * - 检测 ERP 可达性
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

// ============ 类型定义 ============

export interface NetworkStatus {
  /** 浏览器是否在线（navigator.onLine） */
  isOnline: boolean;
  /** 后端服务器是否可达（心跳检测） */
  isServerReachable: boolean;
  /** ERP 系统是否可达 */
  erpReachable: boolean;
  /** 最后一次在线时间戳 */
  lastOnlineAt: number;
}

// ============ 常量 ============

const PING_INTERVAL_ONLINE = 30_000; // 在线时每 30 秒检测一次
const PING_INTERVAL_OFFLINE = 5_000; // 离线时每 5 秒检测一次（尽快恢复）
const HEALTH_ENDPOINT = '/api/offline-sync/ping';
const ERP_STATUS_ENDPOINT = '/api/erp-integration/status';

// ============ 信号变量（非 React 环境可用） ============

/**
 * 当前网络状态信号（模块级变量，供非 React 代码读取）
 */
export const isOnline: { value: boolean } = {
  value: typeof navigator !== 'undefined' ? navigator.onLine : true,
};

// ============ ping 后端 ============

/**
 * Ping 后端健康接口，检测服务器是否可达
 */
const pingServer = async (): Promise<boolean> => {
  try {
    const response = await axiosForBackend.get(HEALTH_ENDPOINT, {
      timeout: 5_000,
    });
    return response.status >= 200 && response.status < 500;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[Network] Server ping failed: ${message}`);
    return false;
  }
};

/**
 * 检测 ERP 系统可达性
 */
const checkErpReachable = async (): Promise<boolean> => {
  try {
    const response = await axiosForBackend.get(ERP_STATUS_ENDPOINT, {
      timeout: 5_000,
    });
    if (response.status >= 200 && response.status < 500) {
      const data = response.data as { connected?: boolean; status?: string };
      return data.connected === true || data.status === 'connected';
    }
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[Network] ERP status check failed: ${message}`);
    return false;
  }
};

// ============ Hook ============

/**
 * 网络状态 Hook
 *
 * - 监听 window online/offline 事件
 * - 定期 ping 后端健康接口
 * - 断网时缩短检测间隔到 5 秒
 */
export const useNetworkStatus = (): NetworkStatus => {
  const [status, setStatus] = useState<NetworkStatus>(() => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isServerReachable: true, // 初始假设可达，首次检测后修正
    erpReachable: true,
    lastOnlineAt: Date.now(),
  }));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOnlineRef = useRef<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  /** 执行一次完整的网络检测 */
  const doCheck = useCallback(async (): Promise<void> => {
    const browserOnline: boolean = typeof navigator !== 'undefined'
      ? navigator.onLine
      : true;
    isOnlineRef.current = browserOnline;
    isOnline.value = browserOnline;

    const serverReachable: boolean = browserOnline ? await pingServer() : false;
    const erpOk: boolean = serverReachable ? await checkErpReachable() : false;

    setStatus((prev: NetworkStatus) => {
      const nowOnline: boolean = browserOnline && serverReachable;
      return {
        isOnline: browserOnline,
        isServerReachable: serverReachable,
        erpReachable: erpOk,
        lastOnlineAt: nowOnline ? Date.now() : prev.lastOnlineAt,
      };
    });

    // 根据当前可达性决定下一次检测间隔
    const interval: number = serverReachable
      ? PING_INTERVAL_ONLINE
      : PING_INTERVAL_OFFLINE;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(doCheck, interval);
  }, []);

  // 监听 online/offline 事件
  useEffect(() => {
    const handleOnline = (): void => {
      logger.info('[Network] Browser online event');
      setStatus((prev: NetworkStatus) => ({
        ...prev,
        isOnline: true,
        lastOnlineAt: Date.now(),
      }));
      // 在线后立即执行一次检测
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      void doCheck();
    };

    const handleOffline = (): void => {
      logger.info('[Network] Browser offline event');
      isOnline.value = false;
      isOnlineRef.current = false;
      setStatus((prev: NetworkStatus) => ({
        ...prev,
        isOnline: false,
        isServerReachable: false,
        erpReachable: false,
      }));
      // 离线后加快检测频率
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(doCheck, PING_INTERVAL_OFFLINE);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 初始执行一次检测
    void doCheck();

    return (): void => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [doCheck]);

  return status;
};
