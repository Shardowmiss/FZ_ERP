import { Module } from '@nestjs/common';
import { MasterDataMergeService } from './master-data-merge.service';
import { MasterDataMergeController } from './master-data-merge.controller';

@Module({
  // 仅依赖全局注入的 DRIZZLE_DATABASE，无需额外模块
  providers: [MasterDataMergeService],
  controllers: [MasterDataMergeController],
  // 导出供未来 store 泛化或其他模块复用
  exports: [MasterDataMergeService],
})
export class MasterDataMergeModule {}
