import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { RbacService } from '../../modules/rbac/rbac.service';
import {
  RequestContext,
  ALL_SCOPE,
  type DealerScope,
  type RequestCtx,
} from '../context/request-context';

/**
 * 数据权限（行级多租户）拦截器。
 *
 * 在每次 HTTP 请求中，依据当前登录用户（req.userContext.userId）解析其经销商作用域，
 * 写入 AsyncLocalStorage（RequestContext）。业务 Service 在执行核心单据 / 库存查询时读取
 * 该作用域并自动拼接过滤条件，从而消除“非超管可读全部经销商数据”的水平越权（IDOR）。
 *
 * - 未携带用户（公开接口 / 静态页面）→ 不写入作用域，业务侧以“全部可见”兜底。
 * - 已登录用户 → 由 RbacService.getUserDealerScope 解析：超管全量、按门店映射反查经销商、
 *   未配置用户在多租户模式（ERP_MULTI_TENANT=true）下默认拒绝、单租户模式（默认）下全量可见。
 *
 * 设计为全局 APP_INTERCEPTOR，与既有 AuditInterceptor 并存；对性能的影响通过 RbacService
 * 内的按用户缓存与“是否存在经销商”缓存抵消。
 */
@Injectable()
export class DataScopeInterceptor implements NestInterceptor {
  constructor(private readonly rbacService: RbacService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest<{
      userContext?: { userId?: string };
    }>();
    const userId = req?.userContext?.userId;

    let scope: DealerScope | undefined;
    if (userId) {
      scope = await this.rbacService.getUserDealerScope(userId);
    }

    // 合并而非新建上下文：RequestLogMiddleware 已在外层放入 requestId/traceId/路径等字段，
    // 此处若直接 run 一个全新对象，本请求后半段的日志会丢掉关联 ID（链路断链）。
    // 显式标注，避免 `?? {}` 把联合类型退化成 `{}` 导致字段访问报错
    const outer: Partial<RequestCtx> = RequestContext.get() ?? {};
    return RequestContext.run(
      {
        // requestId 在 RequestCtx 中是必需字段，但 spread 一个 Partial 后必需性会丢失，
        // 故显式兜底（请求上下文里它必然已由中间件写入，这里只是防御性补全）
        requestId: outer.requestId ?? '',
        ...outer,
        dealerScope: scope ?? ALL_SCOPE,
        userId: outer.userId ?? userId,
      },
      () => next.handle(),
    );
  }
}
