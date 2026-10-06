import React from 'react';
import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Package, DollarSign,
  Settings, Users, Factory, NotebookPen, ArrowLeftRight,
  CalendarDays, BarChart3, Truck, FileText,
} from 'lucide-react';

/**
 * 菜单单一真相源。
 *
 * 原先 menuItems 定义在 Layout.tsx 内部，页签栏想复用图标就只能反向 import Layout，
 * 形成 Layout -> TabBar -> Layout 的循环依赖（模块求值顺序下 menuItems 会是 TDZ）。
 * 因此抽到独立模块：Layout 负责渲染侧栏，TabBar 负责取 path -> icon 映射。
 */

export interface MenuChildItem {
  key: string;
  label: string;
  path: string;
  permission?: string;
}

export interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  children?: MenuChildItem[];
  path?: string;
}

export const menuItems: MenuItem[] = [
  {
    key: 'dashboard',
    label: '数据看板',
    icon: <LayoutDashboard size={18} />,
    path: '/dashboard',
    permission: 'dashboard',
  },
  {
    key: 'product',
    label: '商品资料',
    icon: <NotebookPen size={18} />,
    children: [
      { key: 'style', label: '款号管理', path: '/base/style', permission: 'base:style' },
      { key: 'sku', label: 'SKU管理', path: '/base/sku', permission: 'base:sku' },
      { key: 'color', label: '颜色', path: '/product/color', permission: 'base:color' },
      { key: 'color-group', label: '颜色组', path: '/base/color-group', permission: 'base:style' },
      { key: 'size-group', label: '尺码组', path: '/base/size-group', permission: 'base:sku' },
      { key: 'size', label: '尺码', path: '/product/size', permission: 'base:size' },
      { key: 'size-group-relation', label: '尺码组与尺码关系', path: '/product/size-group-relation', permission: 'base:size' },
      { key: 'style-attribute', label: '款号属性维护', path: '/base/style-attribute', permission: 'base:style' },
      // 原用 system:permission（系统权限），会让「有系统权限=有编码规则」，属误授；改用款号码
      { key: 'code-rule', label: '款号编码规则', path: '/product/code-rule', permission: 'base:style' },
      { key: 'product-import', label: '批量导入', path: '/base/product-import', permission: 'base:import' },
    ],
  },
  {
    key: 'channel',
    // 用户明确要求：菜单名称改回「渠道管理」（供应商/经销商/店仓统一归入渠道）
    label: '渠道管理',
    icon: <Truck size={18} />,
    children: [
      { key: 'supplier', label: '供应商管理', path: '/base/supplier', permission: 'base:supplier' },
      { key: 'dealer', label: '经销商管理', path: '/base/dealer', permission: 'base:dealer' },
      { key: 'store', label: '店仓管理', path: '/base/store', permission: 'base:store' },
      { key: 'warehouse', label: '仓库管理', path: '/base/warehouse', permission: 'base:warehouse' },
    ],
  },
  {
    key: 'purchase',
    label: '采购管理',
    icon: <ShoppingCart size={18} />,
    children: [
      { key: 'garment-purchase-order', label: '采购订单', path: '/purchase/garment-order', permission: 'purchase:order' },
      { key: 'garment-purchase-inbound', label: '采购入库', path: '/purchase/garment-inbound', permission: 'purchase:inbound' },
      { key: 'garment-purchase-return', label: '采购退货', path: '/purchase/garment-return', permission: 'purchase:return' },
      { key: 'purchase-reconciliation', label: '采购对账', path: '/purchase/reconciliation', permission: 'purchase:reconciliation' },
    ],
  },
  {
    key: 'production',
    label: '生产管理',
    icon: <Factory size={18} />,
    children: [
      { key: 'prod-bom', label: 'BOM管理', path: '/production/bom', permission: 'production:bom' },
      { key: 'material', label: '面辅料管理', path: '/base/material', permission: 'base:material' },
      { key: 'material-purchase-order', label: '面辅料采购订单', path: '/production/material-purchase-order', permission: 'production:material_order' },
      { key: 'material-purchase-inbound', label: '面辅料入库', path: '/production/material-purchase-inbound', permission: 'production:material_inbound' },
      { key: 'mrp', label: 'MRP运算', path: '/production/mrp', permission: 'production:mrp' },
      { key: 'prod-cost', label: '成本核算', path: '/production/cost', permission: 'production:cost' },
      { key: 'work-order', label: '生产工单', path: '/production/work-order', permission: 'production:work_order' },
      { key: 'material-issue', label: '领料单', path: '/production/material-issue', permission: 'production:material_issue' },
      { key: 'finish-receipt', label: '完工入库单', path: '/production/finish-receipt', permission: 'production:finish_receipt' },
      { key: 'subcontract-main', label: '委外管理', path: '/subcontract', permission: 'inventory:query' },
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    icon: <ShoppingBag size={18} />,
    children: [
      { key: 'sales-order', label: '销售订单', path: '/sales/order', permission: 'sales:order' },
      { key: 'sales-outbound', label: '销售出库', path: '/sales/outbound', permission: 'sales:outbound' },
      { key: 'sales-return', label: '销售退货', path: '/sales/return', permission: 'sales:return' },
      { key: 'sales-reconciliation', label: '销售对账', path: '/sales/reconciliation', permission: 'sales:reconciliation' },
      { key: 'retail-order', label: '零售单', path: '/retail/order', permission: 'sales:order' },
      { key: 'retail-return', label: '零售退货单', path: '/retail/return', permission: 'sales:return' },
      { key: 'retail-report', label: '零售报表', path: '/retail/report', permission: 'sales:order' },
      { key: 'omni-main', label: '全渠道订单', path: '/omni', permission: 'omni:manage' },
    ],
  },
  {
    key: 'inventory',
    label: '库存管理',
    icon: <Package size={18} />,
    children: [
      { key: 'inv-query', label: '库存查询', path: '/inventory/query', permission: 'inventory:query' },
      { key: 'inv-flow', label: '库存流水', path: '/inventory/flow', permission: 'inventory:flow' },
      { key: 'inv-inbound', label: '入库单', path: '/inventory/inbound', permission: 'inventory:inbound' },
      { key: 'inv-outbound', label: '出库单', path: '/inventory/outbound', permission: 'inventory:outbound' },
      { key: 'inv-transfer', label: '调拨单', path: '/inventory/transfer', permission: 'inventory:transfer' },
      { key: 'inv-stocktake', label: '盘点单', path: '/inventory/stocktake', permission: 'inventory:stocktake' },
      { key: 'inv-warning', label: '库存预警', path: '/inventory/warning', permission: 'inventory:warning' },
      { key: 'inv-barcode', label: '条码/批次', path: '/inventory/barcode', permission: 'inventory:query' },
      { key: 'inv-mobile-stocktake', label: '移动盘点', path: '/inventory/mobile-stocktake', permission: 'inventory:stocktake' },
    ],
  },
  {
    key: 'channel-replenish',
    // 补货类入口集中于此，并在名称上标明业务方向：
    // 「补货建议」是上游采购向（安全库存法 → 采购单），「补货计划/模板」是下游门店向（铺货）。
    label: '补货管理',
    icon: <Truck size={18} />,
    children: [
      { key: 'inv-replenish', label: '补货建议（采购向）', path: '/inventory/replenish', permission: 'inventory:warning' },
      { key: 'replenish-plan', label: '补货计划（门店向）', path: '/inventory/replenish-plan', permission: 'inventory:replenish-plan' },
      { key: 'replenish-template', label: '补货模板（门店向）', path: '/inventory/replenish-template', permission: 'inventory:replenish-template' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    icon: <DollarSign size={18} />,
    children: [
      { key: 'receivable', label: '应收管理', path: '/finance/receivable', permission: 'finance:receivable' },
      { key: 'payable', label: '应付管理', path: '/finance/payable', permission: 'finance:payable' },
      { key: 'receipt', label: '收款单', path: '/finance/receipt', permission: 'finance:receipt' },
      { key: 'payment', label: '付款单', path: '/finance/payment', permission: 'finance:payment' },
      { key: 'profit', label: '毛利分析', path: '/finance/profit', permission: 'finance:profit' },
      { key: 'month-close', label: '月结管理', path: '/finance/month-close', permission: 'finance:profit' },
    ],
  },
  {
    key: 'report',
    label: '报表中心',
    icon: <BarChart3 size={18} />,
    children: [
      { key: 'report-garment-purchase', label: '成衣采购查询', path: '/report/garment-purchase', permission: 'report:garment_purchase' },
      { key: 'report-material-purchase', label: '面辅料采购查询', path: '/report/material-purchase', permission: 'report:material_purchase' },
      { key: 'report-sales', label: '销售查询', path: '/report/sales', permission: 'report:sales' },
      { key: 'report-retail', label: '零售查询', path: '/report/retail', permission: 'report:retail' },
      { key: 'report-inventory', label: '库存查询', path: '/report/inventory', permission: 'report:inventory' },
      { key: 'report-transfer', label: '调拨查询', path: '/report/transfer', permission: 'report:transfer' },
      { key: 'report-stock-movement', label: '进销存查询', path: '/report/stock-movement', permission: 'report:stockmovement' },
      { key: 'report-pivot', label: '透视分析', path: '/report/pivot', permission: 'report:pivot' },
      { key: 'analytics-forecast', label: 'AI销量预测', path: '/analytics/forecast', permission: 'dashboard:view' },
      { key: 'analytics-lifecycle', label: '商品生命周期', path: '/analytics/lifecycle', permission: 'dashboard:view' },
      { key: 'analytics-bi', label: '自助BI钻取', path: '/analytics/bi', permission: 'dashboard:view' },
    ],
  },
  {
    key: 'trade-show',
    label: '订货会管理',
    icon: <CalendarDays size={18} />,
    children: [
      { key: 'trade-show-theme', label: '订货会主题', path: '/trade-show/theme', permission: 'tradeshow:theme' },
      { key: 'trade-show-list', label: '订货会主单', path: '/trade-show/list', permission: 'tradeshow:preorder' },
      { key: 'pre-order', label: '预订单', path: '/trade-show/pre-order', permission: 'tradeshow:preorder' },
      { key: 'pre-order-summary', label: '预订汇总', path: '/trade-show/summary', permission: 'tradeshow:preorder' },
      { key: 'allocation', label: '配货管理', path: '/trade-show/allocation', permission: 'tradeshow:allocation' },
    ],
  },
  {
    key: 'member',
    label: '会员私域',
    icon: <Users size={18} />,
    children: [
      { key: 'member-main', label: '会员运营', path: '/member', permission: 'retail:view' },
      { key: 'member-manage', label: '会员管理', path: '/member/manage', permission: 'member:manage' },
      { key: 'member-level', label: '会员等级', path: '/member/level', permission: 'member:level' },
    ],
  },
  {
    key: 'data-governance',
    label: '数据治理',
    icon: <ArrowLeftRight size={18} />,
    children: [
      { key: 'merge-audit', label: '合并审计', path: '/base/merge-audit', permission: 'md:merge' },
      { key: 'member-merge-audit', label: '会员合并审计', path: '/base/member-merge-audit', permission: 'member:merge' },
    ],
  },
  {
    key: 'system',
    label: '系统管理',
    icon: <Settings size={18} />,
    children: [
      { key: 'user', label: '用户管理', path: '/system/user', permission: 'system:user' },
      { key: 'role', label: '角色管理', path: '/system/role', permission: 'system:role' },
      { key: 'permission', label: '权限管理', path: '/system/permission', permission: 'system:permission' },
      { key: 'operation-log', label: '操作日志', path: '/system/operation-log', permission: 'system:operation_log' },
      { key: 'config', label: '系统配置', path: '/system/config', permission: 'system:config' },
    ],
  },
];

/** 一级菜单（含 path，无 children）的 path -> icon */
const topLevelIconMap: Record<string, React.ReactNode> = {};
/** 二级菜单的 path -> icon（取所属一级菜单图标） */
const childIconMap: Record<string, React.ReactNode> = {};

for (const item of menuItems) {
  if (item.children) {
    for (const child of item.children) {
      childIconMap[child.path] = item.icon;
    }
  } else if (item.path) {
    topLevelIconMap[item.path] = item.icon;
  }
}

/** 兜底图标：菜单未覆盖的路径（如 /welcome、详情子路由） */
const fallbackIcon = <FileText size={14} />;

/**
 * 按页签路径取对应功能模块图标。
 * 详情页签路径形如 /sales/order/{id}，需按最长前缀回退到所属模块路径。
 */
export function getMenuIconByPath(path: string): React.ReactNode {
  if (!path) return fallbackIcon;
  if (topLevelIconMap[path]) return topLevelIconMap[path];
  if (childIconMap[path]) return childIconMap[path];

  const candidates = [...Object.keys(childIconMap), ...Object.keys(topLevelIconMap)].sort(
    (a, b) => b.length - a.length,
  );
  for (const p of candidates) {
    if (path === p || path.startsWith(p + '/')) {
      return childIconMap[p] ?? topLevelIconMap[p] ?? fallbackIcon;
    }
  }
  return fallbackIcon;
}
