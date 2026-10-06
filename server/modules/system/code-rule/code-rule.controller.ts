import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CodeRuleService } from './code-rule.service';
import type {
  CodeRule,
  CodeMappingConfig,
  StyleCodePreviewRequest,
  StyleCodePreviewResult,
  CodeRuleSegment,
  BrandCode,
} from '@shared/api.interface';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/system/code-rule')
export class CodeRuleController {
  constructor(private readonly codeRuleService: CodeRuleService) {}

  @Get()
  async getDefaultRule(): Promise<CodeRule> {
    return this.codeRuleService.getDefaultRule();
  }

  @Get('list')
  async listRules(): Promise<CodeRule[]> {
    return this.codeRuleService.listRules();
  }

  @CheckPermission('system:config')
  @Post()
  async saveRule(@Body() body: {
    id?: string;
    name: string;
    segments: CodeRuleSegment[];
    isDefault?: boolean;
  }): Promise<CodeRule> {
    return this.codeRuleService.saveRule(body);
  }

  @Get('mapping')
  async getMappingConfig(): Promise<CodeMappingConfig> {
    return this.codeRuleService.getMappingConfig();
  }

  @CheckPermission('system:config')
  @Post('mapping')
  async saveMappingConfig(@Body() body: CodeMappingConfig): Promise<CodeMappingConfig> {
    return this.codeRuleService.saveMappingConfig(body);
  }

  @CheckPermission('system:config')
  @Post('preview')
  async previewStyleCode(@Body() body: StyleCodePreviewRequest): Promise<StyleCodePreviewResult> {
    return this.codeRuleService.previewStyleCode(body);
  }

  @CheckPermission('system:config')
  @Post('next-serial')
  async getNextSerial(@Body() body: { year?: string; category?: string; ruleId?: string }): Promise<{ serialNo: string }> {
    const serialNo = await this.codeRuleService.getNextSerialNo(body);
    return { serialNo };
  }

  @Get('brand-options')
  async getBrandOptions(): Promise<BrandCode[]> {
    return this.codeRuleService.getBrandOptions();
  }

  @Get(':id')
  async getRule(@Param('id') id: string): Promise<CodeRule> {
    return this.codeRuleService.getRule(id);
  }
}
