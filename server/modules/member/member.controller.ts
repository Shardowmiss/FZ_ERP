import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MemberService } from './member.service';
import { MemberMergeService } from './member-merge.service';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { RequestContext } from '../../common/context/request-context';

@NeedLogin()
@Controller('api/member')
export class MemberController {
  constructor(
    private readonly memberService: MemberService,
    private readonly mergeService: MemberMergeService,
  ) {}

  @Get('list')
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('level') level?: string,
  ) {
    return this.memberService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      keyword,
      level,
    });
  }

  @CheckPermission('member:manage')
  @Post('create')
  async create(@Body() body: Record<string, unknown>) {
    return this.memberService.create(body as never);
  }

  @CheckPermission('member:manage')
  @Post('update')
  async update(@Body() body: Record<string, unknown>) {
    const id = body?.id as string;
    if (!id) throw new BadRequestException('id 必填');
    return this.memberService.update(id, body as never);
  }

  @CheckPermission('member:manage')
  @Post('points')
  async points(@Body() body: { memberId: string; changeType: string; changeValue: number; remark?: string }) {
    if (!body?.memberId) throw new BadRequestException('memberId 必填');
    return this.memberService.adjustPoints(
      body.memberId,
      body.changeType,
      Number(body.changeValue) || 0,
      body.remark,
    );
  }

  @Get('tags')
  async tags() {
    return this.memberService.listTags();
  }

  @CheckPermission('member:manage')
  @Post('tags')
  async createTag(@Body() body: { name: string; remark?: string }) {
    if (!body?.name) throw new BadRequestException('标签名必填');
    return this.memberService.createTag(body.name, body.remark);
  }

  @Get('profile/:id')
  async profile(@Param('id') id: string) {
    return this.memberService.profile(id);
  }

  @CheckPermission('member:manage')
  @Post('campaign')
  async campaign(@Body() body: { tagId: string; title: string; content?: string }) {
    if (!body?.tagId || !body?.title) throw new BadRequestException('tagId 与 title 必填');
    return this.memberService.campaign(body.tagId, body.title, body.content);
  }

  // ---- P0-3 主数据合并（资金敏感，独立于 member:manage 授权） ----

  /** 合并候选预览：按手机号分组的重复会员（解密脱敏），供运营确认 */
  @CheckPermission('member:merge')
  @Get('merge-candidates')
  async mergeCandidates(@Query('limit') limit = '500') {
    return this.mergeService.candidates(parseInt(limit, 10) || 500);
  }

  /** 执行合并：survivorId 吸收 mergedIds（资金安全，单事务 + 账本事件 + 可回滚日志） */
  @CheckPermission('member:merge')
  @Post('merge')
  async merge(
    @Body() body: { survivorId: string; mergedIds: string[]; reason?: string },
  ) {
    if (!body?.survivorId || !Array.isArray(body.mergedIds) || !body.mergedIds.length) {
      throw new BadRequestException('survivorId 与 mergedIds[] 必填');
    }
    return this.mergeService.merge({
      survivorId: body.survivorId,
      mergedIds: body.mergedIds,
      reason: body.reason,
      operator: RequestContext.getUserId(),
    });
  }

  /** 回滚一次合并（按日志 id）或整批（按 run_id）；资金安全反向，无双计 */
  @CheckPermission('member:merge')
  @Post('merge/:id/reverse')
  async reverseMerge(
    @Param('id') id: string,
    @Body() body: { runId?: string; operator?: string },
  ) {
    // id 既可能是 merge_log.id，也可能是 run_id（约定：run_id 以 merge_ 前缀）
    const isRunId = id.startsWith('merge_');
    return this.mergeService.reverse({
      ...(isRunId ? { runId: id } : { logId: id }),
      ...(body?.runId ? { runId: body.runId } : {}),
      operator: body?.operator ?? RequestContext.getUserId(),
    });
  }
}
