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
import { ShiftService } from './shift.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  Shift,
  ListResponse,
  Eod,
} from '@shared/api.interface';
import { OpenShiftDto, CloseShiftDto } from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/shift')
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Get('current')
  async getCurrentShift(@Req() req: Request, @Query('storeId') storeId?: string): Promise<Shift | null> {
    // P0-1：班列表/当前班次强制约束在登录主体门店
    return this.shiftService.getCurrentShift(enforceStoreScope(principalFromReq(req), storeId));
  }

  @Post('open')
  async openShift(@Body() dto: OpenShiftDto, @Req() req: Request): Promise<Shift> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导
    return this.shiftService.openShift(dto, principalFromReq(req));
  }

  @Post('close')
  async closeShift(
    @Body('id') id: string,
    @Body() dto: CloseShiftDto,
    @Req() req: Request,
  ): Promise<Shift> {
    return this.shiftService.closeShift(id, dto, principalFromReq(req)?.employeeId ?? null);
  }

  @Get('history')
  async getHistory(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ListResponse<Shift>> {
    // P0-1：列表查询强制门店作用域，跨店读取自动降权到本店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.shiftService.getShiftHistory({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      startDate,
      endDate,
    });
  }

  @Get('eod')
  async getEodList(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ListResponse<Eod>> {
    // P0-1：日结列表强制约束在登录主体门店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.shiftService.getEodList({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      startDate,
      endDate,
    });
  }

  @Roles('admin', 'manager')
  @Post('eod')
  async executeEod(
    @Body('eodDate') eodDate: string,
    @Req() req: Request,
  ): Promise<Eod> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导（不再信任 Body.storeId）
    // P1-3：日结为财务关账操作，限定店长/管理员
    return this.shiftService.executeEod(principalFromReq(req), eodDate);
  }

  @Get('eod/:id')
  async getEodDetail(@Param('id') id: string): Promise<Eod> {
    return this.shiftService.getEodDetail(id);
  }
}
