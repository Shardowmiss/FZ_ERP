import { Module } from '@nestjs/common';
import { MemberService } from './member.service';
import { MemberWalletService } from './member-wallet.service';
import { MemberMergeService } from './member-merge.service';
import { MemberController } from './member.controller';
import { MemberLevelController } from './member-level.controller';
import { MemberLevelService } from './member-level.service';
import { SystemModule } from '@server/modules/system/system.module';

@Module({
  imports: [SystemModule],
  providers: [MemberService, MemberWalletService, MemberMergeService, MemberLevelService],
  controllers: [MemberController, MemberLevelController],
  // MemberWalletService 需导出：pos-receiver 用它接收 POS 上行钱包事件（S3）
  // MemberMergeService 导出：未来 product/customer/store 泛化合并（3b/3c）可复用
  exports: [MemberService, MemberWalletService, MemberMergeService],
})
export class MemberModule {}
