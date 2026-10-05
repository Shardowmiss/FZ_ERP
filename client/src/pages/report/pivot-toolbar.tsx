import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Download, ChevronDown, ChevronUp } from 'lucide-react';
import type { PivotDataSource } from '@shared/api.interface';

interface ToolbarProps {
  dataSource: PivotDataSource;
  templateName: string;
  startDate: string;
  endDate: string;
  datePreset: string;
  brand: string;
  storeIds: string[];
  keyword: string;
  showStoreFilter: boolean;
  dealer?: string;
  supplier?: string;
  warehouse?: string;
  onDataSourceChange: (ds: PivotDataSource) => void;
  onTemplateChange: (name: string) => void;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onDatePresetChange: (v: string) => void;
  onBrandChange: (v: string) => void;
  onStoreIdsChange: (ids: string[]) => void;
  onKeywordChange: (v: string) => void;
  onDealerChange?: (v: string) => void;
  onSupplierChange?: (v: string) => void;
  onWarehouseChange?: (v: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onExport?: () => void;
  dataSourceOptions: { value: PivotDataSource; label: string }[];
  templateOptions: { name: string }[];
}

const labelCls = 'text-xs text-gray-500 mr-1 flex-shrink-0';
const selectCls =
  'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/70 bg-white h-7';
const inputCls =
  'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/70 h-7';

export function Toolbar({
  dataSource,
  templateName,
  startDate,
  endDate,
  datePreset,
  brand,
  storeIds,
  keyword,
  showStoreFilter,
  dealer = '',
  supplier = '',
  warehouse = '',
  onDataSourceChange,
  onTemplateChange,
  onStartDateChange,
  onEndDateChange,
  onDatePresetChange,
  onBrandChange,
  onStoreIdsChange,
  onKeywordChange,
  onDealerChange,
  onSupplierChange,
  onWarehouseChange,
  onSearch,
  onReset,
  onExport,
  dataSourceOptions,
  templateOptions,
}: ToolbarProps) {
  const [expanded, setExpanded] = useState(false);

  const brandText = brand ? `品牌:${brand}` : '品牌:全部';
  const storeText = showStoreFilter
    ? storeIds.length > 0
      ? `门店:已选${storeIds.length}个`
      : '门店:全部'
    : '';
  const keywordText = keyword ? `款号:${keyword}` : '款号:无';
  const summaryParts = [brandText];
  if (storeText) summaryParts.push(storeText);
  summaryParts.push(keywordText);
  const summaryText = summaryParts.join(' / ');

  return (
    <div className="bg-white border border-gray-200 rounded overflow-hidden">
      {/* Row 1: data source + template + buttons */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center">
          <span className={labelCls}>数据源</span>
          <select
            value={dataSource}
            onChange={(e) => onDataSourceChange(e.target.value as PivotDataSource)}
            className={selectCls + ' w-[140px]'}
          >
            {dataSourceOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center">
          <span className={labelCls}>模板</span>
          <select
            value={templateName}
            onChange={(e) => onTemplateChange(e.target.value)}
            className={selectCls + ' w-[180px]'}
          >
            <option value="">选择模板</option>
            {templateOptions.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        <div className="flex gap-2">
          <button
            onClick={onSearch}
            className="bg-primary text-white px-4 py-1 rounded text-sm hover:bg-primary transition-colors flex items-center gap-1 h-7"
          >
            <Search size={14} />
            查询
          </button>
          <button
            onClick={onExport}
            className="bg-white text-gray-700 px-3 py-1 rounded text-sm border border-gray-300 hover:bg-gray-50 transition-colors flex items-center gap-1 h-7"
          >
            <Download size={14} />
            导出
          </button>
        </div>
      </div>

      {/* Row 2: date range + preset + filter toggle + summary */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50/60">
        <div className="flex items-center">
          <span className={labelCls}>时间范围</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              onStartDateChange(e.target.value);
              onDatePresetChange('');
            }}
            className={inputCls + ' w-32'}
          />
          <span className="mx-1.5 text-gray-400 text-sm">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              onEndDateChange(e.target.value);
              onDatePresetChange('');
            }}
            className={inputCls + ' w-32'}
          />
        </div>

        <div className="flex items-center">
          <span className={labelCls}>快捷选择</span>
          <select
            value={datePreset}
            onChange={(e) => onDatePresetChange(e.target.value)}
            className={selectCls + ' w-[110px]'}
          >
            <option value="">自定义</option>
            <option value="today">今天</option>
            <option value="last7">近7天</option>
            <option value="last30">近30天</option>
            <option value="thisMonth">本月</option>
            <option value="lastMonth">上月</option>
            <option value="thisYear">本年</option>
          </select>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 px-3 py-1 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 transition-colors h-7"
        >
          筛选条件
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <span className="text-xs text-gray-500">{summaryText}</span>
      </div>

      {/* Expandable filter panel */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-gray-100"
          >
            <div className="px-4 py-3 space-y-2.5 bg-gray-50/50">
              {/* Row 1: brand + keyword */}
              <div className="flex items-center gap-4">
                <div className="flex items-center">
                  <span className={labelCls}>品牌</span>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => onBrandChange(e.target.value)}
                    placeholder="品牌编码"
                    className={inputCls + ' w-36'}
                  />
                </div>
                <div className="flex items-center">
                  <span className={labelCls}>款号</span>
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => onKeywordChange(e.target.value)}
                      placeholder="输入款号"
                      className={inputCls + ' pl-6 w-36'}
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: dealer + supplier */}
              <div className="flex items-center gap-4">
                <div className="flex items-center">
                  <span className={labelCls}>经销商</span>
                  <input
                    type="text"
                    value={dealer}
                    onChange={(e) => onDealerChange?.(e.target.value)}
                    placeholder="经销商名称"
                    className={inputCls + ' w-36'}
                  />
                </div>
                <div className="flex items-center">
                  <span className={labelCls}>供应商</span>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => onSupplierChange?.(e.target.value)}
                    placeholder="供应商名称"
                    className={inputCls + ' w-36'}
                  />
                </div>
              </div>

              {/* Row 3: store (conditionally) + warehouse */}
              <div className="flex items-center gap-4">
                {showStoreFilter && (
                  <div className="flex items-center">
                    <span className={labelCls}>门店</span>
                    <input
                      type="text"
                      value={storeIds.join(',')}
                      onChange={(e) =>
                        onStoreIdsChange(
                          e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        )
                      }
                      placeholder="门店ID，逗号分隔"
                      className={inputCls + ' w-48'}
                    />
                  </div>
                )}
                <div className="flex items-center">
                  <span className={labelCls}>仓库</span>
                  <input
                    type="text"
                    value={warehouse}
                    onChange={(e) => onWarehouseChange?.(e.target.value)}
                    placeholder="仓库名称"
                    className={inputCls + ' w-36'}
                  />
                </div>
                <div className="flex-1" />
                <button
                  onClick={onReset}
                  className="bg-white text-gray-700 px-3 py-1 rounded text-sm border border-gray-300 hover:bg-gray-50 transition-colors h-7"
                >
                  重置
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
