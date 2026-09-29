import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { FinanceModule } from '../finance/finance.module';
import { SystemModule } from '../system/system.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionBomController } from './bom/bom.controller';
import { MaterialPurchaseOrderController } from './material-purchase/material-purchase-order.controller';
import { MaterialPurchaseOrderService } from './material-purchase/material-purchase-order.service';
import { MaterialPurchaseInboundController } from './material-purchase/material-purchase-inbound.controller';
import { MaterialPurchaseInboundService } from './material-purchase/material-purchase-inbound.service';
import { MrpController } from './mrp/mrp.controller';
import { MrpService } from './mrp/mrp.service';
import { CostController } from './cost/cost.controller';
import { CostService } from './cost/cost.service';
import { WorkOrderController } from './work-order/work-order.controller';
import { WorkOrderService } from './work-order/work-order.service';
import { MaterialIssueController } from './material-issue/material-issue.controller';
import { MaterialIssueService } from './material-issue/material-issue.service';
import { FinishReceiptController } from './finish-receipt/finish-receipt.controller';
import { FinishReceiptService } from './finish-receipt/finish-receipt.service';

@Module({
  imports: [BomModule, FinanceModule, SystemModule, InventoryModule],
  controllers: [
    ProductionBomController,
    MaterialPurchaseOrderController,
    MaterialPurchaseInboundController,
    MrpController,
    CostController,
    WorkOrderController,
    MaterialIssueController,
    FinishReceiptController,
  ],
  providers: [
    MaterialPurchaseOrderService,
    MaterialPurchaseInboundService,
    MrpService,
    CostService,
    WorkOrderService,
    MaterialIssueService,
    FinishReceiptService,
  ],
})
export class ProductionModule {}
