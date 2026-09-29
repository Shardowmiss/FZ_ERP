import { Injectable, Logger } from '@nestjs/common';

/**
 * Mock ERP 服务 - 模拟云裁ERP总部系统
 * 在真实环境中，这些方法会通过 HTTP/WebService 调用真实的 ERP 接口
 * 当前实现为本地 Mock，用于开发测试和离线模式
 */
@Injectable()
export class MockErpService {
  private readonly logger = new Logger(MockErpService.name);
  private connectionStatus = true;

  // ============ 连接状态 ============
  isConnected(): boolean {
    return this.connectionStatus;
  }

  setConnected(connected: boolean): void {
    this.connectionStatus = connected;
    this.logger.log(`ERP连接状态变更: ${connected ? '在线' : '离线'}`);
  }

  // ============ 下行数据（ERP → POS） ============

  /**
   * 获取款式主数据
   */
  async getStyles(lastSyncTime?: string): Promise<{
    styles: Array<{
      id: string;
      name: string;
      category: string;
      colorIds: string[];
      sizeIds: string[];
      tagPrice: number;
      costPrice: number;
      status: string;
    }>;
    colors: Array<{ id: string; name: string; hex: string }>;
    sizes: Array<{ id: string; sortOrder: number }>;
    total: number;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 获取款式数据 ${lastSyncTime ? '(增量)' : '(全量)'}`);

    // 模拟一些款式数据
    return {
      styles: [
        {
          id: 'ST2024001',
          name: '经典羊毛大衣',
          category: '外套',
          colorIds: ['C001', 'C002'],
          sizeIds: ['S', 'M', 'L', 'XL'],
          tagPrice: 1299,
          costPrice: 580,
          status: 'on_sale',
        },
        {
          id: 'ST2024002',
          name: '真丝连衣裙',
          category: '连衣裙',
          colorIds: ['C003', 'C004'],
          sizeIds: ['S', 'M', 'L'],
          tagPrice: 899,
          costPrice: 380,
          status: 'on_sale',
        },
      ],
      colors: [
        { id: 'C001', name: '黑色', hex: '#1B2A36' },
        { id: 'C002', name: '驼色', hex: '#C08A2D' },
        { id: 'C003', name: '正红', hex: '#B4403A' },
        { id: 'C004', name: '藏青', hex: '#233848' },
      ],
      sizes: [
        { id: 'S', sortOrder: 1 },
        { id: 'M', sortOrder: 2 },
        { id: 'L', sortOrder: 3 },
        { id: 'XL', sortOrder: 4 },
      ],
      total: 2,
    };
  }

  /**
   * 获取价格数据
   */
  async getPrices(styleIds?: string[]): Promise<Array<{
    styleId: string;
    skuId: string;
    tagPrice: number;
    vipPrice: number;
    costPrice: number;
  }>> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 获取价格数据, 款数: ${styleIds?.length ?? '全部'}`);
    return [];
  }

  /**
   * 获取促销活动
   */
  async getPromotions(storeId?: string): Promise<Array<{
    id: string;
    name: string;
    type: string;
    threshold: number;
    discountValue: number;
    discountType: string;
    applyScope: string;
    scopeIds: string[];
    validFrom: string;
    validTo: string;
    priority: number;
    isMemberOnly: boolean;
  }>> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 获取促销活动, 门店: ${storeId ?? '全部'}`);
    return [];
  }

  /**
   * 获取会员数据
   */
  async getMembers(lastSyncTime?: string): Promise<{
    members: Array<{
      memberNo: string;
      name: string;
      phone: string;
      gender: string;
      birthday: string;
      level: string;
      points: number;
      storedValue: number;
    }>;
    total: number;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 获取会员数据 ${lastSyncTime ? '(增量)' : '(全量)'}`);
    return { members: [], total: 0 };
  }

  /**
   * 获取库存数据（总部仓库 → 门店）
   */
  async getStock(storeId: string): Promise<Array<{
    skuId: string;
    styleId: string;
    colorId: string;
    sizeId: string;
    qty: number;
  }>> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 获取库存数据, 门店: ${storeId}`);
    return [];
  }

  /**
   * 获取调拨单
   */
  async getTransfers(storeId: string): Promise<Array<{
    erpNo: string;
    fromLocation: string;
    toLocation: string;
    type: string;
    items: Array<{
      skuId: string;
      styleId: string;
      colorId: string;
      sizeId: string;
      plannedQty: number;
    }>;
  }>> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 获取调拨单, 门店: ${storeId}`);
    return [];
  }

  // ============ 上行数据（POS → ERP） ============

  /**
   * 上传销售单
   */
  async receiveSales(orderData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 接收销售单: ${orderData.orderNo}`);
    return {
      success: true,
      erpNo: `ERP-SO-${Date.now()}`,
      message: '同步成功',
    };
  }

  /**
   * 上传退货单
   */
  async receiveReturns(returnData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 接收退货单: ${returnData.returnNo}`);
    return {
      success: true,
      erpNo: `ERP-RT-${Date.now()}`,
      message: '同步成功',
    };
  }

  /**
   * 上传盘点单
   */
  async receiveStocktake(stocktakeData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 接收盘点单: ${stocktakeData.stocktakeNo}`);
    return {
      success: true,
      erpNo: `ERP-ST-${Date.now()}`,
      message: '同步成功',
    };
  }

  /**
   * 上传要货申请
   */
  async receiveTransferRequest(reqData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 接收要货申请: ${reqData.reqNo}`);
    return {
      success: true,
      erpNo: `ERP-TR-${Date.now()}`,
      message: '同步成功',
    };
  }

  /**
   * 上传日结单
   */
  async receiveEod(eodData: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }> {
    this.ensureConnected();
    this.logger.log(`[MockERP] 接收日结单: ${eodData.eodNo}`);
    return {
      success: true,
      message: '同步成功',
    };
  }

  // ============ 辅助方法 ============
  private ensureConnected(): void {
    if (!this.connectionStatus) {
      throw new Error('ERP连接已断开，当前为离线模式');
    }
  }
}
