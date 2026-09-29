import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { PosReceiverController } from './pos-receiver.controller';
import { PosReceiverService } from './pos-receiver.service';

@Module({
  imports: [RbacModule],
  controllers: [PosReceiverController],
  providers: [PosReceiverService],
  exports: [PosReceiverService],
})
export class PosReceiverModule {}
