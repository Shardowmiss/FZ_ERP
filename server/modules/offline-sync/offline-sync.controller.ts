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
import { SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { OfflineSyncService } from './offline-sync.service';
import { principalFromReq, enforceStoreScope, resolveStoreId } from '@server/common/tenant';
import type {
  OfflineSyncResult,
  OfflineQueueItem,
  ListResponse,
  OfflineQueueQuery,
  MasterDataSnapshot,
} from '@shared/api.interface';
import { OfflineSyncBatchDto } from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@SkipThrottle()
@Controller('api/offline-sync')
export class OfflineSyncController {
  constructor(private readonly offlineSyncService: OfflineSyncService) {}

  @Get('queue')
  async getQueue(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('syncStatus') syncStatus?: string,
    @Query('entityType') entityType?: string,
  ): Promise<ListResponse<OfflineQueueItem>> {
    // P0-1：离线队列强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    const query: OfflineQueueQuery = {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      syncStatus,
      entityType: entityType as OfflineQueueQuery['entityType'],
    };
    return this.offlineSyncService.getQueue(query);
  }

  @Post('sync/batch')
  async syncBatch(@Req() req: Request, @Body() dto: OfflineSyncBatchDto): Promise<OfflineSyncResult[]> {
    // P0-1：批量同步门店归属服务端权威推导，优先主体门店、回退到设备自身 storeId
    const storeId = resolveStoreId(principalFromReq(req), dto.storeId);
    return this.offlineSyncService.syncBatch(dto.items, storeId);
  }

  @Post('sync/retry/:id')
  async retryItem(@Param('id') id: string): Promise<OfflineSyncResult> {
    return this.offlineSyncService.retryItem(id);
  }

  @Get('master-data')
  async getMasterData(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('since') since?: string,
  ): Promise<MasterDataSnapshot> {
    // P0-1：主数据下发强制约束在登录主体门店
    return this.offlineSyncService.getMasterData(enforceStoreScope(principalFromReq(req), storeId), since);
  }

  @Get('queue/stats')
  async getQueueStats(@Req() req: Request, @Query('storeId') storeId?: string) {
    // P0-1：队列统计强制约束在登录主体门店
    return this.offlineSyncService.getQueueStats(enforceStoreScope(principalFromReq(req), storeId));
  }

  @Get('ping')
  ping(): { pong: boolean } {
    return { pong: true };
  }
}
