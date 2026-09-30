import {
  Controller,
  UseGuards,
  Get,
  Patch,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { SettingsService } from './settings.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  Store,
  Employee,
  ListResponse,
  PaymentMethod,
  PointsRule,
  OperationLog,
} from '@shared/api.interface';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('store')
  async getStore(@Query('id') id?: string): Promise<Store | null> {
    return this.settingsService.getStore(id);
  }

  @Roles('admin', 'manager')
  @Get('employees')
  async getEmployees(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<Employee>> {
    // P0-1：员工列表强制约束在登录主体门店
    // P1-3：员工管理视图限定店长/管理员
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.settingsService.getEmployees({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      role,
      status,
      keyword,
    });
  }

  /** 当前登录员工档案（含已保存语种），前端初始化语言用，任何登录角色可读。 */
  @Get('employees/me')
  async getMe(@Req() req: Request): Promise<Employee | null> {
    const principal = principalFromReq(req);
    if (!principal?.employeeId) return null;
    return this.settingsService.getCurrentEmployee(principal.employeeId);
  }

  /** 当前登录员工更新自己的语种偏好（个人独立配置）。 */
  @Patch('employees/me/language')
  async updateMyLanguage(
    @Req() req: Request,
    @Body() body?: { language?: string },
  ): Promise<{ language: string }> {
    const principal = principalFromReq(req);
    if (!principal?.employeeId) {
      throw new BadRequestException('无法确定当前员工');
    }
    if (!body?.language) {
      throw new BadRequestException('缺少 language 参数');
    }
    return this.settingsService.updateCurrentEmployeeLanguage(
      principal.employeeId,
      body.language,
    );
  }

  @Get('payment-methods')
  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return this.settingsService.getPaymentMethods();
  }

  @Get('points-rules')
  async getPointsRules(): Promise<PointsRule[]> {
    return this.settingsService.getPointsRules();
  }

  @Roles('admin', 'manager')
  @Get('op-logs')
  async getOperationLogs(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ListResponse<OperationLog>> {
    // P0-1：操作日志强制约束在登录主体门店
    // P1-3：操作审计日志查看限定店长/管理员
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.settingsService.getOperationLogs({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      module,
      action,
      keyword,
      startDate,
      endDate,
    });
  }
}
