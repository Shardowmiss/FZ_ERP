/**
 * 操作日志（P0-5 配套：关键操作留痕）
 *
 * 当前实现：优先尝试上报服务端 /api/settings/operation-log（落 pos_operation_log 表）；
 * 若服务端未开放该接口（或离线），降级写入本地 localStorage 队列，联网后可补传。
 *
 * 使用：在关键动作（登录/登出、下单、退货、开班/交班、改价、库存调整）处调用 logOperation()。
 */
import { logger } from '@lark-apaas/client-toolkit/logger';

const LOCAL_KEY = 'yuncaipos_operation_log';

export interface OperationLogEntry {
  module: string;
  action: string;
  targetNo?: string;
  content?: string;
  employeeId?: string;
  employeeName?: string;
  createdAt: string;
}

function pushLocal(entry: OperationLogEntry): void {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list: OperationLogEntry[] = raw ? (JSON.parse(raw) as OperationLogEntry[]) : [];
    list.unshift(entry);
    // 只保留最近 200 条，避免无限膨胀
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

export function getLocalOperationLog(): OperationLogEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as OperationLogEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * 记录一条操作日志。上报失败静默降级到本地，绝不阻塞业务流程。
 */
export async function logOperation(entry: Omit<OperationLogEntry, 'createdAt'>): Promise<void> {
  const full: OperationLogEntry = { ...entry, createdAt: new Date().toISOString() };
  try {
    const res = await fetch('/api/settings/operation-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // 服务端未开放该接口或离线：降级本地留痕
    pushLocal(full);
    logger.debug(`[operation-log] fallback to local: ${String(err)}`);
  }
}
