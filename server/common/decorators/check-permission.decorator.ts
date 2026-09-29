import { SetMetadata } from '@nestjs/common';

export const CHECK_PERMISSION_KEY = 'checkPermission';

/**
 * 接口级权限校验装饰器。
 *
 * 配合 PermissionGuard 使用：在被装饰的 Controller 或方法上标记所需权限码，
 * 未持有该权限的用户将被拒绝（403）。
 *
 * 用法：
 *   @CheckPermission('system:user')
 *   @Post()
 *   create() {}
 *
 * 若不在意权限（公共/已通过其他手段保护），省略装饰器即可。
 */
export const CheckPermission = (code: string): MethodDecorator & ClassDecorator =>
  SetMetadata(CHECK_PERMISSION_KEY, code);
