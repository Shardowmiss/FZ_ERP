import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { RequestContext } from '../../common/context/request-context';
import { MasterDataMergeService } from './master-data-merge.service';
import type { MergeEntityType } from './types';

const SUPPORTED: MergeEntityType[] = ['style'];

@NeedLogin()
@Controller('api/md-merge')
export class MasterDataMergeController {
  constructor(private readonly svc: MasterDataMergeService) {}

  /** 执行合并：entityType ∈ {style}；survivorId 吸收 mergedIds（绝不删除被合并方，仅打标+改指依赖） */
  @CheckPermission('md:merge')
  @Post(':entityType/merge')
  async merge(
    @Param('entityType') entityType: string,
    @Body() body: { survivorId: string; mergedIds: string[]; reason?: string },
  ) {
    if (!SUPPORTED.includes(entityType as MergeEntityType)) {
      throw new BadRequestException(`不支持的 entityType：${entityType}`);
    }
    if (!body?.survivorId || !Array.isArray(body.mergedIds) || !body.mergedIds.length) {
      throw new BadRequestException('survivorId 与 mergedIds[] 必填');
    }
    return this.svc.merge({
      entityType: entityType as MergeEntityType,
      survivorId: body.survivorId,
      mergedIds: body.mergedIds,
      reason: body.reason,
      operator: RequestContext.getUserId(),
    });
  }

  /** 回滚一次合并（按日志 id）或整批（按 run_id）；解除打标，无双计 */
  @CheckPermission('md:merge')
  @Post(':entityType/merge/:id/reverse')
  async reverse(
    @Param('entityType') entityType: string,
    @Param('id') id: string,
    @Body() body: { runId?: string; operator?: string },
  ) {
    if (!SUPPORTED.includes(entityType as MergeEntityType)) {
      throw new BadRequestException(`不支持的 entityType：${entityType}`);
    }
    // id 既可能是 master_data_merge_log.id，也可能是 run_id（约定：run_id 以 mdmerge_ 前缀）
    const isRunId = id.startsWith('mdmerge_');
    return this.svc.reverse({
      ...(isRunId ? { runId: id } : { logId: id }),
      ...(body?.runId ? { runId: body.runId } : {}),
      operator: body?.operator ?? RequestContext.getUserId(),
    });
  }

  /**
   * 合并审计日志列表：按实体类型返回合并记录（含保留方/被合并方/原因/操作人/回滚状态）。
   * 供「合并审计」页展示与整批回滚；reversed=true 仅已回滚 / false 仅有效 / 不传全部。
   */
  @CheckPermission('md:merge')
  @Get(':entityType/merge-logs')
  async listLogs(
    @Param('entityType') entityType: string,
    @Query('reversed') reversed?: string,
    @Query('limit') limit?: string,
  ) {
    if (!SUPPORTED.includes(entityType as MergeEntityType)) {
      throw new BadRequestException(`不支持的 entityType：${entityType}`);
    }
    const rev = reversed === undefined ? undefined : reversed === 'true';
    const lim = limit ? Math.min(parseInt(limit, 10) || 200, 500) : 200;
    return this.svc.listLogs(entityType, { reversed: rev, limit: lim });
  }

  /**
   * 查重候选发现：按归一名称 / 归一电话分组，排除已合并方，返回疑似重复组。
   * 每组带成员列表与 relatedCount（依赖业务单据数合计），供运营判断谁是 survivor。
   * 非热路径：SQL 侧完成归一+分组（与 configs.ts 的归一表达式严格同构，避免静默漏组），
   * JS 侧仅做成员明细补全、关联单据计数、脱敏与推荐 survivor。
   */
  @CheckPermission('md:merge')
  @Get(':entityType/candidates')
  async candidates(
    @Param('entityType') entityType: string,
    @Query('limit') limit?: string,
  ) {
    if (!SUPPORTED.includes(entityType as MergeEntityType)) {
      throw new BadRequestException(`不支持的 entityType：${entityType}`);
    }
    const lim = limit ? Math.min(parseInt(limit, 10) || 200, 500) : 200;
    return this.svc.candidates(entityType, lim);
  }
}
