import { SetMetadata } from '@nestjs/common';

/**
 * 审计元数据键。
 */
export const AUDIT_KEY = 'audit';

export interface AuditMeta {
  /** 业务模块标识（如 'sales-order'）。未指定时由拦截器从路由路径推断。 */
  module?: string;
  /** 自定义摘要模板（可选）。未指定时自动生成 `${METHOD} ${path}`。 */
  summary?: string;
  /** 是否禁用该端点的自动审计（如高频心跳、文件上传等噪音端点）。 */
  skip?: boolean;
}

/**
 * 标记一个接口需要被审计拦截器记录操作日志。
 *
 * 拦截器默认覆盖所有写操作（POST/PUT/PATCH/DELETE）并自动落库；
 * 此装饰器用于补充语义信息（module / summary）或显式跳过（skip）。
 *
 * 用法：
 *   @Audit('sales-order', '审核销售订单')
 *   async audit(@Param('id') id: string) {}
 *
 *   @Audit(undefined, undefined, true) // 跳过自动审计
 *   async heartbeat() {}
 */
export const Audit = (module?: string, summary?: string, skip?: boolean): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    const meta: AuditMeta = { module, summary, skip };
    SetMetadata(AUDIT_KEY, meta)(target, propertyKey, descriptor);
  };
};
