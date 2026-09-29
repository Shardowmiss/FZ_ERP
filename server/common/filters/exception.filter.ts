import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { BusinessException } from '../interfaces/exception.interface';
import { HTTP_STATUS_TO_RESPONSE_CODE_MAP, ResponseCode } from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';
import { emitLog } from '../logging/logger';
import { RequestContext } from '../logging/request-context';

// 全局异常过滤器，用于捕获所有未处理的异常
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
     
    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();

      errorResponse = {
        error: {
          code: HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
          details: typeof exceptionResponse === 'object' ? JSON.stringify(exceptionResponse) : undefined,
          timestamp: Date.now(),
        },
      };
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === '22P02'
    ) {
      // Postgres invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
      // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
      httpStatus = HttpStatus.NOT_FOUND;
      errorResponse = {
        error: {
          code: ResponseCode.NOT_FOUND,
          message: '资源不存在',
          timestamp: Date.now(),
        },
      };
    } else {
      // 未知异常：对外只暴露安全信息 + 可关联的 errorId，完整堆栈仅写入服务端日志。
      //
      // 改造前：errorId 是**每次现生成**的 randomUUID，既不能与请求关联，也无法与 ERP 侧对齐，
      // 同一个故障在网关/POS/ERP 三处日志里是三个互不相干的 ID。现在 errorId 直接复用
      // 请求上下文里的 requestId（缺失时兜底生成），响应头回写同一值，
      // POS→ERP 的上行链路可用 traceId 串起来。
      const err = exception instanceof Error ? exception : new Error(String(exception));
      // 三级兜底（响应头 → 请求上下文 → 请求头 → 兜底生成）：
      // 正常 HTTP 请求里中间件已把 requestId 写进响应头；但异常过滤器也可能在不经过
      // 中间件的路径上被调用（直接单测 / 定时任务），此时若不回溯 HTTP 头，
      // 本次故障的日志就会变成无法关联的孤儿记录。
      const reqHeaders = (ctx.getRequest<{ headers?: Record<string, string | string[]> }>()?.headers) ?? {};
      const headerId = response.getHeader('X-Request-Id');
      const errorId =
        (typeof headerId === 'string' && headerId) ||
        RequestContext.getRequestId() ||
        (reqHeaders['x-request-id'] as string | undefined) ||
        randomUUID();

      response.setHeader('X-Request-Id', errorId);
      // 显式带 requestId：emitLog 默认从请求上下文读取，而过滤器也可能在未经中间件的
      // 路径上被调用（直接单测 / 非请求上下文），此时上下文里没有 ID，不显式传入会成孤儿记录
      emitLog('error', 'unhandled', { requestId: errorId, err, httpStatus: HttpStatus.INTERNAL_SERVER_ERROR });
      // 供访问日志在响应结束时附带错误摘要
      response.locals = response.locals || {};
      response.locals.lastError = err.message;

      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '服务器内部错误，请稍后重试或凭错误号联系运维',
          details: errorId,
          // 与 details 同值的检索键：日志平台可直接按该 ID 捞出本次故障的全部上下文
          requestId: errorId,
          timestamp: Date.now(),
        },
      };
    }

    response.status(httpStatus).json(errorResponse);
  }
}
