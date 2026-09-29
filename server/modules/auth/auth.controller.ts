import { Body, Controller, Get, Post, Req, HttpCode } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type LoginResult } from './auth.service';
import { Public } from './auth.guard';

// P1-5：登录体改为受校验的类（配合全局 ValidationPipe）。
// 此前是 interface（运行时被擦除，无法被 class-validator 校验），
// 意味着登录入参类型/必填完全无服务端校验。
class LoginBody {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

/** A-4：登录与会话自查询。登录接口本身必须公开 */
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // P0-5 / P1-b：登录防爆破 —— 每 IP 60 秒内最多 5 次尝试。
  // 全局 ThrottlerGuard 已注册（app.module），此处仅用 @Throttle 覆盖阈值；
  // 不再重复挂 @UseGuards(ThrottlerGuard)，避免全局+局部重复执行导致计数翻倍。
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: LoginBody): Promise<LoginResult> {
    return this.authService.login(String(body?.code ?? ''), String(body?.password ?? ''));
  }

  /** 返回当前登录身份，前端用于校验令牌是否仍有效 */
  @Get('me')
  async me(@Req() req: Request) {
    return req.posUser ?? null;
  }
}
