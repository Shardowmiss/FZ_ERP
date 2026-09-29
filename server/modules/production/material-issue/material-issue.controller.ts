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
import { MaterialIssueService } from './material-issue.service';
import type { PaginationResult } from '@shared/api.interface';
import type { Request } from 'express';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

interface MaterialIssueItemResponse {
  id: string;
  issueId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  spec?: string;
  unit: string;
  planQty: number;
  actualQty: number;
}

interface MaterialIssueResponse {
  id: string;
  issueNo: string;
  workOrderId: string;
  workOrderNo?: string;
  warehouseId: string;
  warehouseName?: string;
  issueDate: string;
  receiver?: string;
  status: string;
  remark?: string;
  createdAt: string;
  items?: MaterialIssueItemResponse[];
}

@NeedLogin()
@Controller('api/production/material-issue')
export class MaterialIssueController {
  constructor(private readonly materialIssueService: MaterialIssueService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginationResult<MaterialIssueResponse>> {
    return this.materialIssueService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
      workOrderId,
      keyword,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<MaterialIssueResponse> {
    return this.materialIssueService.get(id);
  }

  @CheckPermission('production:material_issue')
  @Post()
  async create(
    @Body()
    body: {
      workOrderId: string;
      warehouseId: string;
      issueDate: string;
      receiver?: string;
      remark?: string;
      items: { materialId: string; planQty: number; actualQty: number }[];
    },
  ): Promise<MaterialIssueResponse> {
    return this.materialIssueService.create(body);
  }

  @CheckPermission('production:material_issue')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      workOrderId: string;
      warehouseId: string;
      issueDate: string;
      receiver?: string;
      remark?: string;
      items: { materialId: string; planQty: number; actualQty: number }[];
    },
  ): Promise<MaterialIssueResponse> {
    return this.materialIssueService.update(id, body);
  }

  @CheckPermission('production:material_issue')
  @Post(':id/void')
  async voidDoc(@Param('id') id: string): Promise<void> {
    return this.materialIssueService.voidDoc(id);
  }

  @CheckPermission('production:material_issue')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.materialIssueService.remove(id, {
      userId,
      userName: userName ?? '',
      module: 'production_material_issue',
    });
  }

  @CheckPermission('production:material_issue')
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const { userId, userName } = req.userContext;
    return this.materialIssueService.approve(id, {
      userId,
      userName: userName ?? '',
      module: 'production_material_issue',
    });
  }
}
