import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
// S3：会员钱包入账能力由 MemberModule 提供（ERP 作为会员钱包唯一账本方）
import { MemberModule } from '../member/member.module';
import { PosReceiverController } from './pos-receiver.controller';
import { PosReceiverService } from './pos-receiver.service';

@Module({
  imports: [RbacModule, MemberModule],
  controllers: [PosReceiverController],
  providers: [PosReceiverService],
  exports: [PosReceiverService],
})
export class PosReceiverModule {}
