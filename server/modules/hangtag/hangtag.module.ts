import { Module } from '@nestjs/common';
import { HangtagService } from './hangtag.service';
import { HangtagController } from './hangtag.controller';

/**
 * 吊牌打印模块：
 *  - 唯一码参数配置（是否启用 / 长度 / 最大码）
 *  - 吊牌模板（内容 + 样式）
 *  - 按采购单 / 款号生成颜色×尺码二维表
 *  - 批量打印 + 打印日志（含唯一码连续分配）
 */
@Module({
  controllers: [HangtagController],
  providers: [HangtagService],
  exports: [HangtagService],
})
export class HangtagModule {}
