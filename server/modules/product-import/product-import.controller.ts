import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import {
  ProductImportService,
  type ProductImportTaskView,
  type ValidateResult,
} from './product-import.service';

class ValidateDto {
  @IsIn(['style', 'sku'])
  importType: 'style' | 'sku';

  @IsArray()
  rows: Record<string, any>[];
}

class CreateDraftDto {
  @IsIn(['style', 'sku'])
  importType: 'style' | 'sku';

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  bucketId?: string;

  @IsArray()
  rows: Record<string, any>[];
}

@NeedLogin()
@CheckPermission('base:import')
@Controller('api/base/product-import')
@UsePipes(new ValidationPipe({ transform: true, whitelist: false, forbidNonWhitelisted: false }))
export class ProductImportController {
  constructor(private readonly svc: ProductImportService) {}

  /** 校验一批导入数据，返回逐行状态清单（不支持/已存在/主数据缺失） */
  @Post('validate')
  validate(@Body() body: ValidateDto): Promise<ValidateResult> {
    return this.svc.validate(body.importType, body.rows);
  }

  /** 建立草稿：记录 Excel 原文件与解析数据；同类型旧草稿置 superseded */
  @Post('draft')
  createDraft(@Body() body: CreateDraftDto): Promise<ProductImportTaskView> {
    return this.svc.createDraft({
      importType: body.importType,
      fileName: body.fileName,
      fileUrl: body.fileUrl,
      filePath: body.filePath,
      bucketId: body.bucketId,
      rows: body.rows,
    });
  }

  /** 导入任务历史列表（可按 importType 过滤） */
  @Get('tasks')
  listTasks(@Query('importType') importType?: string): Promise<ProductImportTaskView[]> {
    return this.svc.listTasks(importType);
  }

  /** 导入任务详情（含逐行状态） */
  @Get('tasks/:id')
  getTask(@Param('id') id: string): Promise<ProductImportTaskView> {
    return this.svc.getTask(id);
  }

  /** 审核：将 ok 行批量写入商品库（仅新增、跳过已存在） */
  @Post('tasks/:id/approve')
  approve(@Param('id') id: string): Promise<ProductImportTaskView> {
    return this.svc.approve(id);
  }
}
