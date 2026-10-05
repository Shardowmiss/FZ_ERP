import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import * as os from 'node:os';

/**
 * 可观测性基线（W1-1）：健康检查 + 轻量指标。
 *
 * 设计约束（贴合 lark-apaas 平台假设，零新依赖）：
 * 1. **公开可探测**：类级 `@Public()` 跳过全局 AuthGuard；GET 属 SAFE_METHOD，
 *    自动跳过 ErpCsrfGuard；`@SkipThrottle()` 跳过全局限流（被监控/探活高频轮询时
 *    不应被 429 挡住）。这样 K8s/LB/内部监控可直接 `/api/health`、`/api/health/metrics`。
 * 2. **DB 探活**：通过全局注入的 `DRIZZLE_DATABASE` 执行 `select 1`，顺带测出 DB 往返延迟；
 *    连接断开时返回 `db.ok=false` 且整体 status=down，供就绪探针判定。
 * 3. **零新依赖**：指标用 Node 内置 `process` / `os` 计算，JSON 直出，不引入 prom-client，
 *    避免给离线嵌入式部署增加体积与维护面。
 * 4. **不重复造日志**：请求级访问日志已由 `requestLogMiddleware` 统一输出（event=http.access），
 *    本控制器不再额外写日志，避免探活请求刷屏。
 */
@Public()
@SkipThrottle()
@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 就绪/存活探针。整体 status ∈ {ok, degraded, down}。 */
  @Get()
  async check(): Promise<HealthResponse> {
    const dbResult = await this.pingDb();
    const mem = process.memoryUsage();
    // 经验阈值：RSS 超过 1.5GB 视为内存压力（degraded），可经环境变量覆盖。
    const memRssWarnMb = Number(process.env.HEALTH_MEM_RSS_WARN_MB || 1536);
    const memWarn = mem.rss / 1024 / 1024 > memRssWarnMb;
    const status: HealthStatus = dbResult.ok ? (memWarn ? 'degraded' : 'ok') : 'down';
    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      db: dbResult,
      memory: {
        rssMb: mb(mem.rss),
        heapUsedMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
      },
    };
  }

  /** 轻量运行时指标（JSON）。用于自建看板/排障，无需 Prometheus 即可消费。 */
  @Get('metrics')
  async metrics(): Promise<MetricsResponse> {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const lagMs = await measureEventLoopLag();
    return {
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      platform: `${process.platform}/${process.arch}`,
      loadavg: os.loadavg().map((n) => Math.round(n * 1000) / 1000),
      cpu: { userMicro: cpu.user, systemMicro: cpu.system },
      eventLoopLagMs: Math.round(lagMs * 100) / 100,
      memory: {
        rssMb: mb(mem.rss),
        heapUsedMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
        externalMb: mb(mem.external || 0),
        heapUsedRatio: Math.round((mem.heapUsed / mem.heapTotal) * 1000) / 1000,
      },
    };
  }

  /** 探测数据库连接并返回往返延迟；异常时返回 ok=false 并带错误信息。 */
  private async pingDb(): Promise<DbProbe> {
    const t0 = Date.now();
    try {
      await this.db.execute(sql`select 1 as ok`);
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { ok: false, error: err?.message ?? String(e) };
    }
  }
}

type HealthStatus = 'ok' | 'degraded' | 'down';

interface DbProbe {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptimeSec: number;
  db: DbProbe;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
}

interface MetricsResponse {
  timestamp: string;
  uptimeSec: number;
  nodeVersion: string;
  pid: number;
  platform: string;
  loadavg: number[];
  cpu: { userMicro: number; systemMicro: number };
  eventLoopLagMs: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    heapUsedRatio: number;
  };
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** 事件循环滞后（ms）：用 setImmediate 实测「本 tick 之后排队到下一个 I/O 回调」的等待时长。 */
function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const elapsedNs = Number(process.hrtime.bigint() - start);
      resolve(elapsedNs / 1e6);
    });
  });
}
