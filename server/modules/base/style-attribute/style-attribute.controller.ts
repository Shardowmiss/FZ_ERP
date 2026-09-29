import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { StyleAttributeService } from './style-attribute.service';
import type { StyleAttribute, PaginationResult } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/style-attribute')
export class StyleAttributeController {
  constructor(private readonly styleAttributeService: StyleAttributeService) {}

  @Get()
  async list(
    @Query('attrType') attrType: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PaginationResult<StyleAttribute>> {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.styleAttributeService.list(attrType, p, ps, keyword);
  }

  @Get('all')
  async getAll(
    @Query('attrType') attrType: string,
    @Query('onlyActive') onlyActive?: string,
  ): Promise<StyleAttribute[]> {
    const active = onlyActive === 'true' || onlyActive === '1';
    return this.styleAttributeService.getAllByType(attrType, active);
  }

  @Get('sub-categories')
  async getSubCategories(
    @Query('parentCode') parentCode: string,
    @Query('onlyActive') onlyActive?: string,
  ): Promise<StyleAttribute[]> {
    const active = onlyActive === 'true' || onlyActive === '1';
    return this.styleAttributeService.getSubCategoriesByParent(parentCode, active);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<StyleAttribute> {
    return this.styleAttributeService.detail(id);
  }

  @CheckPermission('base:style')
  @Post()
  async create(
    @Body()
    body: {
      attrType: string;
      attrCode: string;
      attrName: string;
      sortOrder: number;
      status?: string;
      parentCode?: string;
      remark?: string;
    },
  ): Promise<StyleAttribute> {
    return this.styleAttributeService.create(body);
  }

  @CheckPermission('base:style')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      attrCode?: string;
      attrName?: string;
      sortOrder?: number;
      status?: string;
      parentCode?: string;
      remark?: string;
    },
  ): Promise<StyleAttribute> {
    return this.styleAttributeService.update(id, body);
  }

  @CheckPermission('base:style')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ success: boolean; disabled?: boolean; message?: string }> {
    return this.styleAttributeService.remove(id);
  }

  @CheckPermission('base:style')
  @Post('batch-status')
  async batchUpdateStatus(
    @Body() body: { ids: string[]; status: string },
  ): Promise<{ success: boolean; count: number }> {
    return this.styleAttributeService.batchUpdateStatus(body.ids, body.status);
  }
}
