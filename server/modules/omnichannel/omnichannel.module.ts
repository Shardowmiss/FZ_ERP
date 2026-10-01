import { Module } from '@nestjs/common';
import { OmnichannelController } from './omnichannel.controller';
import { OmnichannelService } from './omnichannel.service';
import { MembersModule } from '../members/members.module';

@Module({
  // MembersModule → S3 会员钱包上行（全渠道积分也要走同一张 outbox）
  imports: [MembersModule],
  controllers: [OmnichannelController],
  providers: [OmnichannelService],
  exports: [OmnichannelService],
})
export class OmnichannelModule {}
