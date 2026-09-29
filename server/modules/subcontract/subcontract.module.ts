import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SystemModule } from '../system/system.module';
import { SubcontractController } from './subcontract.controller';
import { SubcontractService } from './subcontract.service';

@Module({
  imports: [InventoryModule, SystemModule],
  controllers: [SubcontractController],
  providers: [SubcontractService],
  exports: [SubcontractService],
})
export class SubcontractModule {}
