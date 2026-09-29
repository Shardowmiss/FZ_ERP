import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { SubcontractService } from './subcontract.service';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/subcontract')
export class SubcontractController {
  constructor(private readonly subcontractService: SubcontractService) {}

  @CheckPermission('subcontract:manage')
  @Post('order')
  createOrder(@Body() body: any) {
    return this.subcontractService.createOrder(body);
  }

  @Get('order')
  listOrders(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.subcontractService.listOrders({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      supplierId,
      status,
      keyword,
    });
  }

  @Get('order/:id')
  getOrder(@Param('id') id: string) {
    return this.subcontractService.getOrder(id);
  }

  @CheckPermission('subcontract:manage')
  @Post('order/:id/approve')
  approveOrder(@Param('id') id: string) {
    return this.subcontractService.approveOrder(id);
  }

  @CheckPermission('subcontract:manage')
  @Post('issue')
  createIssue(@Body() body: any) {
    return this.subcontractService.createIssue(body);
  }

  @Get('issue')
  listIssues(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('orderId') orderId?: string,
    @Query('status') status?: string,
  ) {
    return this.subcontractService.listIssues({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      orderId,
      status,
    });
  }

  @CheckPermission('subcontract:manage')
  @Post('issue/:id/approve')
  approveIssue(@Param('id') id: string) {
    if (!id) throw new BadRequestException('发料单ID不能为空');
    return this.subcontractService.approveIssue(id);
  }

  @CheckPermission('subcontract:manage')
  @Post('receipt')
  createReceipt(@Body() body: any) {
    return this.subcontractService.createReceipt(body);
  }

  @Get('receipt')
  listReceipts(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('orderId') orderId?: string,
    @Query('status') status?: string,
  ) {
    return this.subcontractService.listReceipts({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      orderId,
      status,
    });
  }

  @CheckPermission('subcontract:manage')
  @Post('receipt/:id/approve')
  approveReceipt(@Param('id') id: string) {
    if (!id) throw new BadRequestException('回收单ID不能为空');
    return this.subcontractService.approveReceipt(id);
  }

  @CheckPermission('subcontract:manage')
  @Post('fee')
  createFee(@Body() body: any) {
    return this.subcontractService.createFee(body);
  }

  @Get('fee')
  listFees(@Query('orderId') orderId?: string) {
    return this.subcontractService.listFees(orderId);
  }

  @CheckPermission('subcontract:manage')
  @Post('fee/:id/settle')
  settleFee(@Param('id') id: string) {
    if (!id) throw new BadRequestException('加工费ID不能为空');
    return this.subcontractService.settleFee(id);
  }

  @CheckPermission('subcontract:manage')
  @Post('order/:id/void')
  async voidOrder(@Param('id') id: string): Promise<void> {
    return this.subcontractService.voidOrder(id);
  }
  @CheckPermission('subcontract:manage')
  @Post('issue/:id/void')
  async voidIssue(@Param('id') id: string): Promise<void> {
    return this.subcontractService.voidIssue(id);
  }
  @CheckPermission('subcontract:manage')
  @Post('receipt/:id/void')
  async voidReceipt(@Param('id') id: string): Promise<void> {
    return this.subcontractService.voidReceipt(id);
  }
  @CheckPermission('subcontract:manage')
  @Post('fee/:id/void')
  async voidFee(@Param('id') id: string): Promise<void> {
    return this.subcontractService.voidFee(id);
  }

}
