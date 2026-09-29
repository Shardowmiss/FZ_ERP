import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { AuthModule } from '../auth/auth.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';

@Module({
  imports: [AuthModule, ErpIntegrationModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
