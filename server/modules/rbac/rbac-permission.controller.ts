import { Controller, Get } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { RbacService } from './rbac.service';
import type { RbacPermission } from '@shared/api.interface';

// 权限树/菜单树：仅供「系统管理-权限管理」页使用（AuthContext 的权限来源走 /api/auth/me，
// 不依赖本接口），故可安全加守卫，不影响登录流程。
@NeedLogin()
@CheckPermission('system:permission')
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
