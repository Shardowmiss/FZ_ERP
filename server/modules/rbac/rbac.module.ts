import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RbacUserController } from './rbac-user.controller';
import { RbacRoleController } from './rbac-role.controller';
import { RbacPermissionController } from './rbac-permission.controller';
import { RbacService } from './rbac.service';

// 全局模块：RbacService 被 PermissionGuard 跨模块依赖（System/Analytics/UniqueCode 等模块的
// 控制器通过 @UseGuards(PermissionGuard) 使用），必须全局可用，否则 Nest DI 在子模块上下文
// 无法解析 RbacService，导致应用启动失败（UnknownDependenciesException）。
@Global()
@Module({
  controllers: [
    AuthController,
    RbacUserController,
    RbacRoleController,
    RbacPermissionController,
  ],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
