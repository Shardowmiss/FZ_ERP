import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { AuthModule } from '../auth/auth.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { PromotionsModule } from '../promotions/promotions.module';

@Module({
  imports: [AuthModule, ErpIntegrationModule, PromotionsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
