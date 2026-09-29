import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConsistencyService } from './consistency.service';
import type { ConsistencyReport } from './consistency.types';

/**
 * 主数据一致性校验调度器（零依赖实现，与补货调度器同构）。
 *
 * 每 30s 轮询一次，命中“当前分钟”且本分钟尚未执行过的启用 cron 即触发全量
 * 校验并落库。默认每日 02:07 运行一次（对“对账”这类容错场景，进程重启后
 * 未补跑可接受）。
 */
@Injectable()
export class ConsistencySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsistencySchedulerService.name);
  private timer?: NodeJS.Timeout;
  private lastMinuteKey = '';
  /** 默认每日 02:07；可通过环境变量 CONSISTENCY_CRON 覆盖 */
  private readonly cron = process.env.CONSISTENCY_CRON ?? '7 2 * * *';

  constructor(private readonly consistency: ConsistencyService) {}

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.logger.error('一致性校验调度轮询异常', e));
    }, 30_000);
    this.logger.log(`主数据一致性校验调度器已启动（轮询 30s，cron=${this.cron}）`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger.log('主数据一致性校验调度器已停止');
    }
  }

  /** 手动立即执行一次（供测试 / 运维） */
  async manualRun(): Promise<ConsistencyReport> {
    return this.consistency.runManual();
  }

  async tick(): Promise<void> {
    const now = new Date();
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (this.lastMinuteKey === minuteKey) return;
    this.lastMinuteKey = minuteKey;

    if (matchCron(this.cron, now)) {
      this.logger.log('触发主数据一致性校验（定时）');
      void this.consistency.runManual().catch((e) => this.logger.error('定时校验失败', e));
    }
  }
}

/**
 * 轻量 5 字段 cron 匹配（分 时 日 月 周），与补货调度器一致。
 */
export function matchCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [m, h, dom, mon, dow] = fields;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  if (!matchField(m, minute, 0, 59)) return false;
  if (!matchField(h, hour, 0, 23)) return false;
  if (!matchField(mon, month, 1, 12)) return false;

  const domStar = dom === '*';
  const dowStar = dow === '*';
  const domMatch = matchField(dom, dayOfMonth, 1, 31);
  const dowMatch = matchField(dow, dayOfWeek, 0, 6);
  if (domStar && dowStar) return true;
  if (domStar) return dowMatch;
  if (dowStar) return domMatch;
  return domMatch && dowMatch;
}

function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (!Number.isFinite(step) || step <= 0) continue;
      let start = min;
      let end = max;
      if (range !== '*' && range.includes('-')) {
        [start, end] = range.split('-').map((x) => parseInt(x, 10));
      }
      if (range !== '*' && !range.includes('-')) start = end = parseInt(range, 10);
      if (value >= start && value <= end && (value - start) % step === 0) return true;
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map((x) => parseInt(x, 10));
      if (value >= a && value <= b) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}
