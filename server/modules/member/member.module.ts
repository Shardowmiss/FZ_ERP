import { Module } from '@nestjs/common';
import { MemberService } from './member.service';
import { MemberWalletService } from './member-wallet.service';
import { MemberController } from './member.controller';
import { SystemModule } from '@server/modules/system/system.module';

@Module({
  imports: [SystemModule],
  providers: [MemberService, MemberWalletService],
  controllers: [MemberController],
  // MemberWalletService 需导出：pos-receiver 用它接收 POS 上行钱包事件（S3）
  exports: [MemberService, MemberWalletService],
})
export class MemberModule {}
