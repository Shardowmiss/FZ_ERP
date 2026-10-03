export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** keyset 游标分页的下一页游标。使用游标分页时 total 为当页行数（非全量），以 nextCursor 是否有值判断是否有下一页。 */
  nextCursor?: string;
}

export interface ColorGroup {
  id: string;
  code: string;
  name: string;
  colors: { name: string; value: string }[];
  createdAt: string;
}

/** 颜色主数据（独立实体，对应 color 表；弃用 color_group 内嵌 colors 后改用此表） */
export interface Color {
  id: string;
  code: string;
  name: string;
  hex: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
}

/** 尺码主数据（独立实体，对应 size 表；与 size_group 通过 size_group_size 关联表建立多对多关系） */
export interface Size {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface SizeGroup {
  id: string;
  code: string;
  name: string;
  sizes: string[];
  createdAt: string;
}

/** 尺码组与尺码的关系行（size_group_size 关联表），由 size-group 成员接口返回 */
export interface SizeGroupSize {
  sizeGroupId: string;
  sizeId: string;
  sizeCode: string;
  sizeName: string;
  sortOrder: number;
}

export interface Style {
  id: string;
  styleNo: string;
  name: string;
  category?: string;
  subCategory?: string;
  season?: string;
  year?: string;
  fit?: string;
  brand?: string;
  wave?: string;
  tagPrice: number;
  costPrice: number;
  supplyPrice: number;
  colorGroupId: string;
  sizeGroupId: string;
  status: string;
  remark?: string;
  createdAt: string;
  attributes: Record<string, string>;
}

export interface Sku {
  id: string;
  skuCode: string;
  styleId: string;
  styleNo: string;
  color: string;
  size: string;
  colorId?: string;
  sizeId?: string;
  barcode?: string;
  costPrice: number;
  tagPrice: number;
  supplyPrice: number;
  safetyStockMin: number;
  safetyStockMax: number;
  status: string;
  createdAt: string;
}

export interface Material {
  id: string;
  code: string;
  name: string;
  spec?: string;
  unit: string;
  defaultSupplierId?: string;
  stdPrice: number;
  category?: string;
  remark?: string;
  status: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  supplyCategory?: string;
  remark?: string;
  status: string;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  address?: string;
  remark?: string;
  status: string;
  createdAt: string;
}

export interface Bom {
  id: string;
  styleId: string;
  styleNo: string;
  version: string;
  remark?: string;
  status: string;
  createdAt: string;
  items?: BomItem[];
}

export interface BomItem {
  id: string;
  bomId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  usagePerPiece: number;
  lossRate: number;
  bomType: string;
  remark?: string;
}

export interface PurchaseOrder {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectDate?: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  orderId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  receivedQty: number;
}

/**
 * 采购订单单据状态机：
 * draft(新增) → audited(审核) → booked(记账) → accepted(验收)
 *  - 新增：草稿态，可编辑/删除/提交审核
 *  - 审核：已审核，锁定不可修改；可取消审核回退草稿，或记账
 *  - 记账：订单真正生效，可作为后续单据（入库/退货/应付）的导入源
 *  - 验收：入库验收环节最终验收完成后的终态
 */
export const PurchaseOrderStatus = {
  DRAFT: 'draft',
  AUDITED: 'audited',
  BOOKED: 'booked',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
} as const;

export type PurchaseOrderStatusValue = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export const PURCHASE_ORDER_STATUS_VALUES: PurchaseOrderStatusValue[] = Object.values(PurchaseOrderStatus);

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: '新增',
  audited: '审核',
  booked: '记账',
  accepted: '验收',
  cancelled: '已作废',
};

export const PURCHASE_ORDER_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  audited: 'bg-orange-100 text-orange-600',
  booked: 'bg-blue-100 text-blue-600',
  accepted: 'bg-green-100 text-green-600',
  cancelled: 'bg-red-100 text-red-600',
};

/**
 * 销售订单状态机（到记账为止，无验收环节）：
 * draft(新增) → audited(审核) → booked(记账)
 *  - 新增：草稿态，可编辑/删除
 *  - 审核：已审核，锁定不可修改；可取消审核回退草稿，或记账
 *  - 记账：订单真正生效（下游出库/退单可引用），为终态
 * 说明：验收环节存在于「销售单(出库)」与「销售退单」，销售订单本身不参与验收。
 */
export const SalesOrderStatus = {
  DRAFT: 'draft',
  AUDITED: 'audited',
  BOOKED: 'booked',
  CANCELLED: 'cancelled',
} as const;

export type SalesOrderStatusValue = (typeof SalesOrderStatus)[keyof typeof SalesOrderStatus];

export const SALES_ORDER_STATUS_VALUES: SalesOrderStatusValue[] = Object.values(SalesOrderStatus);

export const SALES_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: '新增',
  audited: '审核',
  booked: '记账',
  cancelled: '已作废',
};

export const SALES_ORDER_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  audited: 'bg-orange-100 text-orange-600',
  booked: 'bg-blue-100 text-blue-600',
  cancelled: 'bg-red-100 text-red-600',
};

export const SalesOutboundStatus = {
  DRAFT: 'draft',
  AUDITED: 'audited',
  BOOKED: 'booked',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
} as const;

export type SalesOutboundStatusValue = (typeof SalesOutboundStatus)[keyof typeof SalesOutboundStatus];

export const SALES_OUTBOUND_STATUS_VALUES: SalesOutboundStatusValue[] = Object.values(SalesOutboundStatus);

export const SALES_OUTBOUND_STATUS_LABELS: Record<string, string> = {
  draft: '新增',
  audited: '审核',
  booked: '记账',
  accepted: '验收',
  cancelled: '已作废',
};

