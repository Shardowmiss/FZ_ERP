import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RbacService } from './rbac.service';
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
  async login(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.rbacService.login(body.username, body.password);
  }

  @Public()
  @Post('logout')
  async logout(@Headers('x-auth-token') token?: string): Promise<{ success: boolean }> {
    if (token) {
      await this.rbacService.logout(token);
    }
    return { success: true };
  }

  @Get('me')
  async me(@Headers('x-auth-token') token?: string): Promise<CurrentUserResponse> {
    if (!token) {
      throw new UnauthorizedException('未登录');
    }
    return this.rbacService.getCurrentUser(token);
  }
}
