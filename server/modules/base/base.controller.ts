import { Controller, Get } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';

@NeedLogin()
@Controller('api/base')
export class BaseController {
  @Get()
  health(): string {
    return 'base module ok';
  }
}
