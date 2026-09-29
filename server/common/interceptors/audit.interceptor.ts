import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { OperationLogService } from '../../modules/system/operation-log/operation-log.service';
import { AUDIT_KEY, AuditMeta } from '../decorators/audit.decorator';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 全局审计拦截器。
 *
 * 设计目标（对应重新复盘报告 P2-新②：审计日志不全 + 写入失败被吞）：
 * 1. 全覆盖：默认对所有写操作（POST/PUT/PATCH/DELETE）自动记录，无需逐处手改；
 *    业务模块可用 @Audit('module') 补充语义、用 @Audit(skip=true) 排除噪音端点。
 * 2. 不阻断主流程：审计写入异步 fire-and-forget，失败仅降级告警（logger.warn），
 *    绝不回滚或拖慢业务响应。
 * 3. 独立于业务事务：在响应发出后才落库，业务事务回滚也不会连带丢失审计记录
 *    （这是相比“在业务事务内手动 create”的关键可靠性提升）。
 * 4. 抓取关键字段：操作人(userId)、IP、UA、模块、动作类型、业务对象ID、
 *    摘要、HTTP 状态码。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly operationLogService: OperationLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const method = (req.method || '').toUpperCase();
    if (!MUTATION_METHODS.has(method)) {
      return next.handle();
    }

    const meta: AuditMeta | undefined = this.reflector.get(AUDIT_KEY, context.getHandler());
    if (meta?.skip) {
      return next.handle();
    }

    const user = req.user;
    const userId = user?.id;
    const ip = this.getClientIp(req);
    const userAgent = req.headers?.['user-agent'];
    const path = req.url || req.originalUrl || '';
    const module = meta?.module || this.inferModule(path);
    const operationType = this.mapOperation(method);
    const statusCode = res?.statusCode;
    const summary = meta?.summary || `${method} ${path}`;

    return next.handle().pipe(
      tap({
        next: (response: any) => {
          const objectId = this.extractObjectId(response);
          this.fire({
            userId,
            module,
            operationType,
            objectId,
            summary: statusCode ? `${summary} → ${statusCode}` : summary,
            ip,
            userAgent,
          });
        },
        error: (err: any) => {
          // 业务失败也记录一次（失败尝试同样需要可审计）
          this.fire({
            userId,
            module,
            operationType: `${operationType}_error`,
            objectId: undefined,
            summary: `${summary} (error: ${err?.status ?? err?.message ?? 'unknown'})`,
            ip,
            userAgent,
          });
        },
      }),
    );
  }

  /** 异步非阻塞写入：审计失败不影响业务，仅降级告警。 */
  private fire(dto: {
    userId?: string;
    module?: string;
    operationType?: string;
    objectId?: string;
    summary: string;
    ip?: string;
    userAgent?: string;
  }): void {
    this.operationLogService
      .create(dto)
      .catch((e: any) => {
        this.logger.warn(`审计日志写入失败（已降级，不影响业务）: ${e?.message ?? e}`);
      });
  }

  private getClientIp(req: any): string | undefined {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      return xff.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress;
  }

  private mapOperation(method: string): string {
    switch (method) {
      case 'POST':
        return 'create';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return method.toLowerCase();
    }
  }

  /** 从 /api/<module>/... 路径推断模块标识。 */
  private inferModule(path: string): string {
    const cleaned = path.replace(/^\/+api\//i, '').replace(/^\/+/, '');
    const seg = cleaned.split('/')[0] || 'unknown';
    return seg.replace(/[_\/]/g, '-');
  }

  /** 从常见响应结构中提取业务对象ID。 */
  private extractObjectId(response: any): string | undefined {
    if (!response || typeof response !== 'object') return undefined;
    if (typeof response.id === 'string' && response.id) return response.id;
    if (response.data && typeof response.data === 'object' && typeof response.data.id === 'string') {
      return response.data.id;
    }
    if (response.result && typeof response.result === 'object' && typeof response.result.id === 'string') {
      return response.result.id;
    }
    if (response.id !== undefined && response.id !== null) return String(response.id);
    return undefined;
  }
}
