// 错误统一响应
export interface ApiErrorResponse {
  /** 错误详情 */
  error: {
    /** 错误代码 */
    code: string;
    /** 错误消息 */
    message: string;
    /** 错误详情 */
    details?: string;
    /** 字段验证错误 */
    fieldErrors?: Record<string, string[]>;
    /** 调用栈（仅开发环境） */
    stack?: string;
    /** 错误原因 */
    cause?: string;
    /** 错误发生时间 */
    timestamp?: number;
    /** 检索键：与 details 同值，日志平台可直接按该 ID 捞出本次故障的全部上下文 */
    requestId?: string;
  };
}

