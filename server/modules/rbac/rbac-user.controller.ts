import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { RbacService } from './rbac.service';
import { PermissionGuard } from '../../common/guards/permission.guard';
import type {
  RbacUser,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@UseGuards(PermissionGuard)
@CheckPermission('system:user')
@Controller('api/rbac/users')
export class RbacUserController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<RbacUser>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.rbacService.getUserList({
      page: p,
      pageSize: ps,
      keyword,
      status,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<RbacUser> {
    return this.rbacService.getUser(id);
  }

  @Post()
  async create(
    @Body()
    body: {
      username: string;
      name: string;
      password: string;
      phone?: string;
      department?: string;
      status?: string;
      remark?: string;
      roleIds?: string[];
    },
  ): Promise<RbacUser> {
    return this.rbacService.createUser(body);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      username?: string;
      name?: string;
      password?: string;
      phone?: string;
      department?: string;
      status?: string;
      remark?: string;
    },
  ): Promise<RbacUser> {
    return this.rbacService.updateUser(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.rbacService.deleteUser(id);
    return { success: true };
  }

  @Put(':id/roles')
  async assignRoles(
    @Param('id') id: string,
    @Body() body: { roleIds: string[] },
  ): Promise<{ success: boolean }> {
    await this.rbacService.assignUserRoles(id, body.roleIds ?? []);
    return { success: true };
  }
}
