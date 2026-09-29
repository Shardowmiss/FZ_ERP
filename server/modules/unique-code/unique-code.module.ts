import { Module } from '@nestjs/common';
import { UniqueCodeController } from './unique-code.controller';
import { UniqueCodeService } from './unique-code.service';
import { TracePublicController } from './trace-public.controller';
import { UniqueCodeConfigService } from './unique-code-config.service';
import { UniqueCodeInboundService } from './unique-code-inbound.service';
import { UniqueCodeLifecycleService } from './unique-code-lifecycle.service';
import { UniqueCodeScanService } from './unique-code-scan.service';
import { UniqueCodeTraceService } from './unique-code-trace.service';
import { UniqueCodeArchiveService } from './unique-code-archive.service';

/**
 * 唯一码模块。
 *
 * 门面 UniqueCodeService 只做委托装配；六个职责域服务同处一个模块内部
 * （不导出，避免外部越过门面直接依赖某个域，后续重构域边界时不会波及调用方）。
 */
@Module({
  controllers: [UniqueCodeController, TracePublicController],
  providers: [
    UniqueCodeService,
    UniqueCodeConfigService,
    UniqueCodeInboundService,
    UniqueCodeLifecycleService,
    UniqueCodeScanService,
    UniqueCodeTraceService,
    UniqueCodeArchiveService,
  ],
  exports: [UniqueCodeService],
})
export class UniqueCodeModule {}
