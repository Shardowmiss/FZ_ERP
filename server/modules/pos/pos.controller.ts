import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { PosService } from './pos.service';
import type { OpenSessionDto, CloseSessionDto, PosCheckoutDto, PosQuoteDto } from './dto/pos.dto';
import type { PaginationResult } from '@shared/api.interface';
import { resolvePagination } from '@server/common/dto/pagination';
import { CheckPermission } from '../../common/decorators/check-permission.decorator';

@NeedLogin()
@Controller('api/pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  /* ========== Session ========== */

  @CheckPermission('pos:cashier')
  @Post('session/open')
  openSession(@Req() req: Request, @Body() body: OpenSessionDto) {
    const { userId } = req.userContext;
    return this.posService.openSession(body, userId);
  }

  @Get('session/open')
  getOpenSession(@Req() req: Request, @Query('storeId') storeId: string) {
    const { userId } = req.userContext;
    if (!storeId) throw new BadRequestException('storeId 必填');
    return this.posService.getOpenSession(storeId, userId);
  }

  @CheckPermission('pos:cashier')
  @Post('session/:id/close')
  closeSession(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CloseSessionDto,
  ) {
    const { userId } = req.userContext;
    return this.posService.closeSession(id, body, userId);
  }

  @Get('session/list')
  listSessions(
    @Req() req: Request,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
  ): Promise<PaginationResult<Record<string, unknown>>> {
    const { userId } = req.userContext;
    return this.posService.listSessions({
      userId,
      ...resolvePagination({ page, pageSize }),
      storeId,
      status,
    });
  }

  /* ========== Checkout ========== */

  @CheckPermission('pos:cashier')
  @Post('checkout')
  checkout(@Req() req: Request, @Body() body: PosCheckoutDto) {
    const { userId } = req.userContext;
    return this.posService.checkout(body, userId);
  }

  @CheckPermission('pos:cashier')
  @Post('quote')
  quote(@Req() req: Request, @Body() body: PosQuoteDto) {
    const { userId } = req.userContext;
    return this.posService.quote(body, userId);
  }
}
