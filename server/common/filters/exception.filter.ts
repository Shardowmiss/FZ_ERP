import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import { HTTP_STATUS_TO_RESPONSE_CODE_MAP, ResponseCode } from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';
import { emitLog } from '../logging/logger';
import { RequestContext } from '../context/request-context';
import { translateDbConstraintError, dbErrorSqlState } from '../errors/db-constraint';

// 全局异常过滤器，用于捕获所有未处理的异常
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<{ method?: string; originalUrl?: string } & Record<string, any>>();
    const response = http.getResponse<Response>();
    // 回写请求 ID：客户端报故障时给出该 ID，即可在日志平台上把这次 500 的全部上下文捞出来。
    // 三级兜底（响应头 → 请求头 → 请求上下文）：
    // 正常 HTTP 请求里三者必有其一；但异常过滤器也可能在**未经中间件的路径**上被调用
    //（直接单元测试、或 filter 被挂载到非请求上下文），此时 ALS 里没有 requestId，
    // 若不从 HTTP 头兜底，这次故障的日志就会变成无法关联的孤儿记录。
    const reqHeaders = (req && req.headers) || {};
    const requestId =
      (response.getHeader('X-Request-Id') as string | undefined) ||
      RequestContext.getRequestId() ||
      (reqHeaders['x-request-id'] as string | undefined);

    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    if (exception instanceof BusinessException) {
      // 业务异常：属可预期的规则拒绝（余额不足 / 越权 / 状态不匹配），不是故障，记 info 即可。
      // 此前该分支完全不打日志，导致「业务规则触发了多少次」在日志里是盲区。
      httpStatus = exception.httpStatus;
      emitLog('info', 'business.rejected', {
        // 显式带 requestId：emitLog 默认从请求上下文读取，但此处已在过滤器里解析过
        // 「响应头→请求头」兜底链路（异常可能被过滤器直接调用而不经过中间件），显式传入保证不丢
        requestId,
        code: exception.code,
        message: exception.message,
        httpStatus,
      });
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          requestId: requestId ?? undefined,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();
      const resObj =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? (exceptionResponse as Record<string, unknown>)
          : null;

      // 校验错误归一：全局 ValidationPipe 抛出的 BadRequestException 中，
      // exceptionResponse.message 为标准 class-validator 约束信息数组
      // （如 ["skuId 必须为字符串","items.0.quantity 必须为整数"]）。
      // 在此统一归集为 fieldErrors（字段路径 -> 错误消息列表）并给出聚合 message。
      let fieldErrors: Record<string, string[]> | undefined;
      let message = typeof exceptionResponse === 'string' ? exceptionResponse : exception.message;
      if (exception instanceof BadRequestException && resObj) {
        const msgs = resObj['message'];
        if (Array.isArray(msgs)) {
          const fe: Record<string, string[]> = {};
          for (const m of msgs as string[]) {
            const field = m.split(/\s+/)[0] || '';
            (fe[field] ||= []).push(m);
          }
          fieldErrors = Object.keys(fe).length > 0 ? fe : undefined;
          message = (msgs as string[]).join('；') || exception.message;
        }
      }

      errorResponse = {
        error: {
          code: fieldErrors ? ResponseCode.VALIDATION_ERROR : HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message,
          details: resObj ? JSON.stringify(resObj) : undefined,
          fieldErrors,
          requestId: requestId ?? undefined,
          timestamp: Date.now(),
        },
      };
    } else {
      // 非 HttpException / 非 BusinessException 的其余异常：这里统一尝试翻译数据库约束冲突。
      // 注意：drizzle 会把底层 PostgresError 包成 DrizzleQueryError，真实 SQLSTATE(code/detail/
      // constraint_name) 在 `.cause` 上，translateDbConstraintError 内部已做解包兼容。
      // 优先级：约束冲突翻译（23503/23505/23514/23502）→ 非法类型 22P02 → 兜底 500。
      const dbErr = translateDbConstraintError(exception);
      if (dbErr) {
        // 数据库约束冲突（外键 23503 / 唯一 23505 / 检查 23514 / 非空 23502 等）：
        // 此前会被当作 500「服务器内部错误」抛给前端，业务人员误以为系统故障、运维也无法定位。
        // 这里翻译成具体中文，并降级为 4xx（CONFLICT / VALIDATION_ERROR），记 info 便于运维定位。
        httpStatus = dbErr.httpStatus;
        emitLog('info', 'db.constraint', {
          requestId,
          code: dbErr.code,
          message: dbErr.message,
          details: dbErr.details,
        });
        errorResponse = {
          error: {
          code: dbErr.code,
          message: dbErr.message,
          details: dbErr.details,
          requestId: requestId ?? undefined,
          timestamp: Date.now(),
          },
        };
      } else if (typeof exception === 'object' && exception !== null && dbErrorSqlState(exception) === '22P02') {
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
        // 未知异常：对外只暴露安全信息，完整信息写入服务端结构化日志。
        httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
        const isDev = process.env.NODE_ENV === 'development';
        const err = exception as Error;
        emitLog('error', 'unhandled', {
          requestId,
          err: err ?? { raw: String(exception) },
          httpStatus,
        });
        response.locals = response.locals || {};
        response.locals.lastError = err?.message ?? String(exception);
        errorResponse = {
          error: {
            code: ResponseCode.INTERNAL_ERROR,
            message: '服务器内部错误',
            ...(isDev
              ? {
                  stack: err?.stack,
                  cause: err?.cause as string,
                }
              : {}),
            ...(requestId ? { requestId } : {}),
            timestamp: Date.now(),
          },
        };
      }
    }

    if (requestId) {
      response.setHeader('X-Request-Id', requestId);
    }
    response.status(httpStatus).json(errorResponse);
  }
}
