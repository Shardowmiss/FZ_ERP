import { Controller, Get } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { RbacService } from './rbac.service';
import type { RbacPermission } from '@shared/api.interface';

@NeedLogin()
@Controller('api/rbac/permissions')
export class RbacPermissionController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('tree')
  async getTree(): Promise<RbacPermission[]> {
    return this.rbacService.getPermissionTree();
  }

  @Get('menu-tree')
  async getMenuTree(): Promise<RbacPermission[]> {
    return this.rbacService.getMenuTree();
  }
}
