import { Module } from '@nestjs/common';
import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';
import { AuthModule } from '../auth/auth.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';

@Module({
  imports: [AuthModule, ErpIntegrationModule],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
