/**
 * 从后端异常中提取「具体可读」的错误消息，失败时回退到兜底文案。
 *
 * 背景：此前前端各页面 catch 后直接 toast('保存失败'/'删除失败') 等硬编码文案，
 * 把后端返回的具體原因（如「该供应商已存在应付单据，不允许删除」）丢弃了，
 * 业务人员看到笼统报错以为系统故障，运维也无法从文案定位问题。
 *
 * 后端响应结构（见 GlobalExceptionFilter）：{ error: { code, message, details, ... } }，
 * 位于 axios error.response.data。
 */
export function errMsg(e: unknown, fallback = '操作失败'): string {
  const err = e as
    | {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
      }
    | undefined;

  const serverMsg = err?.response?.data?.error?.message;
  if (typeof serverMsg === 'string' && serverMsg.trim().length > 0) {
    return serverMsg;
  }
  if (typeof err?.message === 'string' && err.message.trim().length > 0) {
    return err.message;
  }
  return fallback;
}
