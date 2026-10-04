import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { BarcodeConfigService } from './barcode-config.service';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';
import type {
  StyleBarcodeConfigDto,
  StyleBarcodeConfigSaveRequest,
  StyleBarcodeGenerateRequest,
  StyleBarcodeGenerateResult,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/product/barcode-config')
export class BarcodeConfigController {
  constructor(private readonly service: BarcodeConfigService) {}

  @Get()
  async getByStyle(
    @Query('styleId') styleId?: string,
  ): Promise<{ config: StyleBarcodeConfigDto | null; barcodes: any[] }> {
    if (!styleId) return { config: null, barcodes: [] };
    return this.service.getByStyle(styleId);
  }

  @CheckPermission('product:barcode')
  @Post()
  async save(@Body() body: StyleBarcodeConfigSaveRequest): Promise<StyleBarcodeConfigDto> {
    return this.service.save(body);
  }

  @CheckPermission('product:barcode')
  @Post('generate')
  async generate(@Body() body: StyleBarcodeGenerateRequest): Promise<StyleBarcodeGenerateResult> {
    return this.service.generate(body);
  }
}
