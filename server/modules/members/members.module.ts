import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MemberWalletUpstreamService } from './member-wallet-upstream.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MembersController],
  providers: [MembersService, MemberWalletUpstreamService],
  // 导出给 sales / returns / omnichannel：三处的钱包变动都要落到同一张 outbox，
  // 由本服务统一产出与推送（详见 member-wallet-upstream.service.ts 头部说明）。
  // MembersModule 只依赖 AuthModule，反向不存在 —— 不会形成循环依赖。
  exports: [MembersService, MemberWalletUpstreamService],
})
export class MembersModule {}
