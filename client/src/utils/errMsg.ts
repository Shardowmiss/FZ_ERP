/**
 * 后端异常 → 可诊断的用户提示。
 *
 * 背景：此前大量页面 catch 后直接 toast('加载失败') 这类硬编码文案，把后端返回的
 * 具体原因（如「该供应商已存在应付单据，不允许删除」）丢弃了。业务人员看到笼统报错
 * 既不知原因也无法上报，运维同样无法从文案定位问题。
 *
 * 本模块提供三层能力：
 *   1. parseErr()  —— 把异常归类（网络/超时/权限/不存在/服务端/业务…）并取出状态码与错误码
 *   2. errMsg()    —— 生成「用户可读且可上报」的一句话提示（签名向后兼容）
 *   3. errDetail() —— 生成可复制的排查详情（含 method/url/status/code），便于用户贴给支持人员
 *
 * 后端响应结构（见 GlobalExceptionFilter）：{ error: { code, message, details, ... } }，
 * 位于 axios error.response.data；部分接口也可能直接返回 { message }，两种都兼容。
 */

export type ErrKind =
  | 'network' // 无响应：断网 / DNS / 连接被拒
  | 'timeout' // 请求超时
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'notfound' // 404
  | 'server' // 5xx
  | 'business' // 4xx 且服务端给了明确业务原因
  | 'unknown';

export interface ErrInfo {
  kind: ErrKind;
  /** HTTP 状态码（无响应时为 undefined） */
  status?: number;
  /** 服务端业务错误码 */
  code?: string;
  /** 服务端返回的原始 message */
  serverMessage?: string;
  /** 面向用户的可读提示 */
  message: string;
  /** 请求方法与路径，用于排查 */
  method?: string;
  url?: string;
}

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: { error?: { code?: string; message?: string }; message?: string };
  };
  request?: unknown;
  code?: string;
  message?: string;
  config?: { method?: string; url?: string };
}

function pickServerMessage(err: AxiosLikeError): string | undefined {
  const d = err?.response?.data;
  const candidates = [d?.error?.message, d?.message];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

/** 把任意异常归类并提取诊断信息 */
export function parseErr(e: unknown): ErrInfo {
  const err = (e || {}) as AxiosLikeError;
  const serverMessage = pickServerMessage(err);
  const status = err.response?.status;
  const code = err.response?.data?.error?.code;
  const method = err.config?.method?.toUpperCase();
  const url = err.config?.url;

  // 1) 有响应：按状态码分类
  if (typeof status === 'number') {
    if (status === 401) {
      return {
        kind: 'unauthorized',
        status,
        code,
        serverMessage,
        message: '登录状态已失效，请重新登录后再操作（401）',
        method,
        url,
      };
    }
    if (status === 403) {
      return {
        kind: 'forbidden',
        status,
        code,
        serverMessage,
        message: serverMessage
          ? `没有操作权限（403）：${serverMessage}`
          : '你没有该操作的权限，请联系管理员开通（403）',
        method,
        url,
      };
    }
    if (status === 404) {
      return {
        kind: 'notfound',
        status,
        code,
        serverMessage,
        message: serverMessage
          ? `数据不存在（404）：${serverMessage}`
          : '请求的数据不存在或已被删除（404）',
        method,
        url,
      };
    }
    if (status >= 500) {
      return {
        kind: 'server',
        status,
        code,
        serverMessage,
        message: serverMessage
          ? `服务异常（${status}）：${serverMessage}`
          : `服务暂时不可用（${status}），请稍后重试或联系管理员`,
        method,
        url,
      };
    }
    // 其余 4xx：视为业务校验失败，服务端 message 最有价值
    return {
      kind: 'business',
      status,
      code,
      serverMessage,
      message: serverMessage || `操作未通过校验（${status}）`,
      method,
      url,
    };
  }

  // 2) 无响应：网络层问题
  const msg = typeof err.message === 'string' ? err.message : '';
  if (err.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
    return { kind: 'timeout', message: '请求超时，请检查网络后重试', method, url };
  }
  if (err.request || /network|Failed to fetch|ERR_NETWORK/i.test(msg)) {
    return { kind: 'network', message: '网络连接失败，请检查网络后重试', method, url };
  }
  if (msg.trim().length > 0) {
    return { kind: 'unknown', message: msg.trim(), method, url };
  }
  return { kind: 'unknown', message: '操作失败', method, url };
}

/**
 * 取用户可读的错误提示。
 * @param e catch 到的异常
 * @param fallback 兜底文案（当既无服务端原因又无明确分类时使用）
 */
export function errMsg(e: unknown, fallback = '操作失败'): string {
  const info = parseErr(e);
  // 完全无法诊断时才回退到兜底，避免又变成「看不懂的笼统报错」
  if (info.kind === 'unknown' && !info.serverMessage) return fallback;
  return info.message;
}

/** 生成可复制的排查详情（用户可整段贴给支持人员） */
export function errDetail(e: unknown): string {
  const i = parseErr(e);
  return [
    `错误类型: ${i.kind}`,
    i.status ? `HTTP 状态: ${i.status}` : null,
    i.code ? `错误码: ${i.code}` : null,
    i.method || i.url ? `请求: ${i.method ?? ''} ${i.url ?? ''}` : null,
    i.serverMessage ? `服务端信息: ${i.serverMessage}` : null,
    `提示: ${i.message}`,
  ]
    .filter(Boolean)
    .join('\n');
}
