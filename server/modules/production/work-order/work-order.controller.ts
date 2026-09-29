import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { WorkOrderService } from './work-order.service';
import type { PaginationResult } from '@shared/api.interface';
import type { Request } from 'express';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

interface WorkOrderResponse {
  id: string;
  orderNo: string;
  styleId: string;
  styleNo: string;
  styleName?: string;
  quantity: number;
  supplierId?: string;
  factoryName?: string;
  planStartDate?: string;
  planFinishDate?: string;
  actualStartDate?: string;
  actualFinishDate?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

@NeedLogin()
@Controller('api/production/work-order')
export class WorkOrderController {
  constructor(private readonly workOrderService: WorkOrderService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('styleId') styleId?: string,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<WorkOrderResponse>> {
    return this.workOrderService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
      styleId,
      keyword,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<WorkOrderResponse> {
    return this.workOrderService.get(id);
  }

  @CheckPermission('production:work_order')
  @Post()
  async create(
    @Body()
    body: {
      styleId: string;
      quantity: number;
      supplierId?: string;
      factoryName?: string;
      planStartDate?: string;
      planFinishDate?: string;
      remark?: string;
    },
  ): Promise<WorkOrderResponse> {
    return this.workOrderService.create(body);
  }

  @CheckPermission('production:work_order')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      styleId: string;
      quantity: number;
      supplierId?: string;
      factoryName?: string;
      planStartDate?: string;
      planFinishDate?: string;
      remark?: string;
    },
  ): Promise<WorkOrderResponse> {
    return this.workOrderService.update(id, body);
  }

  @CheckPermission('production:work_order')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.workOrderService.voidDoc(id);
  }

  @CheckPermission('production:work_order')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.workOrderService.remove(id, {
      userId,
      userName: userName ?? '',
      module: 'production_work_order',
    });
  }

  @CheckPermission('production:work_order')
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.workOrderService.approve(id, {
      userId,
      userName: userName ?? '',
      module: 'production_work_order',
    });
  }

  @CheckPermission('production:work_order')
  @Post(':id/finish')
  async finish(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.workOrderService.finish(id, {
      userId,
      userName: userName ?? '',
      module: 'production_work_order',
    });
  }
}
