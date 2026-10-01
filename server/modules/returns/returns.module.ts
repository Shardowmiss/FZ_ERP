import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { AuthModule } from '../auth/auth.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { MembersModule } from '../members/members.module';

@Module({
  // MembersModule → S3 会员钱包上行（退货回冲也要写同一张 outbox）
  imports: [AuthModule, ErpIntegrationModule, MembersModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
