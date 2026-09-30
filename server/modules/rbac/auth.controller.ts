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
import type { Response } from 'express';
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

  @Public()
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
