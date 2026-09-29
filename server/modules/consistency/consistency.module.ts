import { Module } from '@nestjs/common';
import { ConsistencyService } from './consistency.service';
import { ConsistencySchedulerService } from './consistency-scheduler.service';
import { ConsistencyController } from './consistency.controller';

@Module({
  controllers: [ConsistencyController],
  providers: [ConsistencyService, ConsistencySchedulerService],
  exports: [ConsistencyService],
})
export class ConsistencyModule {}