export const SALES_OUTBOUND_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  audited: 'bg-orange-100 text-orange-600',
  booked: 'bg-blue-100 text-blue-600',
  accepted: 'bg-green-100 text-green-600',
  cancelled: 'bg-red-100 text-red-600',
};

export const SalesReturnStatus = {
  DRAFT: 'draft',
  AUDITED: 'audited',
  BOOKED: 'booked',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
} as const;

export type SalesReturnStatusValue = (typeof SalesReturnStatus)[keyof typeof SalesReturnStatus];

export const SALES_RETURN_STATUS_VALUES: SalesReturnStatusValue[] = Object.values(SalesReturnStatus);

export const SALES_RETURN_STATUS_LABELS: Record<string, string> = {
  draft: '新增',
  audited: '审核',
  booked: '记账',
  accepted: '验收',
  cancelled: '已作废',
};

export const SALES_RETURN_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  audited: 'bg-orange-100 text-orange-600',
  booked: 'bg-blue-100 text-blue-600',
  accepted: 'bg-green-100 text-green-600',
  cancelled: 'bg-red-100 text-red-600',
};

export interface PurchaseInbound {
  id: string;
  inboundNo: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  inboundDate: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: PurchaseInboundItem[];
}

export interface PurchaseInboundItem {
  id: string;
  inboundId: string;
  orderItemId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo?: string;
}

export interface PurchaseReturn {
  id: string;
  returnNo: string;
  inboundId: string;
  inboundNo: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  returnDate: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: PurchaseReturnItem[];
}

export interface PurchaseReturnItem {
  id: string;
  returnId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo?: string;
}

export interface SalesOrder {
  id: string;
  orderNo: string;
  dealerId: string;
  customerName: string;
  orderDate: string;
  deliveryDate?: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: SalesOrderItem[];
}

export interface SalesOrderItem {
  id: string;
  orderId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  deliveredQty: number;
}

export interface SalesOutbound {
  id: string;
  outboundNo: string;
  orderId: string;
  orderNo: string;
  dealerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  outboundDate: string;
  totalAmount: number;
  costAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: SalesOutboundItem[];
}

export interface SalesOutboundItem {
  id: string;
  outboundId: string;
  orderItemId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  costPrice: number;
  amount: number;
  costAmount: number;
  batchNo?: string;
}

export interface SalesReturn {
  id: string;
  returnNo: string;
  outboundId: string;
  outboundNo: string;
  dealerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  returnDate: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: SalesReturnItem[];
}

export interface SalesReturnItem {
  id: string;
  returnId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo?: string;
}

export interface InventoryFlow {
  id: string;
  flowType: string;
  bizNo: string;
  direction: string;
  itemType: string;
  skuId?: string;
  materialId?: string;
  styleNo?: string;
  color?: string;
  size?: string;
  materialCode?: string;
  materialName?: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  batchNo?: string;
  unitPrice?: number;
  operator?: string;
  remark?: string;
  createdAt: string;
}

