import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SystemModule } from '../system/system.module';
import { RbacModule } from '../rbac/rbac.module';
import { RetailController } from './retail.controller';
import { RetailService } from './retail.service';
import { RetailReportController } from './retail-report.controller';
import { RetailReportService } from './retail-report.service';
import { UniqueCodeModule } from '../unique-code/unique-code.module';

@Module({
  imports: [FinanceModule, InventoryModule, SystemModule, RbacModule, UniqueCodeModule],
  controllers: [RetailController, RetailReportController],
  providers: [RetailService, RetailReportService],
  exports: [RetailService, RetailReportService],
})
export class RetailModule {}
