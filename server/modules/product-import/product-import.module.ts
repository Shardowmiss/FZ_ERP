import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';

@Module({
  imports: [BaseModule],
  controllers: [ProductImportController],
  providers: [ProductImportService],
  exports: [ProductImportService],
})
export class ProductImportModule {}