export interface InventoryStock {
  id: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  brand?: string;
  color: string;
  size: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

export interface MaterialStock {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

export interface InventoryTransfer {
  id: string;
  transferNo: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  fromStoreId?: string;
  fromStoreName?: string;
  toStoreId?: string;
  toStoreName?: string;
  transferDate: string;
  itemType: string;
  status: string;
  remark?: string;
  createdAt: string;
  items?: InventoryTransferItem[];
}

export interface InventoryTransferItem {
  id: string;
  transferId: string;
  skuId?: string;
  materialId?: string;
  itemCode: string;
  itemName: string;
  color?: string;
  size?: string;
  quantity: number;
}

export interface InventoryStocktake {
  id: string;
  stocktakeNo: string;
  warehouseId: string;
  warehouseName: string;
  stocktakeDate: string;
  itemType: string;
  status: string;
  remark?: string;
  createdAt: string;
  items?: InventoryStocktakeItem[];
}

export interface InventoryStocktakeItem {
  id: string;
  stocktakeId: string;
  skuId?: string;
  materialId?: string;
  itemCode: string;
  itemName: string;
  color?: string;
  size?: string;
  bookQty: number;
  actualQty: number;
  diffQty: number;
}

export interface Receivable {
  id: string;
  receivableNo: string;
  dealerId: string;
  customerName: string;
  bizType: string;
  bizNo: string;
  amount: number;
  receivedAmount: number;
  balance: number;
  dueDate?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface Payable {
  id: string;
  payableNo: string;
  supplierId: string;
  supplierName: string;
  bizType: string;
  bizNo: string;
  amount: number;
  paidAmount: number;
  balance: number;
  dueDate?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface DashboardStats {
  todaySales: number;
  todayRetail: number;
  todayOutboundCount: number;
  totalSkuCount: number;
  pendingDocCount: number;
}

export interface SalesTrendItem {
  date: string;
  amount: number;
}

export interface TopStyleItem {
  styleNo: string;
  name: string;
  quantity: number;
  amount: number;
}

export interface InventoryWarningItem {
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseName: string;
  quantity: number;
  safetyMin: number;
  safetyMax: number;
  warningType: 'below_min' | 'above_max';
}

export interface ProfitAnalysis {
  orderNo: string;
  customerName: string;
  salesAmount: number;
  materialCost: number;
  outboundCost: number;
  profit: number;
  profitRate: number;
  items: ProfitAnalysisItem[];
}

export interface ProfitAnalysisItem {
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  salesAmount: number;
  unitCost: number;
  costAmount: number;
  unitProfit: number;
  profit: number;
}

export interface CostSimulationItem {
  materialCode: string;
  materialName: string;
  unit: string;
  usagePerPiece: number;
  lossRate: number;
  grossUsage: number;
  unitPrice: number;
  cost: number;
  bomType: string;
}

export interface CostSimulationResult {
  styleNo: string;
  styleName: string;
  totalMaterialCost: number;
  items: CostSimulationItem[];
}

export interface GrossRequirementResult extends CostSimulationResult {
  quantity: number;
}

// ===== 编码规则配置 =====

export type CodeRuleSegmentType =
  | 'fixed'       // 固定字符
  | 'year'        // 年份
  | 'season'      // 季节
  | 'brand'       // 品牌
  | 'category'    // 商品大类
  | 'subCategory' // 商品小类
  | 'fit'         // 版型
  | 'serial'      // 流水号
  | 'separator'   // 连接符
  | 'attribute';  // 动态属性

export interface CodeRuleSegment {
  id: string;
  type: CodeRuleSegmentType;
  enabled: boolean;
  order: number;
  config?: {
    value?: string;           // fixed: 固定字符值
    yearFormat?: '4' | '2';   // year: 年份格式
    serialDigits?: number;    // serial: 流水号位数
    serialReset?: 'year' | 'category' | 'never'; // serial: 重置方式
    separator?: '' | '-' | '/'; // separator: 连接符样式
    attrCode?: string;        // attribute: 动态属性编码
  };
}

export interface CodeRule {
  id: string;
  name: string;
  segments: CodeRuleSegment[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// 年份编码映射
export interface YearCode {
  name: string;  // 2024年、2025年
  code: string;  // 2024、2025
}

// 季节编码映射
export interface SeasonCode {
  name: string;  // 春/夏/秋/冬
  code: string;  // SP/SU/AW/WI
}

// 商品大类编码映射
export interface CategoryCode {
  name: string;   // 上衣/裤装/裙装/外套
  code: string;   // SY/KZ/QZ/WT
}

// 商品小类编码映射
export interface SubCategoryCode {
  category: string;  // 所属大类name
  name: string;      // T恤/衬衫
  code: string;      // TX/CS
}

// 版型编码映射
export interface FitCode {
  name: string;  // 修身/常规/宽松/Oversize
  code: string;  // X/B/K/O
}

// 品牌编码映射
export interface BrandCode {
  name: string;
  code: string;
  sortOrder?: number;
  status?: string;
}

// 颜色编码映射
export interface ColorCodeMap {
  name: string;  // 颜色中文名
  code: string;  // BLK/WHT/GRY
}

// 尺码编码映射
export interface SizeCodeMap {
  name: string;  // 尺码名
  code: string;  // S/M/L/XL/28
}

// 编码映射配置（所有映射的聚合）
export interface CodeMappingConfig {
  years: YearCode[];
  seasons: SeasonCode[];
  brands: BrandCode[];
  categories: CategoryCode[];
  subCategories: SubCategoryCode[];
  fits: FitCode[];
  colors: ColorCodeMap[];
  sizes: SizeCodeMap[];
  attrValues: Record<string, Array<{ name: string; code: string }>>;
}

// 款号预览请求
export interface StyleCodePreviewRequest {
  year: string;
  season: string;
  brand?: string;
  category: string;
  subCategory: string;
  fit: string;
  serialNo?: string; // 可选，不传则取下一个流水号
  attributes?: Record<string, string>; // 动态属性值
}

// 款号预览结果
export interface StyleCodePreviewResult {
  styleNo: string;
  breakdown: Array<{ segmentType: string; segmentName: string; value: string; }>;
}

// 款号属性定义（动态）
export interface StyleAttrDef {
  id: string;
  attrCode: string;
  attrName: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
  values?: StyleAttrValue[];
}

// 款号属性值（动态）
export interface StyleAttrValue {
  id: string;
  attrDefId: string;
  valueCode: string;
  valueName: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
}

// 款号属性
export type StyleAttrType = 'year' | 'season' | 'category' | 'sub_category' | 'fit' | 'brand';

export interface StyleAttribute {
  id: string;
  attrType: string;
  attrCode: string;
  attrName: string;
  sortOrder: number;
  status: string;
  parentCode?: string;
  remark?: string;
  createdAt: string;
}

// 新建款号表单（自动编码版）
export interface StyleCreateAutoRequest {
  name: string;
  year: string;
  season: string;
  brand?: string;
  category: string;
  subCategory: string;
  fit: string;
  wave?: string;
  tagPrice: number;
  costPrice: number;
  supplyPrice: number;
  colorGroupId: string;
  sizeGroupId: string;
  remark?: string;
  attributes?: Record<string, string>; // 动态属性值
  skus: Array<{
    costPrice: number;
    tagPrice: number;
    supplyPrice: number;
  }>;
}

export interface Dealer {
  id: string;
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

// ===== 订货会模块 =====

export interface TradeShow {
  id: string;
  showNo: string;
  name: string;
  year?: string;
  season?: string;
  startDate?: string;
  endDate?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

/** #8 订货会主题主数据（迁移 0029 / server/modules/trade-show/theme.service.ts） */
export interface TradeShowTheme {
  id: string;
  themeCode: string;
  themeName: string;
  year?: string;
  season?: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
}

/** #11 会员等级主数据（迁移 0031 / server/modules/member/member-level.service.ts） */
export interface MemberLevel {
  id: string;
  code: string;
  name: string;
  /** cumulative | monthly | quarterly */
  conditionType: string;
  /** 对应周期累计消费金额门槛 */
  thresholdAmount: number;
  /** 正常折扣（0.85 = 8.5 折） */
  discount: number;
  /** 是否支持折上折 */
  discountOnPromo: boolean;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface PreOrderItem {
  id: string;
  preOrderId: string;
  skuId: string;
  skuCode: string;
  color?: string;
  size?: string;
  qty: number;
}

export interface PreOrder {
  id: string;
  preOrderNo: string;
  tradeShowId: string;
  tradeShowName: string;
  submitterType: string;
  dealerId?: string;
  dealerName?: string;
  storeId?: string;
  storeName?: string;
  styleId?: string;
  styleNo?: string;
  styleName?: string;
  totalQty: number;
  status: string;
  remark?: string;
  submitDate?: string;
  confirmDate?: string;
  createdAt: string;
  items?: PreOrderItem[];
}

export interface AllocationItem {
  id: string;
  allocationId: string;
  preOrderId?: string;
  submitterType: string;
  dealerId?: string;
  dealerName?: string;
  storeId?: string;
  storeName?: string;
  skuId: string;
  skuCode: string;
  color?: string;
  size?: string;
  preQty: number;
  allocatedQty: number;
  generatedDocType?: string;
  generatedDocId?: string;
  generatedDocNo?: string;
}

export interface AllocationOrder {
  id: string;
  allocationNo: string;
  tradeShowId: string;
  tradeShowName: string;
  styleId: string;
  styleNo: string;
  styleName: string;
  totalArrivedQty: number;
  totalAllocatedQty: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: AllocationItem[];
}

export interface PreOrderSummaryBreakdown {
  partyId: string;
  partyName: string;
  partyType: string;
  qty: number;
}

export interface PreOrderSummary {
  styleId: string;
  styleNo: string;
  styleName: string;
  brand?: string;
  totalQty: number;
  breakdown: PreOrderSummaryBreakdown[];
}

export interface PreOrderSkuSummaryItem {
  skuId: string;
  color: string;
  size: string;
  totalQty: number;
  breakdown: PreOrderSummaryBreakdown[];
}

export interface PreOrderSkuSummary {
  styleId: string;
  styleNo: string;
  styleName: string;
  items: PreOrderSkuSummaryItem[];
}

export interface Store {
  id: string;
  code: string;
  name: string;
  storeType: string;
  dealerId?: string;
  warehouseId?: string;
  /** 绑定仓库编码（店仓逻辑统一视图：store LEFT JOIN warehouse） */
  warehouseCode?: string;
  /** 绑定仓库名称 */
  warehouseName?: string;
  /** 绑定仓库类型（如 main/store/transit，对应 warehouse.type） */
  warehouseType?: string;
  /** 绑定仓库自身携带的门店编码（店仓合一设计冗余字段） */
  warehouseStoreCode?: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface RetailPayMethod {
  method: string;
  amount: string;
}

export interface RetailOrderItem {
  id: string;
  retailId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color?: string;
  size?: string;
  quantity: number;
  tagPrice: number;
  dealPrice: number;
  discountRate?: number;
  lineAmount: number;
}

export interface RetailOrder {
  id: string;
  retailNo: string;
  storeId: string;
  storeName: string;
  saleDate: string;
  cashierName?: string;
  memberId?: string;
  source: string;
  totalAmount: number;
  discountAmount: number;
  receivableAmount: number;
  receivedAmount: number;
  changeAmount: number;
  payMethods: RetailPayMethod[];
  itemCount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: RetailOrderItem[];
}

export interface RetailReturn {
  id: string;
  returnNo: string;
  originalRetailId: string;
  originalRetailNo: string;
  storeId: string;
  storeName: string;
  returnDate: string;
  totalAmount: number;
  refundMethods: RetailPayMethod[];
  status: string;
  remark?: string;
  createdAt: string;
  items?: { retailItemId: string; skuId: string; skuCode: string; color?: string; size?: string; quantity: number; dealPrice: number; amount: number }[];
}

export interface RetailReportSummary {
  totalAmount: number;
  returnAmount: number;
  netAmount: number;
  orderCount: number;
  returnOrderCount: number;
  avgOrderAmount: number;
  avgItemPrice: number;
  totalItemQty: number;
}

export interface RetailStoreRankItem {
  storeId: string;
  storeName: string;
  amount: number;
  orderCount: number;
}

export interface RetailStyleTopItem {
  styleNo: string;
  styleName: string;
  brand?: string;
  qty: number;
  amount: number;
}

export interface RetailPayMethodStat {
  method: string;
  amount: number;
}

export interface RetailTrendItem {
  date: string;
  amount: number;
  orderCount: number;
}

export interface MonthCloseRecord {
  id: string;
  month: string;
  status: 'open' | 'closed';
  closedBy?: string;
  closedByName?: string;
  closedAt?: string;
  remark?: string;
  openingQty: number;
  openingAmount: number;
  inboundQty: number;
  inboundAmount: number;
  outboundQty: number;
  outboundAmount: number;
  closingQty: number;
  closingAmount: number;
  createdAt: string;
}

export interface MonthCloseDetail {
  id: string;
  dimensionType: string;
  brand?: string;
  warehouseId?: string;
  warehouseName?: string;
  flowType?: string;
  qty: number;
  amount: number;
}

export interface MonthCloseDetailResponse {
  opening: MonthCloseDetail[];
  inboundByType: MonthCloseDetail[];
  outboundByType: MonthCloseDetail[];
  closing: MonthCloseDetail[];
  receivableAmount: number;
  payableAmount: number;
}

export interface RbacUser {
  id: string;
  username: string;
  name: string;
  phone?: string;
  department?: string;
  status: string;
  remark?: string;
  language?: string;
  roleIds?: string[];
  roleCodes?: string[];
  createdAt: string;
}

export interface RbacRole {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: string;
}

export interface RbacPermission {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId?: string;
  sortOrder: number;
  children?: RbacPermission[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: RbacUser;
  menus: RbacPermission[];
  permissions: string[];
}

export interface CurrentUserResponse {
  user: RbacUser;
  menus: RbacPermission[];
  permissions: string[];
}

export interface ReportPurchaseItem {
  inboundNo: string;
  inboundDate: string;
  supplierName: string;
  brand: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  warehouseName: string;
  purchaser: string;
  status: string;
}

export interface ReportSalesItem {
  outboundNo: string;
  outboundDate: string;
  customerName: string;
  brand: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  tagPrice: number;
  dealPrice: number;
  discountRate: number;
  amount: number;
  warehouseName: string;
  salesperson: string;
  status: string;
}

export interface ReportRetailItem {
  retailNo: string;
  saleDate: string;
  storeName: string;
  cashierName: string;
  brand: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  dealPrice: number;
  amount: number;
  payMethod: string;
  status: string;
}

export interface ReportRetailSummary {
  orderCount: number;
  totalQty: number;
  totalAmount: number;
  avgPrice: number;
}

export interface ReportInventoryItem {
  brand: string;
  styleNo: string;
  styleName: string;
  color: string;
  size: string;
  warehouseName: string;
  quantity: number;
  inTransitQty: number;
  availableQty: number;
  unitCost: number;
  stockAmount: number;
}

export interface ReportTransferItem {
  transferNo: string;
  transferDate: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  brand: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  status: string;
}

export interface ReportStockMovementItem {
  brand: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseName: string;
  beginQty: number;
  purchaseInQty: number;
  salesOutQty: number;
  retailOutQty: number;
  transferNetQty: number;
  endQty: number;
  endAmount: number;
}

export interface ReportSummaryBase {
  totalQty: number;
  totalAmount: number;
}

// ========== 款号成衣采购 ==========

export interface GarmentPurchaseOrder {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectDate?: string;
  brand?: string;
  buyer?: string;
  totalAmount: number;
  totalQty: number;
  status: string;
  remark?: string;
  createdAt: string;
  skus?: GarmentPurchaseOrderSku[];
  styles?: GarmentPurchaseStyleBlock[];
}

export interface GarmentPurchaseOrderSku {
  id: string;
  orderId: string;
  styleId: string;
  styleNo: string;
  skuId: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  receivedQty: number;
}

export interface GarmentPurchaseStyleBlock {
  styleId: string;
  styleNo: string;
  styleName?: string;
  colors: string[];
  sizes: string[];
  qtyMatrix: Record<string, Record<string, number>>;
  priceMatrix: Record<string, Record<string, number>>;
}

export interface GarmentPurchaseOrderCreateDto {
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectDate?: string;
  brand?: string;
  buyer?: string;
  remark?: string;
  skus: {
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
  }[];
}

export interface GarmentPurchaseOrderUpdateDto {
  supplierId?: string;
  supplierName?: string;
  orderDate?: string;
  expectDate?: string;
  brand?: string;
  buyer?: string;
  remark?: string;
  skus?: {
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
  }[];
}

export interface GarmentPurchaseInbound {
  id: string;
  inboundNo: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  inboundDate: string;
  totalAmount: number;
  totalQty: number;
  status: string;
  remark?: string;
  createdAt: string;
  skus?: GarmentPurchaseInboundSku[];
}

export interface GarmentPurchaseInboundSku {
  id: string;
  inboundId: string;
  orderSkuId?: string;
  styleId: string;
  styleNo: string;
  skuId: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo?: string;
}

export interface GarmentPurchaseInboundCreateDto {
  orderId: string;
  warehouseId: string;
  warehouseName: string;
  inboundDate: string;
  remark?: string;
  skus: {
    orderSkuId?: string;
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
    batchNo?: string;
  }[];
}

export interface GarmentPurchaseReturn {
  id: string;
  returnNo: string;
  inboundId: string;
  inboundNo: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  returnDate: string;
  totalAmount: number;
  totalQty: number;
  status: string;
  remark?: string;
  createdAt: string;
  skus?: GarmentPurchaseReturnSku[];
}

export interface GarmentPurchaseReturnSku {
  id: string;
  returnId: string;
  inboundSkuId?: string;
  styleId: string;
  styleNo: string;
  skuId: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo?: string;
}

export interface GarmentPurchaseReturnCreateDto {
  inboundId: string;
  returnDate: string;
  remark?: string;
  skus: {
    inboundSkuId?: string;
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
    batchNo?: string;
  }[];
}

// ========== 面辅料采购（生产管理模块） ==========

export interface MaterialPurchaseOrder {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectDate?: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: MaterialPurchaseOrderItem[];
}

export interface MaterialPurchaseOrderItem {
  id: string;
  orderId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  receivedQty: number;
}

export interface MaterialPurchaseOrderCreateDto {
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectDate?: string;
  remark?: string;
  items: {
    materialId: string;
    materialCode: string;
    materialName: string;
    unit: string;
    quantity: number;
    price: number;
  }[];
}

export interface MaterialPurchaseOrderUpdateDto {
  supplierId?: string;
  supplierName?: string;
  orderDate?: string;
  expectDate?: string;
  remark?: string;
  items?: {
    materialId: string;
    materialCode: string;
    materialName: string;
    unit: string;
    quantity: number;
    price: number;
  }[];
}

export interface MaterialPurchaseInbound {
  id: string;
  inboundNo: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  inboundDate: string;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: MaterialPurchaseInboundItem[];
}

export interface MaterialPurchaseInboundItem {
  id: string;
  inboundId: string;
  orderItemId?: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo?: string;
}

export interface MaterialPurchaseInboundCreateDto {
  orderId: string;
  warehouseId: string;
  warehouseName: string;
  inboundDate: string;
  remark?: string;
  items: {
    orderItemId?: string;
    materialId: string;
    materialCode: string;
    materialName: string;
    unit: string;
    quantity: number;
    price: number;
    batchNo?: string;
  }[];
}

// ========== MRP 物料需求计算 ==========

export interface MrpRequest {
  styleId: string;
  quantity: number;
  bomVersion?: string;
  /** 安全库存比例（占毛需求的百分比，0~1）。默认 0 即不保留安全库存缓冲；未传时回退到物料主数据的 safetyStockPct 默认值。 */
  safetyStockPct?: number;
  /** 最小订货量 MOQ。默认 0 即不向上取整；未传时回退到物料主数据的 moq 默认值。 */
  moq?: number;
  /** 指定仓库时，按该仓库的"在库 + 已发料占用"做逐仓净需求测算；不传则为跨仓汇总（并附带分仓在库分布）。 */
  warehouseId?: string;
}

export interface MrpResultItem {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  bomType: string;
  usagePerPiece: number;
  lossRate: number;
  grossDemand: number;
  stockQty: number;
  /** 在途采购占用：已下单未收齐的采购订单欠交量（全局，不按仓拆分） */
  inTransitPoQty: number;
  /** 生产占用：已发料到生产工单的物料量（视为已承诺），逐仓时按指定仓库过滤 */
  inTransitMoQty: number;
  /** 安全库存缓冲量（由生效的 safetyStockPct 推导，默认 0） */
  safetyStockQty: number;
  /** 生效的安全库存比例（DTO 传入优先，否则物料主数据默认值） */
  safetyStockPctUsed: number;
  /** 最小订货量（由生效的 moq 推导，默认 0） */
  moq: number;
  netDemand: number;
  suggestedPurchaseQty: number;
}

/** 分仓在库分布（仅在不指定 warehouseId 的汇总测算时返回），便于计划员查看库存落在哪些仓库 */
export interface MrpWarehouseBreakdown {
  warehouseId: string;
  warehouseName: string;
  items: { materialId: string; onHand: number }[];
}

export interface MrpResult {
  styleId: string;
  styleNo: string;
  styleName: string;
  productionQty: number;
  bomVersion: string;
  /** 本次测算所作用的仓库：指定仓库时为该仓库 ID，汇总测算时为 null */
  warehouseId: string | null;
  items: MrpResultItem[];
  /** 分仓在库分布（仅在未指定 warehouseId 时非空） */
  warehouseBreakdown?: MrpWarehouseBreakdown[];
}

// ========== 生产成本核算 ==========

export interface ProductionCostItem {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  bomType: string;
  usagePerPiece: number;
  lossRate: number;
  unitCost: number;
  perPieceCost: number;
  totalCost: number;
}

export interface ProductionCostResult {
  styleId: string;
  styleNo: string;
  styleName: string;
  bomVersion: string;
  quantity: number;
  mainMaterialCost: number;
  auxiliaryMaterialCost: number;
  packagingCost: number;
  totalMaterialCost: number;
  perPieceCost: number;
  items: ProductionCostItem[];
}

export type PivotDataSource = 'sales' | 'purchase' | 'inventory' | 'transfer';

export type PivotDimensionType = 'string' | 'date' | 'year' | 'month' | 'quarter' | 'week' | 'day';

export type PivotAggType = 'sum' | 'count' | 'avg' | 'max' | 'min';

export interface PivotField {
  key: string;
  label: string;
  type: PivotDimensionType | 'measure';
  category: 'time' | 'org' | 'product' | 'other' | 'measure';
}

export interface PivotValueConfig {
  key: string;
  label: string;
  agg: PivotAggType;
}

export interface PivotConfig {
  dataSource: PivotDataSource;
  filters: { key: string; values: string[] }[];
  rows: string[];
  cols: string[];
  values: PivotValueConfig[];
  startDate?: string;
  endDate?: string;
  brand?: string;
  storeIds?: string[];
  keyword?: string;
  /** 显式豁免时间窗（透视表将全量扫描）。默认 false。 */
  allowFullRange?: boolean;
}

export interface PivotResultCell {
  value: number | null;
  formatted: string;
}

export interface PivotRow {
  rowValues: string[];
  cells: Record<string, PivotResultCell>;
  isSubtotal?: boolean;
  isGrandTotal?: boolean;
}

export interface FinanceReceipt {
  id: string;
  receiptNo: string;
  receiptDate: string;
  dealerId: string;
  customerName: string;
  amount: number;
  paymentMethod: string;
  handler?: string;
  status: string;
  remark?: string;
  createdAt: string;
  writeoffs?: FinanceReceiptWriteoff[];
}

export interface FinanceReceiptWriteoff {
  id: string;
  receiptId: string;
  receivableId: string;
  receivableNo: string;
  writeoffAmount: number;
  createdAt: string;
}

export interface FinancePayment {
  id: string;
  paymentNo: string;
  paymentDate: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  paymentMethod: string;
  handler?: string;
  status: string;
  remark?: string;
  createdAt: string;
  writeoffs?: FinancePaymentWriteoff[];
}

export interface FinancePaymentWriteoff {
  id: string;
  paymentId: string;
  payableId: string;
  payableNo: string;
  writeoffAmount: number;
  createdAt: string;
}

export interface PurchaseReconciliation {
  id: string;
  reconNo: string;
  supplierId: string;
  supplierName?: string;
  startDate: string;
  endDate: string;
  inboundAmount: number;
  returnAmount: number;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface PurchaseReconPreview {
  inboundAmount: number;
  returnAmount: number;
  totalAmount: number;
  inboundList: { id: string; inboundNo: string; inboundDate: string; totalAmount: number }[];
  returnList: { id: string; returnNo: string; returnDate: string; totalAmount: number }[];
}

export interface SalesReconciliation {
  id: string;
  reconNo: string;
  dealerId: string;
  customerName?: string;
  startDate: string;
  endDate: string;
  outboundAmount: number;
  returnAmount: number;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface SalesReconPreview {
  outboundAmount: number;
  returnAmount: number;
  totalAmount: number;
  outboundList: { id: string; outboundNo: string; outboundDate: string; totalAmount: number }[];
  returnList: { id: string; returnNo: string; returnDate: string; totalAmount: number }[];
}

export interface OperationLog {
  id: string;
  operationTime: string;
  userId?: string;
  userName?: string;
  module?: string;
  operationType?: string;
  objectId?: string;
  objectName?: string;
  summary?: string;
  ip?: string;
  userAgent?: string;
}

export interface PivotResponse {
  dataSource: PivotDataSource;
  rowFields: string[];
  colFields: string[];
  valueFields: PivotValueConfig[];
  colKeys: string[];
  colLabels: string[][];
  rows: PivotRow[];
  grandTotal: Record<string, PivotResultCell>;
  rowCount: number;
}

export interface ProductionWorkOrder {
  id: string;
  orderNo: string;
  styleId: string;
  styleNo?: string;
  quantity: number;
  supplierId?: string;
  factoryName?: string;
  planStartDate?: string;
  planFinishDate?: string;
  actualStartDate?: string;
  actualFinishDate?: string;
  status: 'draft' | 'pending' | 'producing' | 'finished' | 'closed';
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductionMaterialIssue {
  id: string;
  issueNo: string;
  workOrderId: string;
  workOrderNo?: string;
  warehouseId: string;
  issueDate: string;
  receiver?: string;
  status: 'draft' | 'pending' | 'approved';
  remark?: string;
  items?: ProductionMaterialIssueItem[];
}

export interface ProductionMaterialIssueItem {
  id: string;
  issueId: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  spec?: string;
  unit?: string;
  planQty: number;
  actualQty: number;
}

export interface ProductionFinishReceipt {
  id: string;
  receiptNo: string;
  workOrderId: string;
  workOrderNo?: string;
  warehouseId: string;
  receiptDate: string;
  finishedQty: number;
  defectiveQty: number;
  status: 'draft' | 'pending' | 'approved';
  remark?: string;
  items?: ProductionFinishReceiptItem[];
}

export interface ProductionFinishReceiptItem {
  id: string;
  receiptId: string;
  skuId: string;
  skuCode?: string;
  color?: string;
  size?: string;
  qty: number;
}

export interface SystemConfig {
  rememberTabs: boolean;
  defaultHomePage: 'dashboard' | 'welcome';
  sidebarCollapsed: boolean;
  tablePageSize: number;
  amountDecimals: number;
  qtyDecimals: number;
  autoSaveDraft: boolean;
  autoSaveInterval: number;
  allowNegativeStock: boolean;
  allowEditAfterApproval: boolean;
  overDeliveryRatio: number;
  retailAllowPriceEdit: boolean;
  lowStockAlert: boolean;
  pendingApprovalAlert: boolean;
  maxTabs: number;
  uniqueCodeArchiveDays: number;
  /** 单据列表页默认查询天数：进入各单据时默认按最近 N 天过滤；0 或不配置视为 90。管理员可在「系统配置」调整。 */
  defaultDocQueryDays: number;
}

// ===== P0-1 条码 / 批次 / 移动盘点 =====
export interface InventoryBatch {
  id: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseId: string;
  warehouseName: string;
  batchNo: string;
  quantity: number;
  productionDate?: string;
  expiryDate?: string;
  status: string;
  createdAt: string;
}

export interface BarcodeGenerateResult {
  generated: number;
  skipped: number;
}

export interface MobileStocktakeLookup {
  found: boolean;
  skuId?: string;
  skuCode?: string;
  styleNo?: string;
  color?: string;
  size?: string;
  warehouseName?: string;
  bookQty?: number;
}

export interface MobileStocktakeItemInput {
  barcode: string;
  actualQty: number;
  batchNo?: string;
}

export interface MobileStocktakeSubmitResult {
  stocktakeNo: string;
  itemCount: number;
}

// ===== P0-2 委外加工管理 =====
export interface SubcontractOrder {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  deliveryDate?: string;
  totalQuantity: number;
  totalAmount: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: SubcontractOrderItem[];
}

export interface SubcontractOrderItem {
  id: string;
  orderId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  receivedQty: number;
  remark?: string;
}

export interface SubcontractIssue {
  id: string;
  issueNo: string;
  orderId: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  issueDate: string;
  status: string;
  remark?: string;
  createdAt: string;
  items?: SubcontractIssueItem[];
}

export interface SubcontractIssueItem {
  id: string;
  issueId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  remark?: string;
}

export interface SubcontractReceipt {
  id: string;
  receiptNo: string;
  orderId: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  receiptDate: string;
  status: string;
  remark?: string;
  createdAt: string;
  items?: SubcontractReceiptItem[];
}

export interface SubcontractReceiptItem {
  id: string;
  receiptId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  qualifiedQty: number;
  remark?: string;
}

export interface SubcontractFee {
  id: string;
  orderId: string;
  supplierId: string;
  supplierName: string;
  feeType: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  status: string;
  remark?: string;
  createdAt: string;
}

// ===== P0-2 委外加工管理（创建输入） =====
export interface SubcontractOrderItemInput {
  skuId: string;
  quantity: number;
  unitPrice: number;
  remark?: string;
}

export interface SubcontractOrderCreate {
  supplierId: string;
  orderDate: string;
  deliveryDate?: string;
  remark?: string;
  items: SubcontractOrderItemInput[];
}

export interface SubcontractIssueItemInput {
  materialId: string;
  quantity: number;
  remark?: string;
}

export interface SubcontractIssueCreate {
  orderId: string;
  warehouseId: string;
  issueDate: string;
  remark?: string;
  items: SubcontractIssueItemInput[];
}

export interface SubcontractReceiptItemInput {
  skuId: string;
  quantity: number;
  qualifiedQty: number;
  remark?: string;
}

export interface SubcontractReceiptCreate {
  orderId: string;
  warehouseId: string;
  receiptDate: string;
  remark?: string;
  items: SubcontractReceiptItemInput[];
}

export interface SubcontractFeeCreate {
  orderId: string;
  feeType?: string;
  quantity: number;
  unitPrice: number;
  remark?: string;
}

// ===== P0-5 库存预警 -> 补货建议 =====
export interface ReplenishSuggestion {
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  safetyMin: number;
  safetyMax: number;
  suggestQty: number;
  supplierId?: string;
  supplierName?: string;
}

export interface ReplenishGenerateResult {
  orderCount: number;
  totalSkuCount: number;
  orderNos: string[];
}

// ===== P1-1 AI 销量预测 + 智能补货 =====
export interface ForecastPoint {
  month: string;
  qty: number;
  lower?: number;
  upper?: number;
}

export interface ForecastResult {
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  history: ForecastPoint[];
  forecast: ForecastPoint[];
  avgMonthly: number;
  trend: number;
  recommendedStock: number;
}

/**
 * P2-2 批量预测（单次 GROUP BY 查询，避免 N+1）。
 * 仅返回补货算法所需的标量：趋势+季节综合系数 adjustment = nextMonthNeed / (avgMonthly || 1)。
 * 当预测源（sales_outbound）无历史时 avgMonthly=0，调用方应将其视为 adjustment=1（不调整）。
 */
export interface BatchForecast {
  skuId: string;
  nextMonthNeed: number;
  avgMonthly: number;
  trend: number;
  adjustment: number;
}

// ===== P1-2 商品企划生命周期 =====
export interface LifecycleItem {
  styleNo: string;
  name: string;
  category?: string;
  season?: string;
  recentQty: number;
  lifecycleStatus: string;
  velocity: 'hot' | 'normal' | 'slow' | 'dead';
  suggestedAction: string;
}

export interface LifecycleSetResult {
  updated: number;
}

// ===== P1-3 全渠道 OMS =====
export interface SalesChannel {
  id: string;
  channelCode: string;
  name: string;
  platform: string;
  status: string;
  remark?: string;
}

export interface OmniOrderItem {
  id: string;
  omniOrderId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  allocatedQty: number;
  shortageQty: number;
}

export interface OmniOrder {
  id: string;
  orderNo: string;
  channelId: string;
  channelName: string;
  externalNo?: string;
  customerName: string;
  contactPhone?: string;
  address?: string;
  totalAmount: number;
  itemCount: number;
  status: string;
  shipStatus: string;
  remark?: string;
  createdAt: string;
}

export interface OmniOrderDetail {
  id: string;
  orderNo: string;
  channelId: string;
  channelName: string;
  externalNo?: string;
  customerName: string;
  contactPhone?: string;
  address?: string;
  totalAmount: number;
  itemCount: number;
  status: string;
  shipStatus: string;
  remark?: string;
  createdAt: string;
  items: OmniOrderItem[];
}

export interface OmniAllocateItem {
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  required: number;
  available: number;
  allocated: number;
  shortage: number;
}

export interface OmniAllocateResult {
  allocated: number;
  shortage: number;
  items: OmniAllocateItem[];
}

export interface OmniShipResult {
  shipped: number;
}

// ===== P1-4 会员私域 =====
export interface MemberTag {
  id: string;
  name: string;
  remark?: string;
}

export interface Member {
  id: string;
  memberNo: string;
  name: string;
  phone?: string;
  gender?: string;
  birthday?: string;
  level: string;
  tagIds: string[];
  totalSpent: number;
  orderCount: number;
  points: number;
  /** 资金余额（储值，单位=分）；#10 会员管理维护 */
  storedValue?: number;
  /** 邮箱；#10 会员管理维护 */
  email?: string;
  lastPurchaseDate?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

export interface MemberPoint {
  id: string;
  memberId: string;
  changeType: string;
  changeValue: number;
  balance: number;
  remark?: string;
  createdAt: string;
}

export interface MemberCategoryBreakdown {
  category: string;
  amount: number;
  qty: number;
}

export interface MemberTopStyle {
  styleNo: string;
  qty: number;
  amount: number;
}

export interface MemberPurchaseMonth {
  month: string;
  amount: number;
}

export interface MemberProfile {
  memberId: string;
  memberName: string;
  totalSpent: number;
  orderCount: number;
  points: number;
  avgOrderValue: number;
  lastPurchaseDate?: string;
  categoryBreakdown: MemberCategoryBreakdown[];
  topStyles: MemberTopStyle[];
  purchaseMonths: MemberPurchaseMonth[];
}

export interface CampaignResult {
  tagId: string;
  tagName: string;
  affectedCount: number;
  title: string;
}

// ===== P1-5 自助 BI 钻取 =====
export interface BiDimensionValue {
  dimValue: string;
  amount: number;
  quantity: number;
}

export interface BiResult {
  dim: string;
  metric: string;
  from?: string;
  to?: string;
  rows: BiDimensionValue[];
}

// ===== P1-6 移动老板看板 =====
export interface PendingApproval {
  docType: string;
  docId: string;
  docNo: string;
  date?: string;
  amount?: number;
}

export interface MobileDashboard {
  stats: DashboardStats;
  pendingApprovals: PendingApproval[];
  topStyles: TopStyleItem[];
  warnings: InventoryWarningItem[];
}
