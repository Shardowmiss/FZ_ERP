import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { AuthModule } from '../auth/auth.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';

@Module({
  imports: [AuthModule, ErpIntegrationModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
