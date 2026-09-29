import { Module, Global } from '@nestjs/common';
import { CodeRuleController } from './code-rule/code-rule.controller';
import { CodeRuleService } from './code-rule/code-rule.service';
import { NumberGeneratorService } from './code-rule/number-generator.service';
import { OperationLogController } from './operation-log/operation-log.controller';
import { OperationLogService } from './operation-log/operation-log.service';
import { SystemConfigController } from './config/system-config.controller';
import { SystemConfigService } from './config/system-config.service';

@Global()
@Module({
  imports: [],
  controllers: [
    CodeRuleController,
    OperationLogController,
    SystemConfigController,
  ],
  providers: [
    CodeRuleService,
    NumberGeneratorService,
    OperationLogService,
    SystemConfigService,
  ],
  exports: [
    CodeRuleService,
    NumberGeneratorService,
    OperationLogService,
    SystemConfigService,
  ],
})
export class SystemModule {}
