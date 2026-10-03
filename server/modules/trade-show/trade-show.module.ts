import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SystemModule } from '../system/system.module';
import { TradeShowController } from './trade-show.controller';
import { TradeShowService } from './trade-show.service';
import { ThemeController } from './theme.controller';
import { ThemeService } from './theme.service';
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
    ThemeController,
  ],
  providers: [
    TradeShowService,
    ThemeService,
    PreOrderService,
    AllocationService,
  ],
  exports: [
    TradeShowService,
    ThemeService,
    PreOrderService,
    AllocationService,
  ],
})
export class TradeShowModule {}
