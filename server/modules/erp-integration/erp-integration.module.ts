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
  // ✅ 已切换为真实 ERP 打通（迁移/改造详见 ERP 侧 #753 与本文件历史注释）：
  //    ErpIntegrationService 的**上下行全部**统一走 RealErpAdapter ——
  //      下行 get*  : 直连 ERP 库（ERP_DATABASE_URL，默认 postgres://erp:erp@localhost:5434/erp_db）
  //      上行 receive*: 真实 HTTP 推送 ERP 接收端（ERP_UPSTREAM_BASE_URL + ERP_UPSTREAM_TOKEN）
  //    MockErpService 仅保留在 providers 中供 4 个 *.spec.ts 单测使用，
  //    **生产路径已无任何引用**（可用 grep mockErpService 确认为 0）。
  //
  // ⚠ PromotionSyncService 必须保留：ErpIntegrationService 的 promotions 分支
  //   真的会调它（原来只取 count）。少了这一行，Nest 启动即报 NEST_MISSING_DEPENDENCY。
  providers: [ErpIntegrationService, MockErpService, RealErpAdapter, PromotionSyncService],
  exports: [ErpIntegrationService, RealErpAdapter, PromotionSyncService],
})
export class ErpIntegrationModule {}
