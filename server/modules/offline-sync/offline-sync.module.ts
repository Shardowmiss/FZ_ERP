import { Module } from '@nestjs/common';
import { OfflineSyncController } from './offline-sync.controller';
import { OfflineSyncService } from './offline-sync.service';
import { SalesModule } from '../sales/sales.module';
import { ReturnsModule } from '../returns/returns.module';
import { MembersModule } from '../members/members.module';
import { StockModule } from '../stock/stock.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SalesModule, ReturnsModule, MembersModule, StockModule, AuthModule],
  controllers: [OfflineSyncController],
  providers: [OfflineSyncService],
})
export class OfflineSyncModule {}
