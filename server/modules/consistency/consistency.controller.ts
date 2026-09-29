import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { ConsistencyService } from './consistency.service';
import type { ConsistencyReport, ConsistencyRunSummary } from './consistency.types';

/**
 * 主数据一致性校验对外接口（P2-3）。
 * 复用既有 `system:config` 权限码（系统-配置，超管已持有），避免引入未注册码导致全员 403。
 */
@Controller('system/consistency')
@NeedLogin()
@CheckPermission('system:config')
export class ConsistencyController {
  constructor(private readonly consistency: ConsistencyService) {}

  /** 手动触发一次全量一致性校验并落库 */
  @Post('run')
  async run(): Promise<ConsistencyReport> {
    return this.consistency.runManual();
  }

  /** 最近一次运行报告 */
  @Get('latest')
  async latest(): Promise<ConsistencyReport | { message: string }> {
    const r = await this.consistency.latest();
    if (!r) return { message: '暂无从库记录，请先触发一次 run' };
    return r;
  }

  /** 历史运行摘要（默认最近 20 次） */
  @Get('history')
  async history(@Query('limit') limit?: string): Promise<ConsistencyRunSummary[]> {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.consistency.history(Number.isFinite(n) ? n : 20);
  }
}
