import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { RbacService } from '../rbac/rbac.service';
import {
  DistributionPortalService,
  PortalQuery,
} from './distribution-portal.service';

/**
 * 分销门户控制器。
 * 所有端点均通过 x-auth-token 解析当前登录用户，并按其绑定的分销节点子树
 * 过滤数据，确保“一级/二级分销商只能看到自己节点（及下级）的采购单”。
 */
@Controller('api/distribution/portal')
export class DistributionPortalController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly portal: DistributionPortalService,
  ) {}

  /** 解析并校验当前登录用户。 */
  private async resolveUserId(token?: string): Promise<string> {
    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }
    const uid = await this.rbacService.getUserIdByToken(token);
    if (!uid) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    return uid;
  }

  /** 当前用户绑定的分销节点列表（含层级、角色）。 */
  @Get('my-partners')
  async myPartners(@Headers('x-auth-token') token: string) {
    const uid = await this.resolveUserId(token);
    return this.portal.getUserPartners(uid);
  }

  /** 我的采购单（下游成衣采购单 = 总部/上级卖给本节点的销售单镜像）。 */
  @Get('purchase-orders')
  async purchaseOrders(
    @Headers('x-auth-token') token: string,
    @Query() query: PortalQuery,
  ) {
    const uid = await this.resolveUserId(token);
    return this.portal.getPurchaseOrders(uid, query);
  }

  /** 我的采购退货单（下游成衣采购退货单 = 上级对本节点的销售退货镜像）。 */
  @Get('purchase-returns')
  async purchaseReturns(
    @Headers('x-auth-token') token: string,
    @Query() query: PortalQuery,
  ) {
    const uid = await this.resolveUserId(token);
    return this.portal.getPurchaseReturns(uid, query);
  }

  /** 门户概览：采购单 / 退货单 数量与金额汇总。 */
  @Get('summary')
  async summary(@Headers('x-auth-token') token: string) {
    const uid = await this.resolveUserId(token);
    return this.portal.getSummary(uid);
  }

  /**
   * 分配用户到分销节点（仅超级管理员）。
   * body: { userId: string, partnerIds: string[] }
   */
  @Post('assign-partners')
  async assignPartners(
    @Headers('x-auth-token') token: string,
    @Body() body?: { userId?: string; partnerIds?: string[] },
  ) {
    const operator = await this.resolveUserId(token);
    const targetUserId = body?.userId;
    const partnerIds = body?.partnerIds ?? [];
    if (!targetUserId) {
      throw new ForbiddenException('缺少目标用户ID');
    }
    return this.portal.assignUserPartners(operator, targetUserId, partnerIds);
  }

  /**
   * 确认接收上游镜像生成的采购单（待接收 -> 已审核）。
   * 仅能确认属于当前用户可见子树的采购单。
   * body: { orderId: string }
   */
  @Post('purchase-orders/confirm')
  async confirmPurchaseOrder(
    @Headers('x-auth-token') token: string,
    @Body() body?: { orderId?: string },
  ) {
    const uid = await this.resolveUserId(token);
    const orderId = body?.orderId;
    if (!orderId) {
      throw new ForbiddenException('缺少采购订单ID');
    }
    return this.portal.confirmPurchaseOrder(uid, orderId);
  }

  /** 上下游应收应付对账视图。 */
  @Get('reconciliation')
  async reconciliation(@Headers('x-auth-token') token: string) {
    const uid = await this.resolveUserId(token);
    return this.portal.getReconciliation(uid);
  }
}
