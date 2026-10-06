import React from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { validateDateRange } from '@client/src/utils/date-utils';

export interface FilterOption {
  value: string;
  label: string;
}

export interface SelectOption {
  id: string;
  code?: string;
  name: string;
}

export interface PurchaseFilterBarProps {
  /** 点击「查询」时触发（组件已先做日期区间校验，校验通过才回调）。 */
  onSearch: () => void;
  /** 点击「重置」时触发，由页面自行把筛选状态恢复到初始值。 */
  onReset: () => void;

  /** 主日期标签，默认「单据日期」。 */
  dateLabel?: string;
  dateStart: string;
  dateEnd: string;
  onDateStartChange: (v: string) => void;
  onDateEndChange: (v: string) => void;

  /** 是否显示第二个日期区间（如入库日期 / 退货日期）。 */
  showSecondaryDate?: boolean;
  secondaryDateLabel?: string;
  secondaryDateStart?: string;
  secondaryDateEnd?: string;
  onSecondaryDateStartChange?: (v: string) => void;
  onSecondaryDateEndChange?: (v: string) => void;

  showSupplier?: boolean;
  supplierId?: string;
  onSupplierChange?: (v: string) => void;
  supplierOptions?: SelectOption[];

  showStatus?: boolean;
  status?: string;
  onStatusChange?: (v: string) => void;
  statusOptions?: FilterOption[];

  showWarehouse?: boolean;
  warehouseId?: string;
  onWarehouseChange?: (v: string) => void;
  warehouseOptions?: SelectOption[];

  showKeyword?: boolean;
  keyword?: string;
  onKeywordChange?: (v: string) => void;
  keywordPlaceholder?: string;

  /** 在「重置」右侧追加的额外按钮（如导出）。 */
  extraButtons?: React.ReactNode;
}

const fieldLabelCls = 'block text-xs text-gray-500 mb-1';
const selectCls =
  'w-full min-w-[150px] border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-primary';
const dateCls =
  'border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary';
const DATE_SEP = '至';

/**
 * 采购管理各列表页统一查询栏。
 * 固定顺序：主日期 → 供应商 → 单据状态 → 仓库 → 关键字 → 次日期。
 * 统一「全部」文案、日期分隔符「至」、查询/重置按钮，并做日期区间校验。
 */
export const PurchaseFilterBar: React.FC<PurchaseFilterBarProps> = (props) => {
  const {
    onSearch,
    onReset,
    dateLabel = '单据日期',
    dateStart,
    dateEnd,
    onDateStartChange,
    onDateEndChange,
    showSecondaryDate = false,
    secondaryDateLabel = '业务日期',
    secondaryDateStart = '',
    secondaryDateEnd = '',
    onSecondaryDateStartChange,
    onSecondaryDateEndChange,
    showSupplier = false,
    supplierId = '',
    onSupplierChange,
    supplierOptions = [],
    showStatus = false,
    status = '',
    onStatusChange,
    statusOptions = [],
    showWarehouse = false,
    warehouseId = '',
    onWarehouseChange,
    warehouseOptions = [],
    showKeyword = false,
    keyword = '',
    onKeywordChange,
    keywordPlaceholder = '搜索单号',
    extraButtons,
  } = props;

  const handleSearch = (): void => {
    const e1 = validateDateRange(dateStart, dateEnd);
    if (e1) {
      toast.error(e1);
      return;
    }
    if (showSecondaryDate) {
      const e2 = validateDateRange(secondaryDateStart, secondaryDateEnd);
      if (e2) {
        toast.error(e2);
        return;
      }
    }
    onSearch();
  };

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
      {/* 主日期 */}
      <div className="flex flex-col">
        <label className={fieldLabelCls}>{dateLabel}</label>
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={dateStart}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onDateStartChange(e.target.value)}
            className={dateCls}
          />
          <span className="text-gray-400">{DATE_SEP}</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onDateEndChange(e.target.value)}
            className={dateCls}
          />
        </div>
      </div>

      {/* 供应商 */}
      {showSupplier && (
        <div className="flex flex-col">
          <label className={fieldLabelCls}>供应商</label>
          <select
            value={supplierId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onSupplierChange?.(e.target.value)}
            className={selectCls}
          >
            <option value="">全部</option>
            {supplierOptions.map((s: SelectOption) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 单据状态 */}
      {showStatus && (
        <div className="flex flex-col">
          <label className={fieldLabelCls}>单据状态</label>
          <select
            value={status}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onStatusChange?.(e.target.value)}
            className={selectCls}
          >
            <option value="">全部</option>
            {statusOptions.map((o: FilterOption) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* 仓库 */}
      {showWarehouse && (
        <div className="flex flex-col">
          <label className={fieldLabelCls}>仓库</label>
          <select
            value={warehouseId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onWarehouseChange?.(e.target.value)}
            className={selectCls}
          >
            <option value="">全部</option>
            {warehouseOptions.map((w: SelectOption) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 关键字 */}
      {showKeyword && (
        <div className="flex flex-col">
          <label className={fieldLabelCls}>关键字</label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onKeywordChange?.(e.target.value)}
              placeholder={keywordPlaceholder}
              className="border border-gray-300 rounded pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:border-primary w-44"
            />
          </div>
        </div>
      )}

      {/* 次日期（入库 / 退货等） */}
      {showSecondaryDate && (
        <div className="flex flex-col">
          <label className={fieldLabelCls}>{secondaryDateLabel}</label>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={secondaryDateStart}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onSecondaryDateStartChange?.(e.target.value)
              }
              className={dateCls}
            />
            <span className="text-gray-400">{DATE_SEP}</span>
            <input
              type="date"
              value={secondaryDateEnd}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onSecondaryDateEndChange?.(e.target.value)
              }
              className={dateCls}
            />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={handleSearch}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary flex items-center gap-1"
        >
          <Search size={14} /> 查询
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          重置
        </button>
        {extraButtons}
      </div>
    </div>
  );
};

export default PurchaseFilterBar;
