import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SystemModule } from '../system/system.module';
import { DistributionModule } from '../distribution/distribution.module';
import { SalesOrderController } from './order/sales-order.controller';
import { SalesOrderService } from './order/sales-order.service';
import { SalesOutboundController } from './outbound/sales-outbound.controller';
import { SalesOutboundService } from './outbound/sales-outbound.service';
import { SalesReturnController } from './return/sales-return.controller';
import { SalesReturnService } from './return/sales-return.service';
import { SalesReconciliationController } from './reconciliation/reconciliation.controller';
import { SalesReconciliationService } from './reconciliation/reconciliation.service';

@Module({
  imports: [FinanceModule, InventoryModule, SystemModule, DistributionModule],
  controllers: [
    SalesOrderController,
    SalesOutboundController,
    SalesReturnController,
    SalesReconciliationController,
  ],
  providers: [
    SalesOrderService,
    SalesOutboundService,
    SalesReturnService,
    SalesReconciliationService,
  ],
  exports: [
    SalesOrderService,
    SalesOutboundService,
    SalesReturnService,
    SalesReconciliationService,
  ],
})
export class SalesModule {}
