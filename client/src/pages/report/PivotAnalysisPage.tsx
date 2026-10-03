import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Download } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import type {
  PivotDataSource,
  PivotValueConfig,
  PivotResponse,
  PivotAggType,
  PivotConfig,
  PivotRow,
} from '@shared/api.interface';
import { reportApi } from '@client/src/api/report';
import {
  DIMENSION_FIELDS,
  MEASURE_FIELDS,
  DIMENSION_GROUPS,
  DATA_SOURCE_OPTIONS,
  TEMPLATES,
  getFieldLabel,
  isMeasureField,
  exportToCSV,
  getDateRange,
  sortRowsByValue,
} from './pivot-utils';
import {
  DropZonePanel,
  ValueDropZonePanel,
  FieldPanel,
  zoneIcons,
  type DropZone,
} from './pivot-components';
import { PivotTable } from './pivot-table';
import { Toolbar } from './pivot-toolbar';

export default function PivotAnalysisPage() {
  const [dataSource, setDataSource] = useState<PivotDataSource>('sales');
  const [templateName, setTemplateName] = useState<string>('月度销售趋势');
  const [rows, setRows] = useState<string[]>(['styleNo']);
  const [cols, setCols] = useState<string[]>(['month']);
  const [values, setValues] = useState<PivotValueConfig[]>([
    { key: 'quantity', label: '销售数量', agg: 'sum' },
    { key: 'amount', label: '销售金额', agg: 'sum' },
  ]);
  const [filters, setFilters] = useState<string[]>([]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [datePreset, setDatePreset] = useState('last30');
  const [brand, setBrand] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [dealer, setDealer] = useState('');
  const [supplier, setSupplier] = useState('');
  const [warehouse, setWarehouse] = useState('');

  const [response, setResponse] = useState<PivotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    time: false,
    org: false,
    product: false,
    other: false,
    measure: false,
  });
  const [dragOverZone, setDragOverZone] = useState<DropZone | null>(null);
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const range = getDateRange('last30');
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    if (values.length === 0) {
      setResponse(null);
      return;
    }
    setLoading(true);
    try {
      const body: PivotConfig = {
        dataSource,
        filters: filters.map((k) => ({ key: k, values: [] })),
        rows,
        cols,
        values,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        brand: brand || undefined,
        storeIds: storeIds.length > 0 ? storeIds : undefined,
        keyword: keyword || undefined,
      };
      const res = await reportApi.pivot(body);

      if (templateName === '门店销售排行') {
        const sortKey = res.colKeys[0];
        if (sortKey) {
          const normalRows = res.rows.filter(
            (r: PivotRow) => !r.isSubtotal && !r.isGrandTotal,
          );
          const subtotalRows = res.rows.filter(
            (r: PivotRow) => r.isSubtotal || r.isGrandTotal,
          );
          const sorted = sortRowsByValue(normalRows, sortKey, 'desc');
          res.rows = [...sorted, ...subtotalRows];
        }
      }
      setResponse(res);
    } catch (e) {
      logger.error('加载透视表失败', e);
      toast.error('加载透视表失败');
    } finally {
      setLoading(false);
    }
  }, [dataSource, rows, cols, values, filters, startDate, endDate, brand, storeIds, keyword, templateName]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dataSource, rows, cols, values, filters, fetchData]);

  const applyTemplate = (name: string) => {
    const tpl = TEMPLATES.find((t) => t.name === name);
    if (!tpl) return;
    setTemplateName(name);
    setDataSource(tpl.dataSource);
    setRows(tpl.rows);
    setCols(tpl.cols);
    setValues(tpl.values);
    setFilters([]);
  };

  const handleDatePreset = (preset: string) => {
    setDatePreset(preset);
    if (!preset) return;
    const range = getDateRange(preset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  const handleDataSourceChange = (ds: PivotDataSource) => {
    setDataSource(ds);
    setTemplateName('');
  };

  const handleReset = () => {
    setRows([]);
    setCols([]);
    setValues([]);
    setFilters([]);
    setBrand('');
    setStoreIds([]);
    setKeyword('');
    setDealer('');
    setSupplier('');
    setWarehouse('');
    setResponse(null);
  };

  // --- Drag and drop ---
  const handleDragStart = (e: React.DragEvent, fieldKey: string) => {
    e.dataTransfer.setData('fieldKey', fieldKey);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragStartFromZone = (
    e: React.DragEvent,
    fieldKey: string,
    fromZone: DropZone,
  ) => {
    e.dataTransfer.setData('fieldKey', fieldKey);
    e.dataTransfer.setData('fromZone', fromZone);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = zone === 'values' ? 'move' : 'copy';
    if (dragOverZone !== zone) setDragOverZone(zone);
  };

  const handleDragLeave = () => {
    setDragOverZone(null);
  };

  const handleDrop = (
    e: React.DragEvent,
    zone: DropZone,
    targetIndex: number,
  ) => {
    e.preventDefault();
    setDragOverZone(null);
    const fieldKey = e.dataTransfer.getData('fieldKey');
    const fromZone = e.dataTransfer.getData('fromZone') as DropZone | '';
    if (!fieldKey) return;
    if (fromZone && fromZone !== zone) {
      removeFromZone(fromZone, fieldKey);
    }
    addToZone(zone, fieldKey, targetIndex);
  };

  const addToZone = (zone: DropZone, fieldKey: string, targetIndex?: number) => {
    const isMeasure = isMeasureField(fieldKey);
    if (zone === 'values') {
      if (!isMeasure) {
        toast.error('值区只能拖入指标字段');
        return;
      }
      if (values.some((v) => v.key === fieldKey)) return;
      const newItem: PivotValueConfig = {
        key: fieldKey,
        label: getFieldLabel(fieldKey),
        agg: 'sum',
      };
      setValues((prev) => {
        const idx = targetIndex ?? prev.length;
        const next = [...prev];
        next.splice(idx, 0, newItem);
        return next;
      });
      return;
    }
    if (isMeasure) {
      toast.error('指标字段只能拖入值区');
      return;
    }
    const listMap: Record<string, string[]> = { rows, cols, filters };
    const setter =
      zone === 'rows' ? setRows : zone === 'cols' ? setCols : setFilters;
    if (listMap[zone].includes(fieldKey)) return;
    setter((prev) => {
      const idx = targetIndex ?? prev.length;
      const next = [...prev];
      next.splice(idx, 0, fieldKey);
      return next;
    });
  };

  const removeFromZone = (zone: DropZone, fieldKey: string) => {
    if (zone === 'rows') {
      setRows((prev) => prev.filter((k) => k !== fieldKey));
    } else if (zone === 'cols') {
      setCols((prev) => prev.filter((k) => k !== fieldKey));
    } else if (zone === 'values') {
      setValues((prev) => prev.filter((v) => v.key !== fieldKey));
    } else {
      setFilters((prev) => prev.filter((k) => k !== fieldKey));
    }
  };

  const handleReorder = (zone: DropZone, fromIndex: number, toIndex: number) => {
    if (zone === 'values') {
      setValues((prev) => {
        const next = [...prev];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        return next;
      });
      return;
    }
    const setter =
      zone === 'rows' ? setRows : zone === 'cols' ? setCols : setFilters;
    setter((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const changeAgg = (valueKey: string, agg: PivotAggType) => {
    setValues((prev) =>
      prev.map((v) => (v.key === valueKey ? { ...v, agg } : v)),
    );
  };

  const handleExport = () => {
    if (!response) return;
    const dsLabel =
      DATA_SOURCE_OPTIONS.find((d) => d.value === dataSource)?.label || 'pivot';
    exportToCSV(response, `${dsLabel}_透视分析_${Date.now()}`);
  };

  const showStoreFilter = dataSource === 'sales';

  const tableStructureKey = useMemo(() => {
    const rowKey = rows.join(',');
    const colKey = cols.join(',');
    const valKey = values.map((v) => `${v.key}:${v.agg}`).join(',');
    return `${rowKey}|${colKey}|${valKey}`;
  }, [rows, cols, values]);

  const toggleRowCollapse = (rowKey: string) => {
    setCollapsedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const displayRows = useMemo(() => {
    if (!response) return [];
    if (collapsedRows.size === 0) return response.rows;
    const result: PivotRow[] = [];
    const rowFieldCount = response.rowFields.length;
    for (const row of response.rows) {
      if (row.isSubtotal || row.isGrandTotal) {
        result.push(row);
        continue;
      }
      let hidden = false;
      for (let depth = rowFieldCount - 2; depth >= 0; depth--) {
        const ancestorKey = row.rowValues.slice(0, depth + 1).join('|');
        if (collapsedRows.has(ancestorKey)) {
          hidden = true;
          break;
        }
      }
      if (!hidden) result.push(row);
    }
    return result;
  }, [response, collapsedRows]);

  const hasChildren = useCallback(
    (row: PivotRow, idx: number): boolean => {
      if (!response) return false;
      const nextRow = response.rows[idx + 1];
      if (!nextRow || nextRow.isSubtotal || nextRow.isGrandTotal) return false;
      return (
        nextRow.rowValues.length > row.rowValues.length &&
        nextRow.rowValues
          .slice(0, row.rowValues.length)
          .join('|') === row.rowValues.join('|')
      );
    },
    [response],
  );

  return (
    <div className="p-5 h-full flex flex-col bg-muted">
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left: Field panel */}
        <FieldPanel
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
          onDragStart={handleDragStart}
          onRemoveFromZone={removeFromZone}
          dimensionGroups={DIMENSION_GROUPS}
          dimensionFields={DIMENSION_FIELDS}
          measureFields={MEASURE_FIELDS}
        />

        {/* Right: Main area */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {/* Toolbar */}
          <Toolbar
            dataSource={dataSource}
            templateName={templateName}
            startDate={startDate}
            endDate={endDate}
            datePreset={datePreset}
            brand={brand}
            storeIds={storeIds}
            keyword={keyword}
            showStoreFilter={showStoreFilter}
            dealer={dealer}
            supplier={supplier}
            warehouse={warehouse}
            onDataSourceChange={handleDataSourceChange}
            onTemplateChange={applyTemplate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onDatePresetChange={handleDatePreset}
            onBrandChange={setBrand}
            onStoreIdsChange={setStoreIds}
            onKeywordChange={setKeyword}
            onDealerChange={setDealer}
            onSupplierChange={setSupplier}
            onWarehouseChange={setWarehouse}
            onSearch={fetchData}
            onReset={handleReset}
            onExport={handleExport}
            dataSourceOptions={DATA_SOURCE_OPTIONS}
            templateOptions={TEMPLATES}
          />

          {/* Config zones - horizontal */}
          <div className="bg-white rounded border border-gray-200 p-3 flex gap-3">
            <DropZonePanel
              title="筛选区"
              icon={zoneIcons.filters}
              hint="拖入字段作为筛选"
              zone="filters"
              items={filters.map((k) => ({ key: k, label: getFieldLabel(k) }))}
              isDragOver={dragOverZone === 'filters'}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onRemove={(k) => removeFromZone('filters', k)}
              onDragStartFromZone={(e, k) =>
                handleDragStartFromZone(e, k, 'filters')
              }
              onReorder={(from, to) => handleReorder('filters', from, to)}
            />
            <DropZonePanel
              title="行区"
              icon={zoneIcons.rows}
              hint="拖入字段进行行分组"
              zone="rows"
              items={rows.map((k) => ({ key: k, label: getFieldLabel(k) }))}
              isDragOver={dragOverZone === 'rows'}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onRemove={(k) => removeFromZone('rows', k)}
              onDragStartFromZone={(e, k) =>
                handleDragStartFromZone(e, k, 'rows')
              }
              onReorder={(from, to) => handleReorder('rows', from, to)}
            />
            <DropZonePanel
              title="列区"
              icon={zoneIcons.cols}
              hint="拖入字段展开为列"
              zone="cols"
              items={cols.map((k) => ({ key: k, label: getFieldLabel(k) }))}
              isDragOver={dragOverZone === 'cols'}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onRemove={(k) => removeFromZone('cols', k)}
              onDragStartFromZone={(e, k) =>
                handleDragStartFromZone(e, k, 'cols')
              }
              onReorder={(from, to) => handleReorder('cols', from, to)}
            />
            <ValueDropZonePanel
              title="值区"
              icon={zoneIcons.values}
              hint="拖入指标进行聚合"
              zone="values"
              values={values}
              isDragOver={dragOverZone === 'values'}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onRemove={(k) => removeFromZone('values', k)}
              onChangeAgg={changeAgg}
              onDragStartFromZone={(e, k) =>
                handleDragStartFromZone(e, k, 'values')
              }
              onReorder={(from, to) => handleReorder('values', from, to)}
            />
          </div>

          {/* Pivot table */}
          <div className="flex-1 bg-white rounded border border-gray-200 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50">
              <span className="text-sm text-gray-600">
                透视结果
                {response && (
                  <span className="ml-2 text-gray-400">
                    共 {response.rowCount} 行
                  </span>
                )}
              </span>
              <button
                onClick={handleExport}
                disabled={!response || loading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={14} />
                导出 CSV
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              {loading && (
                <div className="flex items-center justify-center py-16 text-gray-400">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  <span className="text-sm">加载中...</span>
                </div>
              )}
              {!loading && !response && (
                <div className="text-center py-16 text-gray-400 text-sm">
                  请拖入字段并配置透视表
                </div>
              )}
              {!loading && response && (
                <PivotTable
                  response={response}
                  displayRows={displayRows}
                  collapsedRows={collapsedRows}
                  onToggleRow={toggleRowCollapse}
                  hasChildren={hasChildren}
                  structureKey={tableStructureKey}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
