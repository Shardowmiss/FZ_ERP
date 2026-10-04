import { Module } from '@nestjs/common';
import { BarcodeConfigController } from './barcode-config.controller';
import { BarcodeConfigService } from './barcode-config.service';

@Module({
  imports: [],
  controllers: [BarcodeConfigController],
  providers: [BarcodeConfigService],
  exports: [BarcodeConfigService],
})
export class BarcodeConfigModule {}
