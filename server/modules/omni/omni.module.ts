import { Module } from '@nestjs/common';
import { OmniService } from './omni.service';
import { OmniController } from './omni.controller';
import { InventoryModule } from '@server/modules/inventory/inventory.module';
import { SystemModule } from '@server/modules/system/system.module';

@Module({
  imports: [InventoryModule, SystemModule],
  providers: [OmniService],
  controllers: [OmniController],
  exports: [OmniService],
})
export class OmniModule {}
