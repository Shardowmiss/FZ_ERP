import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../../modules/rbac/rbac.service';
import { CHECK_PERMISSION_KEY } from '../decorators/check-permission.decorator';
import { isReadMethod } from '@shared/permission-match';

/**
 * 接口级权限守卫（垂直越权防护）。
 *
 * 读取 @CheckPermission(code) 元数据；若方法/类未标注权限码则放行（按需启用，
 * 不强制所有接口都声明，避免破坏既有调用）。标注了权限码时，根据请求中的
 * x-auth-token 校验当前用户是否持有该权限，否则返回 403。
 *
 * ── 读/写分离（重要）──────────────────────────────────────────────
 * 绝大多数控制器仍以「资源粗码」声明守卫（如 @CheckPermission('sales:outbound')），
 * 而权限树可以只授予「动作子码」（如 sales:outbound:view）。若一律用严格的动作级
 * 判定，只读角色就会出现「页面能进（前端 canAccess 放行）、列表却 403」的割裂。
 * 故按 HTTP 方法分流：
 *   · GET / HEAD（读）  → checkAccess  （访问级：持有码、祖码或任一动作子码即可）
 *   · 其余（写）        → checkPermission（动作级：严格，零放宽）
 * 读放宽只影响「看得到什么」，不影响「能改什么」；所有写路径语义不变。
 *
 * 注：本守卫依赖全局 AuthGuard 先完成登录态校验；这里只做“有没有这个权限”的判断。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly rbacService: RbacService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string>(CHECK_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!code) return true; // 未声明权限码 → 不拦截

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      method?: string;
    }>();
    const headerToken = req.headers['x-auth-token'];
    const bearer = req.headers['authorization'];
    const token =
      headerToken ??
      (bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : undefined);
    if (!token) throw new UnauthorizedException('未登录或登录已过期');

    const ok = isReadMethod(req.method)
      ? await this.rbacService.checkAccess(String(token), code)
      : await this.rbacService.checkPermission(String(token), code);
    if (!ok) throw new ForbiddenException(`无权访问该接口：${code}`);
    return true;
  }
}
