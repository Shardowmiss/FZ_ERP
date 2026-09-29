import { Module } from '@nestjs/common';
import { OmnichannelController } from './omnichannel.controller';
import { OmnichannelService } from './omnichannel.service';

@Module({
  controllers: [OmnichannelController],
  providers: [OmnichannelService],
  exports: [OmnichannelService],
})
export class OmnichannelModule {}
