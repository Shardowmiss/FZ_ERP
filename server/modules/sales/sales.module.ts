import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { AuthModule } from '../auth/auth.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { MembersModule } from '../members/members.module';

@Module({
  // MembersModule → S3 会员钱包上行：本模块要往同一张 outbox 写事件。
  // MembersModule 只依赖 AuthModule，与 SalesModule 无反向引用，不构成循环依赖。
  imports: [AuthModule, ErpIntegrationModule, PromotionsModule, MembersModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
