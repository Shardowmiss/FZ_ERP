import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { RequestContext } from '../../common/context/request-context';
import { MasterDataMergeService } from './master-data-merge.service';
import type { MergeEntityType } from './types';

const SUPPORTED: MergeEntityType[] = ['style', 'customer'];

@NeedLogin()
@Controller('api/md-merge')
export class MasterDataMergeController {
  constructor(private readonly svc: MasterDataMergeService) {}

  /** 执行合并：entityType ∈ {style,customer}；survivorId 吸收 mergedIds（绝不删除被合并方，仅打标+改指依赖） */
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
}
