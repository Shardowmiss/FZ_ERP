import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { OperationLogService } from './operation-log.service';
import type { OperationLog, PaginationResult } from '@shared/api.interface';

@NeedLogin()
@Controller('api/system/operation-log')
export class OperationLogController {
  constructor(private readonly operationLogService: OperationLogService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
    @Query('module') module?: string,
    @Query('operationType') operationType?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PaginationResult<OperationLog>> {
    return this.operationLogService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      startDate,
      endDate,
      userId,
      module,
      operationType,
      cursor,
    });
  }
}
