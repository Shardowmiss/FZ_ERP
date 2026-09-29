import { Body, Controller, Post } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { MrpService } from './mrp.service';
import type { MrpRequest, MrpResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/production/mrp')
export class MrpController {
  constructor(private readonly mrpService: MrpService) {}

  @CheckPermission('production:mrp')
  @Post('calculate')
  async calculate(@Body() body: MrpRequest): Promise<MrpResult> {
    return this.mrpService.calculate(body);
  }
}
