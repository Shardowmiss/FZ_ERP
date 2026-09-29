import { Module } from '@nestjs/common';
import { ErpIntegrationController } from './erp-integration.controller';
import { ErpIntegrationService } from './erp-integration.service';
import { MockErpService } from './mock-erp.service';
import { RealErpAdapter } from './real-erp.adapter';
import { PromotionSyncService } from './promotion-sync.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ErpIntegrationController],
  // 默认使用 MockErpService（硬编码假数据，离线可用）。
  // 联调真实 ERP(TEST-P) 时，将下方 MockErpService 替换为 RealErpAdapter，
  // 并把 ErpIntegrationService 构造函数中的 MockErpService 改为 RealErpAdapter 即可，
  // 同步逻辑（syncDownstream / receive*）无需任何改动。
  //
  // ⚠ PromotionSyncService 是 Wave 4-C 新增：ErpIntegrationService 的 promotions
  //   分支现在真的会调它（原来只取 count）。少了这一行，Nest 在启动时解析
  //   ErpIntegrationService 依赖就会直接报 NEST_MISSING_DEPENDENCY。
  providers: [ErpIntegrationService, MockErpService, RealErpAdapter, PromotionSyncService],
  exports: [ErpIntegrationService, MockErpService, RealErpAdapter, PromotionSyncService],
})
export class ErpIntegrationModule {}
