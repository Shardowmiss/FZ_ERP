import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { RetailModule } from '../retail/retail.module';
import { PricingModule } from '../pricing/pricing.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [RbacModule, RetailModule, PricingModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
