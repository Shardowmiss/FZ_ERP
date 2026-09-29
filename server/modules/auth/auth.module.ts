import { Module, Global } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';

// 全局模块：AuthService/AuthGuard 被十几个 feature 模块的 @UseGuards(AuthGuard) 直接引用，
// 必须全局可见，否则各模块 DI 阶段报 "Nest can't resolve dependencies of the AuthGuard"。
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
