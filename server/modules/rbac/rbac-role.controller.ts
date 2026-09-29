import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { RbacService } from './rbac.service';
import type {
  RbacRole,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/rbac/roles')
export class RbacRoleController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<RbacRole>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.rbacService.getRoleList({
      page: p,
      pageSize: ps,
      keyword,
      status,
    });
  }

  @Get('all')
  async all(): Promise<RbacRole[]> {
    return this.rbacService.getAllRoles();
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<RbacRole> {
    return this.rbacService.getRole(id);
  }

  @CheckPermission('system:role')
  @Post()
  async create(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      status?: string;
    },
  ): Promise<RbacRole> {
    return this.rbacService.createRole(body);
  }

  @CheckPermission('system:role')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      code?: string;
      name?: string;
      description?: string;
      status?: string;
    },
  ): Promise<RbacRole> {
    return this.rbacService.updateRole(id, body);
  }

  @CheckPermission('system:role')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.rbacService.deleteRole(id);
    return { success: true };
  }

  @Get(':id/permissions')
  async getPermissions(@Param('id') id: string): Promise<{ permissionIds: string[] }> {
    const permissionIds = await this.rbacService.getRolePermissions(id);
    return { permissionIds };
  }

  @CheckPermission('system:role')
  @Put(':id/permissions')
  async assignPermissions(
    @Param('id') id: string,
    @Body() body: { permissionIds: string[] },
  ): Promise<{ success: boolean }> {
    await this.rbacService.assignRolePermissions(id, body.permissionIds ?? []);
    return { success: true };
  }
}
