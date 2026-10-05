import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * Wave 2-2 指标物化视图层。
 *
 * 非 @Global：仅本模块控制器消费 MetricsService（刷新调度内聚在 service 内）。
 * 若后续 Dashboard 模块需直接触发刷新，可在此 export MetricsService。
 */
@Module({
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
