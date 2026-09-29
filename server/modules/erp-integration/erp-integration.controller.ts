import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { ErpIntegrationService } from './erp-integration.service';
import { operatorIdFromReq } from '@server/common/audit';
import type {
  ErpConnectionStatus,
  ErpSyncStatus,
  SyncLog,
  ListResponse,
} from '@shared/api.interface';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/erp-integration')
export class ErpIntegrationController {
  constructor(
    private readonly erpIntegrationService: ErpIntegrationService,
  ) {}

  @Get('status')
  async getStatus(): Promise<ErpConnectionStatus> {
    return this.erpIntegrationService.getConnectionStatus();
  }

  @Roles('admin')
  @Post('toggle')
  async toggleConnection(
    @Body('online') online: boolean,
    @Req() req: Request,
  ): Promise<ErpConnectionStatus> {
    return this.erpIntegrationService.toggleConnection(online, operatorIdFromReq(req));
  }

  @Get('downstream')
  async getDownstreamStatus(): Promise<ErpSyncStatus[]> {
    return this.erpIntegrationService.getDownstreamStatus();
  }

  @Roles('admin')
  @Post('downstream/:type/sync')
  async syncDownstream(
    @Param('type') type: string,
    @Req() req: Request,
  ): Promise<{ success: boolean; count: number }> {
    return this.erpIntegrationService.syncDownstream(type, operatorIdFromReq(req));
  }

  @Get('upstream')
  async getUpstreamStatus(): Promise<ErpSyncStatus[]> {
    return this.erpIntegrationService.getUpstreamStatus();
  }

  @Roles('admin')
  @Post('upstream/retry')
  async retryFailedUpstream(
    @Req() req: Request,
  ): Promise<{ success: boolean; retriedCount: number }> {
    return this.erpIntegrationService.retryFailedUpstream(operatorIdFromReq(req));
  }

  @Get('logs')
  async getLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('direction') direction?: string,
    @Query('dataType') dataType?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ListResponse<SyncLog>> {
    return this.erpIntegrationService.getSyncLogs({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      direction,
      dataType,
      status,
      startDate,
      endDate,
    });
  }

  @Roles('admin')
  @Post('initial-sync')
  async initialSync(
    @Body('storeId') storeId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.erpIntegrationService.initialSync(storeId);
  }
}
