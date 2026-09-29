import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { SystemModule } from '../system/system.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InventoryQueryController } from './query/inventory-query.controller';
import { InventoryQueryService } from './query/inventory-query.service';
import { InventoryFlowController } from './flow/inventory-flow.controller';
import { InventoryFlowService } from './flow/inventory-flow.service';
import { InventoryInboundController } from './inbound/inventory-inbound.controller';
import { InventoryInboundService } from './inbound/inventory-inbound.service';
import { InventoryOutboundController } from './outbound/inventory-outbound.controller';
import { InventoryOutboundService } from './outbound/inventory-outbound.service';
import { InventoryTransferController } from './transfer/inventory-transfer.controller';
import { InventoryTransferService } from './transfer/inventory-transfer.service';
import { InventoryStocktakeController } from './stocktake/inventory-stocktake.controller';
import { InventoryStocktakeService } from './stocktake/inventory-stocktake.service';
import { InventoryWarningController } from './warning/inventory-warning.controller';
import { InventoryWarningService } from './warning/inventory-warning.service';
import { InventoryMobileController } from './mobile/inventory-mobile.controller';
import { InventoryMobileService } from './mobile/inventory-mobile.service';
import { InventoryReplenishController } from './replenish/inventory-replenish.controller';
import { InventoryReplenishService } from './replenish/inventory-replenish.service';
import { ReplenishPlanController } from './replenish-plan/replenish-plan.controller';
import { ReplenishPlanService } from './replenish-plan/replenish-plan.service';
import { ReplenishTemplateController } from './replenish-plan/replenish-template.controller';
import { ReplenishTemplateService } from './replenish-plan/replenish-template.service';
import { ReplenishSchedulerService } from './replenish-plan/replenish-scheduler.service';
import { StockService } from './stock/stock.service';

@Module({
  imports: [FinanceModule, SystemModule, AnalyticsModule],
  controllers: [
    InventoryQueryController,
    InventoryFlowController,
    InventoryInboundController,
    InventoryOutboundController,
    InventoryTransferController,
    InventoryStocktakeController,
    InventoryWarningController,
    InventoryMobileController,
    InventoryReplenishController,
    ReplenishPlanController,
    ReplenishTemplateController,
  ],
  providers: [
    InventoryQueryService,
    InventoryFlowService,
    InventoryInboundService,
    InventoryOutboundService,
    InventoryTransferService,
    InventoryStocktakeService,
    InventoryWarningService,
    InventoryMobileService,
    InventoryReplenishService,
    ReplenishPlanService,
    ReplenishTemplateService,
    ReplenishSchedulerService,
    StockService,
  ],
  exports: [
    InventoryQueryService,
    InventoryFlowService,
    InventoryInboundService,
    InventoryOutboundService,
    InventoryTransferService,
    InventoryStocktakeService,
    InventoryWarningService,
    InventoryMobileService,
    InventoryReplenishService,
    StockService,
  ],
})
export class InventoryModule {}
