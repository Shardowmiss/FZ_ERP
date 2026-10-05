import { Module, Global } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { CacheInvalidationSubscriber } from './cache-invalidation.subscriber';

/**
 * Wave 2-1 纯 PG 事件总线。
 *
 * 设计为 @Global()：业务模块（如 pricing）只需在构造函数注入 EventBusService，无需 import 本模块。
 * EventBusService 启动时做 Leader 选举（pg_try_advisory_lock）+ LISTEN domain_event 唤醒 +
 * 周期轮询兜底；CacheInvalidationSubscriber 注册首个事件处理器（缓存失效）。
 *
 * 后续新增事件类型（如 member.merged / order.settled 下行）只需：① 在对应业务模块写路径
 * `eventBus.publish(...)`；② 注册一个 handler（这里是 subscriber 模式，或用 registerHandler）。
 * 表结构（domain_event）保持不变，零新基础设施。
 */
@Global()
@Module({
  providers: [EventBusService, CacheInvalidationSubscriber],
  exports: [EventBusService],
})
export class EventsModule {}
