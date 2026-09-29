import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CheckPermission } from '../../../common/decorators/check-permission.decorator';
import { ReplenishTemplateService } from './replenish-template.service';
import { ReplenishSchedulerService } from './replenish-scheduler.service';

@NeedLogin()
@CheckPermission('inventory:replenish-template')
@Controller('api/inventory/replenish-template')
export class ReplenishTemplateController {
  constructor(
    private readonly templateService: ReplenishTemplateService,
    private readonly scheduler: ReplenishSchedulerService,
  ) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('enabled') enabled?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.templateService.list({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      enabled: enabled === undefined ? undefined : enabled === 'true',
      keyword,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.templateService.get(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.templateService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.templateService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templateService.remove(id);
  }

  /** 手动执行一次模板（立即生成草稿单据），用于测试与临时补跑。 */
  @Post(':id/execute')
  async execute(@Param('id') id: string) {
    return this.scheduler.manualRun(id);
  }
}
