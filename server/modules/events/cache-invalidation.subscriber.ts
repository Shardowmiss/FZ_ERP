import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { EventBusService } from './event-bus.service';
import { invalidate } from '@server/common/cache';

/**
 * 事件总线首个落地集成（W2-1 安全首切片）：把「缓存失效」从同步调用改为事件驱动。
 *
 * 背景：P1-c ① 之后 pricing.service 在全部写路径统一调用 invalidateActiveCache() 同步
 * 删除 pricing:activeLists / pricing:activePromos 缓存键。该调用是「写路径里的跨模块副作用」，
 * 引入事件总线后改为 publish('cache.invalidate')，由本订阅者异步执行真正的失效。
 *
 * 语义变化（已确认可接受）：失效从「同步」变为「异步（秒级，LISTEN 唤醒或 ≤轮询周期）」。
 * 当前缓存为单实例内存存储（app.module 的 CacheModule；多实例需换 Redis 存储），故本实例
 * 派发即失效本实例缓存，与既有「单实例内存缓存」约束一致。
 *
 * 幂等：dispatched 事件只派发一次；invalidate() 自身对不存在的键静默，可重复安全调用。
 */
@Injectable()
export class CacheInvalidationSubscriber implements OnModuleInit {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.eventBus.registerHandler('cache.invalidate', async (payload: any) => {
      const keys: string[] = Array.isArray(payload?.keys) ? payload.keys : [];
      if (keys.length) {
        await invalidate(this.cacheManager, ...keys);
      }
    });
  }
}
