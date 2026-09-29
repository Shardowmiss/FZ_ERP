import { Module } from '@nestjs/common';
import { ReceivableService } from './receivable/receivable.service';
import { ReceivableController } from './receivable/receivable.controller';
import { PayableService } from './payable/payable.service';
import { PayableController } from './payable/payable.controller';
import { ReceiptService } from './receipt/receipt.service';
import { ReceiptController } from './receipt/receipt.controller';
import { PaymentService } from './payment/payment.service';
import { PaymentController } from './payment/payment.controller';
import { ProfitService } from './profit/profit.service';
import { ProfitController } from './profit/profit.controller';
import { MonthCloseService } from './month-close/month-close.service';
import { MonthCloseController } from './month-close/month-close.controller';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [SystemModule],
  providers: [ReceivableService, PayableService, ReceiptService, PaymentService, ProfitService, MonthCloseService],
  controllers: [ReceivableController, PayableController, ReceiptController, PaymentController, ProfitController, MonthCloseController],
  exports: [ReceivableService, PayableService, ReceiptService, PaymentService, ProfitService, MonthCloseService],
})
export class FinanceModule {}
