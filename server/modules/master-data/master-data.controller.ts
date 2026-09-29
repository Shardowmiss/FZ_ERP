import {
  Controller,
  UseGuards,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Req,
  ParseIntPipe,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard, Roles } from '../auth/auth.guard';
import type { Request } from 'express';
import { MasterDataService } from './master-data.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  Color,
  Size,
  Style,
  StyleDetail,
  Sku,
  ListResponse,
  StockMatrix,
} from '@shared/api.interface';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/master-data')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('colors')
  async getColors(): Promise<Color[]> {
    return this.masterDataService.getColors();
  }

  @Get('sizes')
  async getSizes(): Promise<Size[]> {
    return this.masterDataService.getSizes();
  }

  @Get('styles')
  async getStyles(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
  ): Promise<ListResponse<Style>> {
    return this.masterDataService.getStyles({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
      status,
      category,
    });
  }

  @Get('styles/:id')
  async getStyleDetail(@Param('id') id: string): Promise<StyleDetail> {
    return this.masterDataService.getStyleDetail(id);
  }

  @Get('styles/:id/matrix')
  async getStyleMatrix(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('storeId') storeId?: string,
  ): Promise<StockMatrix> {
    // P0-1：款式库存矩阵强制约束在登录主体门店（矩阵按门店隔离）
    return this.masterDataService.getStyleMatrix(id, enforceStoreScope(principalFromReq(req), storeId));
  }

  @Get('skus')
  async getSkus(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('styleId') styleId?: string,
    @Query('barcode') barcode?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<Sku & { styleName?: string; colorName?: string }>> {
    return this.masterDataService.getSkus({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      styleId,
      barcode,
      keyword,
    });
  }

  // P2-10 进阶：主数据软删除「删除端点」
  // 运营后台「停用」主数据（软删除），需 admin / manager 角色。
  @Delete(':type/:id')
  @Roles('admin', 'manager')
  async deleteMaster(
    @Param('type') type: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ success: boolean; type: string; id: string; deletedAt: string }> {
    const operatorId = req.posUser?.employeeId;
    return this.masterDataService.softDeleteMaster(type, id, operatorId);
  }

  // 运营后台「恢复」已停用主数据（清空 deletedAt），需 admin / manager 角色。
  @Post(':type/:id/restore')
  @Roles('admin', 'manager')
  async restoreMaster(
    @Param('type') type: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ success: boolean; type: string; id: string }> {
    const operatorId = req.posUser?.employeeId;
    return this.masterDataService.restoreMaster(type, id, operatorId);
  }
}
