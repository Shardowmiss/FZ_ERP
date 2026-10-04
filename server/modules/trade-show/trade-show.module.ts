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
    // 必须先注册 ThemeController：其前缀 api/trade-show/theme 与 TradeShowController
    // 的 @Get(':id') 在 GET /api/trade-show/theme 上冲突（id='theme'）。Express 按注册顺序
    // 匹配，ThemeController 在前才能命中其 @Get()（精确路由），否则被 :id 抢先 → 404。
    ThemeController,
    TradeShowController,
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
