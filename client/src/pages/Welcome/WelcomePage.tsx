import React from 'react';
import { useTabs, getTabInfoFromPath } from '@client/src/contexts/TabsContext';
import {
  Shirt, Layers, Building2, ShoppingCart, Factory,
  CalendarDays, ShoppingBag, Store, Package, DollarSign,
  BarChart3, ArrowRight, Sparkles,
} from 'lucide-react';

interface FlowCard {
  title: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  bgColor: string;
  items: string[];
  path?: string;
}

interface FlowRow {
  label: string;
  labelColor: string;
  cards: FlowCard[];
}

const welcomeRows: FlowRow[] = [
  {
    label: '基础档案',
    labelColor: 'bg-gray-100 text-gray-600',
    cards: [
      {
        title: '款号管理',
        icon: <Shirt size={20} />,
        color: 'text-gray-600',
        borderColor: 'border-gray-200',
        bgColor: 'bg-gray-50',
        items: ['品牌', '季节', '大类', '版型', '颜色尺码'],
        path: '/base/style',
      },
      {
        title: 'BOM管理',
        icon: <Layers size={20} />,
        color: 'text-gray-600',
        borderColor: 'border-gray-200',
        bgColor: 'bg-gray-50',
        items: ['面物料清单', '单件用量', '损耗率'],
        path: '/bom',
      },
      {
        title: '组织架构',
        icon: <Building2 size={20} />,
        color: 'text-gray-600',
        borderColor: 'border-gray-200',
        bgColor: 'bg-gray-50',
        items: ['经销商', '直营店', '门店', '仓库'],
        path: '/base/dealer',
      },
    ],
  },
  {
    label: '采购与生产',
    labelColor: 'bg-blue-100 text-blue-600',
    cards: [
      {
        title: '成衣采购',
        icon: <ShoppingCart size={20} />,
        color: 'text-primary',
        borderColor: 'border-blue-200',
        bgColor: 'bg-blue-50',
        items: ['采购订单', '采购入库', '采购退货'],
        path: '/purchase/garment-order',
      },
      {
        title: '面辅料采购',
        icon: <Package size={20} />,
        color: 'text-primary',
        borderColor: 'border-blue-200',
        bgColor: 'bg-blue-50',
        items: ['采购订单', '面辅料入库'],
        path: '/purchase/order',
      },
      {
        title: '生产管理',
        icon: <Factory size={20} />,
        color: 'text-green-500',
        borderColor: 'border-green-200',
        bgColor: 'bg-green-50',
        items: ['MRP运算', '生产工单', '领料单', '完工入库'],
        path: '/production/mrp',
      },
    ],
  },
  {
    label: '订货会',
    labelColor: 'bg-orange-100 text-orange-600',
    cards: [
      {
        title: '订货会流程',
        icon: <CalendarDays size={20} />,
        color: 'text-orange-500',
        borderColor: 'border-orange-200',
        bgColor: 'bg-orange-50',
        items: ['预订单提交', '总部汇总', '分配加工', '到货入库', '配货出库'],
        path: '/trade-show/list',
      },
    ],
  },
  {
    label: '销售与零售',
    labelColor: 'bg-purple-100 text-purple-600',
    cards: [
      {
        title: '批发销售',
        icon: <ShoppingBag size={20} />,
        color: 'text-purple-500',
        borderColor: 'border-purple-200',
        bgColor: 'bg-purple-50',
        items: ['销售订单', '销售出库', '销售退货'],
        path: '/sales/order',
      },
      {
        title: '门店零售',
        icon: <Store size={20} />,
        color: 'text-pink-500',
        borderColor: 'border-pink-200',
        bgColor: 'bg-pink-50',
        items: ['零售POS单', '零售退货'],
        path: '/retail/order',
      },
    ],
  },
  {
    label: '库存与财务',
    labelColor: 'bg-cyan-100 text-cyan-600',
    cards: [
      {
        title: '库存管理',
        icon: <Package size={20} />,
        color: 'text-cyan-500',
        borderColor: 'border-cyan-200',
        bgColor: 'bg-cyan-50',
        items: ['调拨', '盘点', '库存预警', '进销存查询'],
        path: '/inventory/query',
      },
      {
        title: '财务管理',
        icon: <DollarSign size={20} />,
        color: 'text-amber-500',
        borderColor: 'border-amber-200',
        bgColor: 'bg-amber-50',
        items: ['应收应付', '收付款', '对账', '月结', '成本核算'],
        path: '/finance/receivable',
      },
      {
        title: '报表分析',
        icon: <BarChart3 size={20} />,
        color: 'text-amber-500',
        borderColor: 'border-amber-200',
        bgColor: 'bg-amber-50',
        items: ['6张固定报表', '透视分析'],
        path: '/report/pivot',
      },
    ],
  },
];

const WelcomePage: React.FC = () => {
  const { openTab } = useTabs();

  const handleCardClick = (path?: string) => {
    if (path) {
      const info = getTabInfoFromPath(path);
      openTab({ key: info.key, label: info.label, path });
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-5xl mx-auto py-10 px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 rounded-full text-sm mb-4">
            <Sparkles size={14} />
            <span>服装行业一站式解决方案</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-3">
            欢迎使用服装ERP管理系统
          </h1>
          <p className="text-gray-500 text-base">
            从款号到零售，一站式管理你的服装业务
          </p>
        </div>

        <div className="space-y-6">
          {welcomeRows.map((row, rowIdx) => (
            <div key={rowIdx} className="flex items-stretch gap-4">
              <div className="w-24 flex-shrink-0 flex items-start pt-4">
                <span className={`px-2.5 py-1 rounded text-xs font-medium ${row.labelColor}`}>
                  {row.label}
                </span>
              </div>
              <div className="flex-1 flex items-center gap-3 flex-wrap">
                {row.cards.map((card, cardIdx) => (
                  <React.Fragment key={cardIdx}>
                    <div
                      onClick={() => handleCardClick(card.path)}
                      className={`relative bg-white rounded-lg border ${card.borderColor} shadow-sm p-4 w-48 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md group`}
                    >
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className={`w-9 h-9 rounded-lg ${card.bgColor} ${card.color} flex items-center justify-center`}>
                          {card.icon}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-800">
                          {card.title}
                        </h3>
                      </div>
                      <ul className="space-y-1">
                        {card.items.map((item, itemIdx) => (
                          <li
                            key={itemIdx}
                            className="text-xs text-gray-500 flex items-center gap-1.5"
                          >
                            <span className="w-1 h-1 rounded-full bg-gray-300" />
                            {item}
                          </li>
                        ))}
                      </ul>
                      {card.path && (
                        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          立即进入 <ArrowRight size={10} />
                        </div>
                      )}
                    </div>
                    {cardIdx < row.cards.length - 1 && (
                      <div className="flex-shrink-0 text-gray-300">
                        <ArrowRight size={16} />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center text-xs text-gray-400 mt-12">
          点击上方卡片可快速进入对应模块
        </div>
      </div>
    </div>
  );
};

export default WelcomePage;
