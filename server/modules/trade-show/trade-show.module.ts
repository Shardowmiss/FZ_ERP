import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SystemModule } from '../system/system.module';
import { TradeShowController } from './trade-show.controller';
import { TradeShowService } from './trade-show.service';
import { PreOrderController } from './pre-order.controller';
import { PreOrderService } from './pre-order.service';
import { AllocationController } from './allocation.controller';
import { AllocationService } from './allocation.service';

@Module({
  imports: [InventoryModule, SystemModule],
  controllers: [
    AllocationController,
    PreOrderController,
    TradeShowController,
  ],
  providers: [
    TradeShowService,
    PreOrderService,
    AllocationService,
  ],
  exports: [
    TradeShowService,
    PreOrderService,
    AllocationService,
  ],
})
export class TradeShowModule {}
