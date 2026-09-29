import {
  Controller,
  UseGuards,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { MembersService } from './members.service';
import { operatorIdFromReq } from '@server/common/audit';
import type {
  Member,
  ListResponse,
  CreateMemberDto,
  UpdateMemberDto,
  PointsLog,
  StoredLog,
  Coupon,
  LevelCount,
  SaleOrder,
} from '@shared/api.interface';
import { RechargeDto, IssueCouponDto, AdjustStoredValueDto } from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  async getMembers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('level') level?: string,
  ): Promise<ListResponse<Member>> {
    return this.membersService.getMembers({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
      level,
    });
  }

  @Get(':id')
  async getMember(@Param('id') id: string): Promise<Member> {
    return this.membersService.getMember(id);
  }

  @Post()
  async createMember(@Body() dto: CreateMemberDto): Promise<Member> {
    return this.membersService.createMember(dto);
  }

  @Patch(':id')
  async updateMember(
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<Member> {
    return this.membersService.updateMember(id, dto);
  }

  @Get(':id/points-log')
  async getPointsLog(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ListResponse<PointsLog>> {
    return this.membersService.getPointsLog(
      id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Get(':id/stored-log')
  async getStoredLog(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ListResponse<StoredLog>> {
    return this.membersService.getStoredLog(
      id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Get(':id/coupons')
  async getCoupons(@Param('id') id: string): Promise<Coupon[]> {
    return this.membersService.getCoupons(id);
  }

  @Get('level/counts')
  async getLevelCounts(): Promise<LevelCount[]> {
    return this.membersService.getLevelCounts();
  }

  @Get(':id/orders')
  async getMemberOrders(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ListResponse<SaleOrder>> {
    return this.membersService.getMemberOrders(
      id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 5,
    );
  }

  @Roles('admin', 'manager')
  @Post(':id/issue-coupon')
  async issueCoupon(
    @Param('id') id: string,
    @Body() dto: IssueCouponDto,
    @Req() req: Request,
  ): Promise<Coupon> {
    return this.membersService.issueCoupon(id, dto, operatorIdFromReq(req));
  }

  @Roles('admin', 'manager')
  @Post(':id/recharge')
  async recharge(
    @Param('id') id: string,
    @Body() dto: RechargeDto,
    @Req() req: Request,
  ): Promise<StoredLog> {
    return this.membersService.recharge(id, dto, operatorIdFromReq(req));
  }

  /**
   * F-6：储值手工调整。这是资料接口之外唯一允许变更余额的通道。
   * P1-3：由角色守卫限定为店长/管理员权限（原注释「上线时应由角色守卫限定」已落地）。
   */
  @Roles('admin', 'manager')
  @Post(':id/adjust-stored-value')
  async adjustStoredValue(
    @Param('id') id: string,
    @Body() dto: AdjustStoredValueDto,
    @Req() req: Request,
  ): Promise<StoredLog> {
    return this.membersService.adjustStoredValue(id, dto, operatorIdFromReq(req));
  }
}
