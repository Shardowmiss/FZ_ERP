import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { RbacService } from './rbac.service';
import {
  clearErpCsrfCookie,
  setErpCsrfCookie,
} from '../../common/security/erp-csrf.util';
import type {
  LoginRequest,
  LoginResponse,
  CurrentUserResponse,
} from '@shared/api.interface';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly rbacService: RbacService) {}

  /**
   * 登录防暴力破解 tracker：按**真实客户端 IP** 限流。
   * 平台下请求经网关/LB 转发，默认 req.ip 为网关 IP，若不处理则所有用户共享同一计数，
   * 严苛限流会变成「全公司登录 N 次/分钟即锁死」的自 DOS。故优先取 X-Forwarded-For 首段，
   * 缺失时回退 req.ip。与全局 ThrottlerGuard 的默认 tracker 行为解耦，仅作用于登录端点。
   * 注意 @nestjs/throttler v6 的 getTracker 签名为 (req, context)，首个参数即 Express Request。
   */
  private static loginClientTracker(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    if (Array.isArray(xff) && xff.length > 0) {
      return String(xff[0]).trim();
    }
    return req.ip || 'unknown';
  }

  @Public()
  // W1-2 限流细分：登录端点严格限流（默认 10 次/分钟/客户端 IP），抵御凭证爆破/撞库。
  // 覆盖全局 100/min 的宽松默认，仅作用于本端点；超限返回 429。
  @Throttle({ default: { ttl: 60000, limit: 10, getTracker: AuthController.loginClientTracker } })
  @Post('login')
  async login(
    @Body() body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.rbacService.login(body.username, body.password);
    // 下发应用层自签 CSRF cookie（D.1）
    setErpCsrfCookie(res);
    return result;
  }

  @Public()
  @Post('logout')
  async logout(
    @Headers('x-auth-token') token?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<{ success: boolean }> {
    if (token) {
      await this.rbacService.logout(token);
    }
    if (res) clearErpCsrfCookie(res);
    return { success: true };
  }

  @Get('me')
  async me(
    @Headers('x-auth-token') token?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<CurrentUserResponse> {
    if (!token) {
      throw new UnauthorizedException('未登录');
    }
    const user = await this.rbacService.getCurrentUser(token);
    // 已登录会话访问即刷新自签 CSRF cookie，使存量会话在改版后无需强制重登即可获得令牌
    if (res) setErpCsrfCookie(res);
    return user;
  }

  @Patch('me/language')
  async updateLanguage(
    @Headers('x-auth-token') token?: string,
    @Body() body?: { language?: string },
  ): Promise<CurrentUserResponse> {
    if (!token) {
      throw new UnauthorizedException('未登录');
    }
    if (!body?.language) {
      throw new UnauthorizedException('缺少 language 参数');
    }
    return this.rbacService.updateCurrentUserLanguage(token, body.language);
  }
}
