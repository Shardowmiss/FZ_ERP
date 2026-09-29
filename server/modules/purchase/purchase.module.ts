import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SystemModule } from '../system/system.module';
import { PurchaseOrderController } from './order/purchase-order.controller';
import { PurchaseOrderService } from './order/purchase-order.service';
import { PurchaseInboundController } from './inbound/purchase-inbound.controller';
import { PurchaseInboundService } from './inbound/purchase-inbound.service';
import { PurchaseReturnController } from './return/purchase-return.controller';
import { PurchaseReturnService } from './return/purchase-return.service';
import { GarmentPurchaseOrderController } from './garment-order/garment-purchase-order.controller';
import { GarmentPurchaseOrderService } from './garment-order/garment-purchase-order.service';
import { GarmentPurchaseInboundController } from './garment-inbound/garment-purchase-inbound.controller';
import { GarmentPurchaseInboundService } from './garment-inbound/garment-purchase-inbound.service';
import { GarmentPurchaseReturnController } from './garment-return/garment-purchase-return.controller';
import { GarmentPurchaseReturnService } from './garment-return/garment-purchase-return.service';
import { PurchaseReconciliationController } from './reconciliation/reconciliation.controller';
import { PurchaseReconciliationService } from './reconciliation/reconciliation.service';

@Module({
  imports: [FinanceModule, InventoryModule, SystemModule],
  controllers: [
    PurchaseOrderController,
    PurchaseInboundController,
    PurchaseReturnController,
    GarmentPurchaseOrderController,
    GarmentPurchaseInboundController,
    GarmentPurchaseReturnController,
    PurchaseReconciliationController,
  ],
  providers: [
    PurchaseOrderService,
    PurchaseInboundService,
    PurchaseReturnService,
    GarmentPurchaseOrderService,
    GarmentPurchaseInboundService,
    GarmentPurchaseReturnService,
    PurchaseReconciliationService,
  ],
  exports: [
    PurchaseOrderService,
    PurchaseInboundService,
    PurchaseReturnService,
    GarmentPurchaseOrderService,
    GarmentPurchaseInboundService,
    GarmentPurchaseReturnService,
    PurchaseReconciliationService,
  ],
})
export class PurchaseModule {}
