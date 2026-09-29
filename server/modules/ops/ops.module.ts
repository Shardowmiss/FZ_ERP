import { Module } from '@nestjs/common';
import { OpsService } from './ops.service';
import { OpsController } from './ops.controller';

/**
 * 系统运维模块：数据质量校验引擎。
 * 提供批量数据校验（商品资源、库存对账、低价、异常购买、积分、负库存等）
 * 与可下载的校验报告(CSV)。
 */
@Module({
  controllers: [OpsController],
  providers: [OpsService],
  exports: [OpsService],
})
export class OpsModule {}
