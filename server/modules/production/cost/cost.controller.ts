import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CostService } from './cost.service';
import type { MrpRequest, ProductionCostResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/production/cost')
export class CostController {
  constructor(private readonly costService: CostService) {}

  @CheckPermission('production:cost')
  @Post('calculate')
  async calculate(@Body() body: MrpRequest): Promise<ProductionCostResult> {
    return this.costService.calculate(body);
  }

  @Get('by-style/:styleId')
  async getByStyle(
    @Param('styleId') styleId: string,
  ): Promise<ProductionCostResult> {
    return this.costService.getByStyle(styleId);
  }
}
