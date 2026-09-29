import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MemberService } from './member.service';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/member')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

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
}
