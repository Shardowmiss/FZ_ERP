import { Module, forwardRef } from '@nestjs/common';
import { BaseController } from './base.controller';
import { ColorGroupController } from './color-group/color-group.controller';
import { ColorGroupService } from './color-group/color-group.service';
import { SizeGroupController } from './size-group/size-group.controller';
import { SizeGroupService } from './size-group/size-group.service';
import { StyleController } from './style/style.controller';
import { StyleService } from './style/style.service';
import { SkuController } from './sku/sku.controller';
import { SkuService } from './sku/sku.service';
import { MaterialController } from './material/material.controller';
import { MaterialService } from './material/material.service';
import { CustomerController } from './customer/customer.controller';
import { CustomerService } from './customer/customer.service';
import { SupplierController } from './supplier/supplier.controller';
import { SupplierService } from './supplier/supplier.service';
import { WarehouseController } from './warehouse/warehouse.controller';
import { WarehouseService } from './warehouse/warehouse.service';
import { StyleAttributeController } from './style-attribute/style-attribute.controller';
import { StyleAttributeService } from './style-attribute/style-attribute.service';
import { StyleAttrDefController } from './style-attr-def/style-attr-def.controller';
import { StyleAttrDefService } from './style-attr-def/style-attr-def.service';
import { DealerController } from './dealer/dealer.controller';
import { DealerService } from './dealer/dealer.service';
import { StoreController } from './store/store.controller';
import { StoreService } from './store/store.service';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [forwardRef(() => SystemModule)],
  controllers: [
    BaseController,
    ColorGroupController,
    SizeGroupController,
    StyleController,
    SkuController,
    MaterialController,
    CustomerController,
    SupplierController,
    WarehouseController,
    StyleAttributeController,
    StyleAttrDefController,
    DealerController,
    StoreController,
  ],
  providers: [
    ColorGroupService,
    SizeGroupService,
    StyleService,
    SkuService,
    MaterialService,
    CustomerService,
    SupplierService,
    WarehouseService,
    StyleAttributeService,
    StyleAttrDefService,
    DealerService,
    StoreService,
  ],
  exports: [
    ColorGroupService,
    SizeGroupService,
    StyleService,
    SkuService,
    MaterialService,
    CustomerService,
    SupplierService,
    WarehouseService,
    StyleAttributeService,
    StyleAttrDefService,
    DealerService,
    StoreService,
  ],
})
export class BaseModule {}
