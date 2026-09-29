import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PromotionPushService } from './promotion-push.service';

@Module({
  imports: [RbacModule],
  controllers: [PricingController],
  providers: [PricingService, PromotionPushService],
  exports: [PricingService, PromotionPushService],
})
export class PricingModule {}
