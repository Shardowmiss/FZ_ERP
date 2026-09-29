import { Controller, Get, Render, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.guard';

@Controller()
export class ViewController {

  // A-4：SPA 页面本身必须免登录，否则登录页都无法加载
  @Public()
  @Get(['/', '*'])
  @Render('index')
  async render(@Req() req: Request): Promise<{ __platform__: string }>  {
    // you can add custom render params here
    const platformData = req.__platform_data__ ?? {};
    return {
      // don't delete this line, it's used by client to get platform info
      __platform__: JSON.stringify(platformData),
    };
  }
}
