import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { InventoryService } from './inventory.service';
import { principalFromReq, enforceStoreScope } from '@server/common/tenant';
import type {
  Transfer,
  ListResponse,
  TransferRequest,
  Stocktake,
} from '@shared/api.interface';
import {
  CreateTransferRequestDto,
  CreateStocktakeDto,
  CreateTransferDto,
} from '@server/common/dto';

@NeedLogin()
@UseGuards(AuthGuard)
@Controller('api/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ============ 调拨单 ============
  @Get('transfers')
  async getTransfers(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<Transfer>> {
    // P0-1：列表查询强制门店作用域，跨店读取自动降权到本店
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.inventoryService.getTransfers({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      type,
      keyword,
    });
  }

  @Roles('admin', 'manager')
  @Post('transfers')
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @Req() req: Request,
  ): Promise<Transfer> {
    // P0-1：门店归属由服务端权威推导（忽略 Body.storeId）；店长/管理员方可发起调拨出库
    return this.inventoryService.createTransfer(dto, principalFromReq(req));
  }

  @Get('transfers/:id')
  async getTransferDetail(@Param('id') id: string): Promise<Transfer> {
    return this.inventoryService.getTransferDetail(id);
  }

  @Roles('admin', 'manager')
  @Post('transfers/:id/receive')
  async receiveTransfer(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Transfer> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导（不再信任 Body.storeId）
    // P1-3：收货确认影响库存账，限定店长/管理员
    return this.inventoryService.receiveTransfer(id, principalFromReq(req));
  }

  // ============ 要货申请 ============
  @Get('transfer-requests')
  async getTransferRequests(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<TransferRequest>> {
    // P0-1：列表查询强制门店作用域
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.inventoryService.getTransferRequests({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      keyword,
    });
  }

  @Post('transfer-requests')
  async createTransferRequest(
    @Body() dto: CreateTransferRequestDto,
    @Req() req: Request,
  ): Promise<TransferRequest> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导
    return this.inventoryService.createTransferRequest(dto, principalFromReq(req));
  }

  // ============ 盘点单 ============
  @Get('stocktakes')
  async getStocktakes(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ListResponse<Stocktake>> {
    // P0-1：列表查询强制门店作用域
    const scopedStoreId = enforceStoreScope(principalFromReq(req), storeId);
    return this.inventoryService.getStocktakes({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      storeId: scopedStoreId,
      status,
      keyword,
    });
  }

  @Post('stocktakes')
  async createStocktake(@Body() dto: CreateStocktakeDto, @Req() req: Request): Promise<Stocktake> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导
    return this.inventoryService.createStocktake(dto, principalFromReq(req));
  }

  @Roles('admin', 'manager')
  @Post('stocktakes/:id/audit')
  async auditStocktake(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Stocktake> {
    // P0-1：写接口传入登录主体，门店归属由服务端权威推导（不再信任 Body.storeId）
    // P1-3：盘点审核生成正式库存差额凭证，限定店长/管理员
    return this.inventoryService.auditStocktake(id, principalFromReq(req));
  }
}
