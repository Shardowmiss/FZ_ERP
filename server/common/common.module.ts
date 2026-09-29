import { Global, Module } from '@nestjs/common';
import { MoneyService } from './services/money.service';

/**
 * 共享内核模块。
 *
 * 以 @Global 注册，使 MoneyService 等通用能力在任意功能模块中可直接注入，
 * 而无需每个模块重复 import 深层相对路径。后续可将通用的异常/响应工具、装饰器
 * 一并纳入此模块，形成项目的“共享内核”边界。
 */
@Global()
@Module({
  providers: [MoneyService],
  exports: [MoneyService],
})
export class CommonModule {}
