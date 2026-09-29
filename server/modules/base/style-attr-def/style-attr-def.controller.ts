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
import { StyleAttrDefService } from './style-attr-def.service';
import type { StyleAttrDef, StyleAttrValue } from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/base/style-attr-def')
export class StyleAttrDefController {
  constructor(private readonly service: StyleAttrDefService) {}

  @Get()
  async list(
    @Query('onlyActive') onlyActive?: string,
  ): Promise<StyleAttrDef[]> {
    const active = onlyActive === 'true' || onlyActive === '1';
    return this.service.list(active);
  }

  @Get('with-values')
  async listWithValues(
    @Query('onlyActive') onlyActive?: string,
  ): Promise<StyleAttrDef[]> {
    const active = onlyActive === 'true' || onlyActive === '1';
    return this.service.listWithValues(active);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<StyleAttrDef> {
    return this.service.detail(id);
  }

  @CheckPermission('base:style')
  @Post()
  async create(
    @Body() body: {
      attrCode: string;
      attrName: string;
      sortOrder: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrDef> {
    return this.service.create(body);
  }

  @CheckPermission('base:style')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: {
      attrCode?: string;
      attrName?: string;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrDef> {
    return this.service.update(id, body);
  }

  @CheckPermission('base:style')
  @Post('reorder')
  async reorder(
    @Body() body: { items: Array<{ id: string; sortOrder: number }> },
  ): Promise<{ success: boolean }> {
    return this.service.reorder(body.items);
  }

  @CheckPermission('base:style')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ success: boolean; disabled?: boolean; message?: string }> {
    return this.service.remove(id);
  }

  // ---- 属性值 ----

  @Get(':id/values')
  async listValues(
    @Param('id') id: string,
    @Query('onlyActive') onlyActive?: string,
  ): Promise<StyleAttrValue[]> {
    const active = onlyActive === 'true' || onlyActive === '1';
    return this.service.listValues(id, active);
  }

  @CheckPermission('base:style')
  @Post(':id/values')
  async createValue(
    @Param('id') id: string,
    @Body() body: {
      valueCode: string;
      valueName: string;
      sortOrder: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrValue> {
    return this.service.createValue(id, body);
  }

  @CheckPermission('base:style')
  @Put('values/:valueId')
  async updateValue(
    @Param('valueId') valueId: string,
    @Body() body: {
      valueCode?: string;
      valueName?: string;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrValue> {
    return this.service.updateValue(valueId, body);
  }

  @CheckPermission('base:style')
  @Post(':id/values/reorder')
  async reorderValues(
    @Param('id') _id: string,
    @Body() body: { items: Array<{ id: string; sortOrder: number }> },
  ): Promise<{ success: boolean }> {
    return this.service.reorderValues(body.items);
  }

  @CheckPermission('base:style')
  @Delete('values/:valueId')
  async removeValue(
    @Param('valueId') valueId: string,
  ): Promise<{ success: boolean; disabled?: boolean; message?: string }> {
    return this.service.removeValue(valueId);
  }
}
