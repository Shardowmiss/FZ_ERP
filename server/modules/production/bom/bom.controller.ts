import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { BomService } from '../../bom/bom.service';
import type {
  Bom,
  CostSimulationResult,
  GrossRequirementResult,
  PaginationResult,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/production/bom')
export class ProductionBomController {
  constructor(private readonly bomService: BomService) {}

  @Get('cost-simulation')
  async getCostSimulation(
    @Query('styleId') styleId: string,
  ): Promise<CostSimulationResult> {
    return this.bomService.getCostSimulation(styleId);
  }

  @Get('gross-requirement')
  async getGrossRequirement(
    @Query('styleId') styleId: string,
    @Query('quantity') quantity: string,
  ): Promise<GrossRequirementResult> {
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      throw new BadRequestException('quantity必须为正数');
    }
    return this.bomService.getGrossRequirement(styleId, qty);
  }

  @Get('by-style/:styleId')
  async getBomByStyle(
    @Param('styleId') styleId: string,
  ): Promise<Bom[]> {
    return this.bomService.getBomByStyle(styleId);
  }

  @Get(':id')
  async getBomDetail(@Param('id') id: string): Promise<Bom> {
    return this.bomService.getBomDetail(id);
  }

  @Get()
  async getBomList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('styleId') styleId?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PaginationResult<Bom>> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.bomService.getBomList({
      page: pageNum,
      pageSize: pageSizeNum,
      styleId,
      keyword,
    });
  }

  @CheckPermission('production:bom')
  @Post()
  async createBom(
    @Req() req: Request,
    @Body()
    body: {
      styleId: string;
      version: string;
      remark?: string;
      items: {
        materialId: string;
        usagePerPiece: number;
        lossRate: number;
        bomType: string;
        remark?: string;
      }[];
    },
  ): Promise<Bom> {
    const { userId } = req.userContext;
    return this.bomService.createBom(body, userId);
  }

  @CheckPermission('production:bom')
  @Put(':id')
  async updateBom(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      version?: string;
      remark?: string;
      items?: {
        materialId: string;
        usagePerPiece: number;
        lossRate: number;
        bomType: string;
        remark?: string;
      }[];
    },
  ): Promise<Bom> {
    const { userId } = req.userContext;
    return this.bomService.updateBom(id, body, userId);
  }

  @CheckPermission('production:bom')
  @Delete(':id')
  async deleteBom(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    await this.bomService.deleteBom(id, userId);
    return { success: true };
  }
}
