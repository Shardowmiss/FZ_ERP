import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * 可观测性基线模块（W1-1）：仅承载 `/api/health` 与 `/api/health/metrics` 两个公开探针，
 * 不依赖任何业务模块，避免引入循环依赖。
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
