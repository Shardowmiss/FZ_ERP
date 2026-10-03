import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MemberLevelService } from './member-level.service';
import type { MemberLevel, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/member-level')
export class MemberLevelController {
  constructor(private readonly memberLevelService: MemberLevelService) {}

  @Get()
  async list(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('keyword') keyword?: string,
    @Query('conditionType') conditionType?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<MemberLevel>> {
    return this.memberLevelService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      keyword,
      conditionType,
      status,
    });
  }

  @Get('options')
  async getOptions(): Promise<{ code: string; name: string }[]> {
    return this.memberLevelService.getOptions();
  }

  @Get(':id')
  async getDetail(@Param('id') id: string): Promise<MemberLevel> {
    return this.memberLevelService.getDetail(id);
  }

  @NeedLogin()
  @CheckPermission('member:level')
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    dto: {
      code: string;
      name: string;
      conditionType?: string;
      thresholdAmount?: number;
      discount?: number;
      discountOnPromo?: boolean;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<MemberLevel> {
    const { userId } = req.userContext;
    return this.memberLevelService.create(dto, userId);
  }

  @NeedLogin()
  @CheckPermission('member:level')
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      conditionType?: string;
      thresholdAmount?: number;
      discount?: number;
      discountOnPromo?: boolean;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<MemberLevel> {
    const { userId } = req.userContext;
    return this.memberLevelService.update(id, dto, userId);
  }

  @NeedLogin()
  @CheckPermission('member:level')
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.memberLevelService.delete(id, userId);
  }
}
