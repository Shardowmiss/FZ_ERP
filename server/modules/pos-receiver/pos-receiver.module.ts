import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
// S3：会员钱包入账能力由 MemberModule 提供（ERP 作为会员钱包唯一账本方）
import { MemberModule } from '../member/member.module';
// POS 退货上行需回补门店仓库存，走库存唯一写入入口 StockService
import { InventoryModule } from '../inventory/inventory.module';
import { PosReceiverController } from './pos-receiver.controller';
import { PosReceiverService } from './pos-receiver.service';

@Module({
  imports: [RbacModule, MemberModule, InventoryModule],
  controllers: [PosReceiverController],
  providers: [PosReceiverService],
  exports: [PosReceiverService],
})
export class PosReceiverModule {}
