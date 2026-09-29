import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { MonthCloseService } from './month-close.service';
import type {
  MonthCloseRecord,
  MonthCloseDetailResponse,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

interface ReopenDto {
  remark?: string;
}

@NeedLogin()
@Controller('api/finance/month-close')
export class MonthCloseController {
  constructor(private readonly monthCloseService: MonthCloseService) {}

  @Get('/')
  async list(): Promise<MonthCloseRecord[]> {
    return this.monthCloseService.list();
  }

  @Get('/:id')
  async getById(@Param('id') id: string): Promise<MonthCloseRecord> {
    return this.monthCloseService.getById(id);
  }

  @NeedLogin()
  @CheckPermission('finance:profit')
  @Post('/:id/close')
  async close(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<MonthCloseRecord> {
    const { userId } = req.userContext;
    return this.monthCloseService.close(id, userId);
  }

  @NeedLogin()
  @CheckPermission('finance:profit')
  @Post('/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() body: ReopenDto,
    @Req() req: Request,
  ): Promise<MonthCloseRecord> {
    const { userId } = req.userContext;
    return this.monthCloseService.reopen(id, userId, body.remark);
  }

  @Get('/:id/detail')
  async getDetail(
    @Param('id') id: string,
  ): Promise<MonthCloseDetailResponse> {
    return this.monthCloseService.getDetail(id);
  }
}
