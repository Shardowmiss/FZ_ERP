import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SystemConfigService } from './system-config.service';
import type { SystemConfig } from '@shared/api.interface';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@Controller('api/system/config')
export class SystemConfigController {
  constructor(private readonly configService: SystemConfigService) {}

  @Get()
  async getConfig(): Promise<SystemConfig> {
    return this.configService.getConfig();
  }

  /** 系统配置写入：仅管理员（system:config 权限）可调，防止非授权修改归档等关键策略 */
  @NeedLogin()
  @UseGuards(PermissionGuard)
  @CheckPermission('system:config')
  @Patch()
  async updateConfig(
    @Body() body: Partial<SystemConfig>,
    @Req() req: Request,
  ): Promise<SystemConfig> {
    const userId = req.userContext?.userId ?? '';
    return this.configService.updateConfig(body, userId);
  }
}
