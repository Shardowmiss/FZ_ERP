/* 前后端共享的类型定义 */

// ============ 基础列表响应 ============
export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

// ============ 主数据 ============
export interface Color {
  id: string;
  name: string;
  hex: string;
  createdAt: string;
  updatedAt: string;
}

export interface Size {
  id: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Style {
  id: string;
  name: string;
  category: string;
  colorIds: string[];
  sizeIds: string[];
  tagPrice: number;
  costPrice: number;
  status: string;
  erpSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StyleDetail extends Style {
  colors?: Color[];
  sizes?: Size[];
  stockMatrix?: StockMatrixCell[][];
  totalStock?: number;
}

export interface Sku {
  id: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  barcode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkuDetail extends Sku {
  styleName?: string;
  colorName?: string;
  sizeId_: string;
  qty?: number;
}

export interface StyleQuery extends PaginationQuery {
  keyword?: string;
  status?: string;
  category?: string;
}

export interface SkuQuery extends PaginationQuery {
  styleId?: string;
  barcode?: string;
  keyword?: string;
}

// ============ 库存 ============
export interface Stock {
  id: string;
  storeId: string;
  skuId: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  qty: number;
  inTransitQty: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockDetail extends Stock {
  styleName?: string;
  colorName?: string;
  tagPrice?: number;
}

export interface StockMatrixCell {
  colorId: string;
  colorName: string;
  sizeId: string;
  qty: number;
}

export interface StockMatrix {
  styleId: string;
  styleName: string;
  colors: Color[];
  sizes: Size[];
  matrix: Record<string, Record<string, number>>; // colorId -> sizeId -> qty
  rowTotals: Record<string, number>; // colorId -> total
  colTotals: Record<string, number>; // sizeId -> total
  grandTotal: number;
}

export interface StockQuery extends PaginationQuery {
  storeId?: string;
  styleId?: string;
  keyword?: string;
  lowStockOnly?: boolean;
}

export interface StockAdjustItem {
  skuId: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  qty: number;
}

export interface StockAdjustDto {
  storeId: string;
  type: 'increase' | 'decrease' | 'check';
  reason?: string;
  items: StockAdjustItem[];
  clientId?: string;
}

export interface LowStockAlert {
  styleId: string;
  styleName: string;
  colorId: string;
  colorName: string;
  sizeId: string;
  qty: number;
  threshold: number;
}

// ============ 零售收银 ============
export interface SaleItem {
  id?: string;
  orderId?: string;
  skuId: string;
  styleId: string;
  styleName: string;
  colorId: string;
  sizeId: string;
  qty: number;
  tagPrice: number;
  unitPrice: number;
  discountAmount: number;
  lineAmount: number;
  refundedQty?: number;
}

export interface SaleDiscount {
  id?: string;
  orderId?: string;
  promotionId?: string;
  name: string;
  type: string;
  amount: number;
}

export interface SalePayment {
  id?: string;
  orderId?: string;
  payMethod: string;
  amount: number;
  changeAmount: number;
  transactionId?: string;
}

export interface SaleOrder {
  id: string;
  orderNo: string;
  storeId: string;
  memberId?: string;
  employeeId?: string;
  /** 业务成交日期 YYYY-MM-DD。离线优先 POS 的唯一可信成交时间，上行必须携带。 */
  saleDate: string;
  totalQty: number;
  totalAmount: number;
  discountAmount: number;
  payAmount: number;
  pointsUsed: number;
  pointsEarned: number;
  status: string;
  channel: string;
  shiftId?: string;
  remark?: string;
  syncedToErp: boolean;
  syncStatus: string;
  syncAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: SaleItem[];
  discounts?: SaleDiscount[];
  payments?: SalePayment[];
  memberName?: string;
  memberPhone?: string;
  employeeName?: string;
}

export interface SaleOrderQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
  memberId?: string;
}

export interface CreateSaleOrderDto {
  storeId: string;
  memberId?: string;
  employeeId?: string;
  /** 业务成交日期 YYYY-MM-DD，由客户端在成交那一刻打戳（离线优先 POS 必须带） */
  saleDate?: string;
  items: SaleItem[];
  payments: SalePayment[];
  discounts?: SaleDiscount[];
  pointsUsed?: number;
  /** 抹零金额（元）。服务端会据此调整 payAmount，并计入折扣明细 type='rounding' */
  roundingAmount?: number;
  remark?: string;
  shiftId?: string;
  clientId?: string;
}

export interface SuspendedOrder {
  id: string;
  storeId: string;
  memberId?: string;
  employeeId?: string;
  items: SaleItem[];
  totalAmount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  memberName?: string;
  employeeName?: string;
}

export interface SuspendOrderDto {
  storeId: string;
  memberId?: string;
  employeeId?: string;
  items: SaleItem[];
  totalAmount: number;
  clientId?: string;
}

// ============ 退换货 ============
export interface ReturnItem {
  id?: string;
  returnId?: string;
  originalItemId: string;
  skuId: string;
  styleId: string;
  styleName: string;
  colorId: string;
  sizeId: string;
  qty: number;
  refundPrice: number;
  lineAmount: number;
}

export interface ReturnOrder {
  id: string;
  returnNo: string;
  originalOrderNo: string;
  storeId: string;
  memberId?: string;
  employeeId?: string;
  totalQty: number;
  refundAmount: number;
  refundMethod: string;
  status: string;
  shiftId?: string;
  remark?: string;
  syncedToErp: boolean;
  syncStatus: string;
  syncAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: ReturnItem[];
  memberName?: string;
  memberPhone?: string;
  employeeName?: string;
}

export interface ReturnOrderQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

export interface CreateReturnOrderDto {
  storeId: string;
  originalOrderNo: string;
  memberId?: string;
  employeeId?: string;
  items: ReturnItem[];
  refundMethod: string;
  remark?: string;
  shiftId?: string;
  clientId?: string;
}

// ============ 会员 ============
export interface Member {
  id: string;
  memberNo: string;
  name?: string;
  phone: string;
  gender?: string;
  birthday?: string;
  level: string;
  points: number;
  storedValue: number;
  preferSize?: string;
  preferStyle?: string;
  totalSpent: number;
  totalCount: number;
  lastPurchaseAt?: string;
  erpSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberQuery extends PaginationQuery {
  keyword?: string;
  level?: string;
  status?: string;
}

export interface CreateMemberDto {
  name?: string;
  phone: string;
  gender?: string;
  birthday?: string;
  level?: string;
  preferSize?: string;
  preferStyle?: string;
  clientId?: string;
}

export interface UpdateMemberDto {
  name?: string;
  gender?: string;
  birthday?: string;
  level?: string;
  preferSize?: string;
  preferStyle?: string;
  points?: number;
  storedValue?: number;
}

export interface PointsLog {
  id: string;
  memberId: string;
  change: number;
  balance: number;
  type: string;
  sourceNo?: string;
  remark?: string;
  createdAt: string;
}

export interface StoredLog {
  id: string;
  memberId: string;
  change: number;
  balance: number;
  type: string;
  sourceNo?: string;
  remark?: string;
  createdAt: string;
}

export interface Coupon {
  id: string;
  memberId: string;
  couponCode: string;
  name: string;
  type: string;
  discountValue: number;
  minAmount: number;
  status: string;
  validFrom?: string;
  validTo?: string;
  usedAt?: string;
  usedOrderNo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RechargeDto {
  amount: number;
  giftAmount?: number;
  payMethod?: string;
  remark?: string;
}

export interface IssueCouponDto {
  type: 'discount' | 'full_reduction';
  discountValue: number;
  minAmount?: number;
  validDays?: number;
  validFrom?: string;
  validTo?: string;
  name?: string;
}

export interface LevelCount {
  level: string;
  count: number;
}

// ============ 促销 ============
export interface Promotion {
  id: string;
  name: string;
  type: string;
  threshold?: number;
  discountValue?: number;
  discountType?: string;
  applyScope: string;
  scopeIds: string[];
  validFrom?: string;
  validTo?: string;
  status: string;
  priority: number;
  isMemberOnly: boolean;
  source: string;
  erpSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionQuery extends PaginationQuery {
  status?: string;
  type?: string;
  keyword?: string;
}

export interface CalculatePromotionItem {
  skuId: string;
  styleId: string;
  styleName: string;
  colorId: string;
  sizeId: string;
  qty: number;
  tagPrice: number;
  unitPrice: number;
  lineAmount: number;
  category?: string;
}

export interface CalculatePromotionDto {
  storeId: string;
  items: CalculatePromotionItem[];
  memberId?: string;
  memberLevel?: string;
  totalAmount: number;
}

export interface PromotionDiscountDetail {
  promotionId?: string;
  promotionName: string;
  promotionType: string;
  discountAmount: number;
  applyToItems?: {
    skuId: string;
    discountAmount: number;
  }[];
}

export interface PromotionCalculateResult {
  totalAmount: number;
  totalDiscount: number;
  finalAmount: number;
  discounts: PromotionDiscountDetail[];
  bestCombination: string[];
}

// ============ 门店库存管理 ============
export interface Transfer {
  id: string;
  transferNo: string;
  type: string;
  storeId: string;
  fromLocation?: string;
  toLocation?: string;
  totalQty: number;
  status: string;
  source: string;
  erpNo?: string;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: TransferItem[];
}

export interface TransferItem {
  id?: string;
  transferId?: string;
  skuId: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  plannedQty: number;
  receivedQty: number;
}

export interface TransferQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  type?: string;
  keyword?: string;
}

export interface TransferRequest {
  id: string;
  reqNo: string;
  storeId: string;
  employeeId?: string;
  totalQty: number;
  status: string;
  remark?: string;
  syncedToErp: boolean;
  syncStatus: string;
  syncAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: TransferRequestItem[];
  employeeName?: string;
}

export interface TransferRequestItem {
  id?: string;
  reqId?: string;
  skuId: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  reqQty: number;
}

export interface CreateTransferRequestDto {
  storeId: string;
  employeeId?: string;
  remark?: string;
  items: TransferRequestItem[];
}

export interface Stocktake {
  id: string;
  stocktakeNo: string;
  storeId: string;
  type: string;
  status: string;
  totalQty: number;
  diffQty: number;
  employeeId?: string;
  auditedAt?: string;
  syncedToErp: boolean;
  syncStatus: string;
  syncAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: StocktakeItem[];
  employeeName?: string;
}

export interface StocktakeItem {
  id?: string;
  stocktakeId?: string;
  skuId: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  bookQty: number;
  actualQty: number;
  diffQty: number;
}

export interface StocktakeQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  keyword?: string;
}

export interface CreateStocktakeDto {
  storeId: string;
  type: string;
  employeeId?: string;
  items: StocktakeItem[];
}

export interface StockAdjustment {
  id: string;
  adjustNo: string;
  storeId: string;
  type: string;
  reason?: string;
  totalQty: number;
  totalAmount: number;
  status: string;
  employeeId?: string;
  employeeName?: string;
  syncedToErp: boolean;
  syncStatus: string;
  syncAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: StockAdjustItem[];
}

export interface StockAdjustmentQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  type?: string;
  keyword?: string;
}

// ============ 交接班与日结 ============
export interface Shift {
  id: string;
  shiftNo: string;
  storeId: string;
  cashierId?: string;
  startTime: string;
  endTime?: string;
  openingCash: number;
  closingCash?: number;
  status: string;
  saleCount: number;
  saleAmount: number;
  refundAmount: number;
  cashExpected?: number;
  cashActual?: number;
  cashDiff?: number;
  createdAt: string;
  updatedAt: string;
  cashierName?: string;
}

export interface ShiftQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface OpenShiftDto {
  storeId: string;
  cashierId: string;
  openingCash: number;
}

export interface CloseShiftDto {
  closingCash: number;
  cashActual: number;
}

export interface Eod {
  id: string;
  eodNo: string;
  storeId: string;
  eodDate: string;
  status: string;
  totalSales: number;
  totalRefund: number;
  totalDiscount: number;
  netSales: number;
  orderCount: number;
  itemCount: number;
  customerCount: number;
  avgTicket: number;
  attachRate: number;
  memberSaleRatio: number;
  closedAt?: string;
  syncedToErp: boolean;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
  payments?: EodPayment[];
}

export interface EodPayment {
  id?: string;
  eodId?: string;
  payMethod: string;
  saleAmount: number;
  refundAmount: number;
  netAmount: number;
}

export interface EodQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

// ============ 全渠道履约 ============
export interface OmnichannelOrder {
  id: string;
  orderNo: string;
  channel: string;
  type: string;
  storeId: string;
  memberName?: string;
  memberPhone?: string;
  totalAmount: number;
  status: string;
  address?: string;
  pickupCode?: string;
  pickedAt?: string;
  shippedAt?: string;
  sourceNo?: string;
  createdAt: string;
  updatedAt: string;
  items?: OmnichannelItem[];
}

export interface OmnichannelItem {
  id?: string;
  orderId?: string;
  skuId: string;
  styleId: string;
  styleName: string;
  colorId: string;
  sizeId: string;
  qty: number;
  price: number;
}

export interface OmnichannelQuery extends PaginationQuery {
  storeId?: string;
  status?: string;
  type?: string;
  channel?: string;
  keyword?: string;
}

export interface ShipOrderDto {
  logisticsCompany?: string;
  trackingNo?: string;
}

// ============ ERP集成 ============
export interface ErpConnectionStatus {
  connected: boolean;
  lastHeartbeat?: string;
  mode: 'online' | 'offline';
  downstreamCount: number;
  upstreamPending: number;
  upstreamFailed: number;
}

export interface ErpSyncStatus {
  dataType: string;
  dataName: string;
  direction: 'downstream' | 'upstream';
  lastSyncAt?: string;
  lastSyncStatus: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
}

export interface SyncLog {
  id: string;
  direction: string;
  dataType: string;
  docNo?: string;
  status: string;
  response?: string;
  retryCount: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncLogQuery extends PaginationQuery {
  direction?: string;
  dataType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

// ============ 系统设置 ============
export interface Store {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  name: string;
  code: string;
  role: string;
  storeId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeQuery extends PaginationQuery {
  storeId?: string;
  role?: string;
  status?: string;
  keyword?: string;
}

export interface PaymentMethod {
  code: string;
  name: string;
  type: string;
  enabled: boolean;
  sortOrder: number;
}

export interface PointsRule {
  id: string;
  name: string;
  pointsPerYuan: number;
  minAmount: number;
  enabled: boolean;
}

export interface OperationLog {
  id: string;
  storeId?: string;
  employeeId?: string;
  module: string;
  action: string;
  targetNo?: string;
  content?: string;
  createdAt: string;
  employeeName?: string;
}

export interface OperationLogQuery extends PaginationQuery {
  storeId?: string;
  module?: string;
  action?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

// ============ 经营报表 ============
export interface TodayKpi {
  totalSales: number;
  orderCount: number;
  itemCount: number;
  customerCount: number;
  avgTicket: number;
  attachRate: number;
  memberSaleRatio: number;
  totalRefund: number;
  totalDiscount: number;
  netSales: number;
  comparedYesterday: {
    totalSales: number;
    orderCount: number;
    growthRate: number;
  };
}

export interface SalesTrendPoint {
  period: string;
  sales: number;
  orders: number;
  refunds: number;
}

export interface SalesTrendQuery {
  storeId?: string;
  startDate: string;
  endDate: string;
  granularity: 'hour' | 'day';
}

export interface TopStyleItem {
  styleId: string;
  styleName: string;
  category: string;
  qty: number;
  amount: number;
  rank: number;
}

export interface TopStyleQuery extends PaginationQuery {
  storeId?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
}

export interface EmployeeRankingItem {
  employeeId: string;
  employeeName: string;
  role: string;
  salesAmount: number;
  orderCount: number;
  avgTicket: number;
  rank: number;
}

export interface EmployeeRankingQuery extends PaginationQuery {
  storeId?: string;
  startDate?: string;
  endDate?: string;
}

export interface CategorySalesItem {
  category: string;
  salesAmount: number;
  qty: number;
  percentage: number;
  rank: number;
}

export interface CategorySalesQuery {
  storeId?: string;
  startDate?: string;
  endDate?: string;
}

// ============ 离线同步 ============
export type OfflineEntityType = 'sale_order' | 'return_order' | 'member' | 'stock_adjust' | 'stocktake' | 'transfer_request' | 'suspended_order';

export interface OfflineQueueItem {
  id: string;
  storeId: string;
  clientId: string;
  entityType: OfflineEntityType;
  entityData: Record<string, any>;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  retryCount: number;
  errorMessage?: string;
  serverEntityId?: string;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineSyncBatchDto {
  storeId: string;
  items: {
    clientId: string;
    entityType: OfflineEntityType;
    entityData: Record<string, any>;
  }[];
}

export interface OfflineSyncResult {
  clientId: string;
  success: boolean;
  serverEntityId?: string;
  errorMessage?: string;
  conflictType?: string;
}

export interface OfflineQueueQuery extends PaginationQuery {
  storeId?: string;
  syncStatus?: string;
  entityType?: OfflineEntityType;
}

// 主数据批量同步
/**
 * 增量快照中的「删除通知」（墓碑）。
 *
 * 离线引擎只靠 `updatedAt > since` 拿不到被删除的行——软删除仅置位 `deletedAt`，
 * 若不同步这段通知，客户端本地会长期残留已下架/已停用的主数据（收银台能扫到已下架条码）。
 *
 * 约定：**数组为空 / 字段缺失 = 本轮无删除**，客户端不得据此清空本地；
 * 只有非空数组才执行删除。这样"漏一次删除"最多残留一行，不会整类清空。
 */
export interface MasterDataDeletions {
  colors: string[];
  sizes: string[];
  styles: string[];
  skus: string[];
  promotions: string[];
  members: string[];
  stock: string[];
}

export interface MasterDataSnapshot {
  version: string;
  snapshotAt: string;
  colors: Color[];
  sizes: Size[];
  styles: Style[];
  skus: Sku[];
  promotions: Promotion[];
  members: Member[];
  stock: Stock[];
  store: { id: string; name: string; code: string };
  /** P-1 补：增量快照中的删除通知。全量快照不带该字段（全量本身即权威全量）。 */
  deleted?: MasterDataDeletions;
}
