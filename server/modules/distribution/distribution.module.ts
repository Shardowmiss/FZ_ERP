import { Module } from '@nestjs/common';
import { PurchaseModule } from '../purchase/purchase.module';
import { RbacModule } from '../rbac/rbac.module';
import { DistributionMirrorService } from './distribution-mirror.service';
import { DistributionPortalService } from './distribution-portal.service';
import { DistributionPortalController } from './distribution-portal.controller';

/**
 * 分销模块：承载多级分销的两大能力。
 * 1) 镜像引擎（DistributionMirrorService）：上游销售/退货记账后自动生成下级采购单/退货单。
 * 2) 分销门户（DistributionPortalService + Controller）：分销节点用户登录后，
 *    仅能看到自己节点（及下级子树）的采购单 / 采购退货单。
 *
 * 依赖 PurchaseModule（成衣采购单 / 采购退货单服务）与 RbacModule（用户解析、权限判定）。
 */
@Module({
  imports: [PurchaseModule, RbacModule],
  controllers: [DistributionPortalController],
  providers: [DistributionMirrorService, DistributionPortalService],
  exports: [DistributionMirrorService, DistributionPortalService],
})
export class DistributionModule {}
