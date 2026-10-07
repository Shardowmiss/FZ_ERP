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
  PivotTemplateItem,
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
  /** 我的模板（迁移 0060）。系统预置 TEMPLATES 仍是全局的，个人模板只本人可见。 */
  const [myTemplates, setMyTemplates] = useState<PivotTemplateItem[]>([]);
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
    // 载入我的模板 + 上次查询（迁移 0060）。
    // 两者失败均静默降级：模板是增强功能，不应阻塞分析主流程。
    loadMyTemplates();
    loadLastQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 把当前界面状态打包为一份 PivotConfig。
   * 「保存为我的模板」与「记住我最后一次查询」共用此函数——
   * 两处口径必须一致，否则会出现「存的模板和实际查的不一样」的困惑。
   */
  const buildCurrentConfig = useCallback(
    (): PivotConfig => ({
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
    }),
    [dataSource, filters, rows, cols, values, startDate, endDate, brand, storeIds, keyword],
  );

  const fetchData = useCallback(async () => {
    if (values.length === 0) {
      setResponse(null);
      return;
    }
    setLoading(true);
    try {
      const body = buildCurrentConfig();
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
      // 记住我最后一次查询（迁移 0060）：查询成功即记录，业务人员下次打开
      // 页面可一键恢复，无需手动保存。失败静默——不影响本次分析结果。
      reportApi.rememberPivotLastQuery(body).catch(() => undefined);
    } catch (e) {
      logger.error('加载透视表失败', e);
      toast.error('加载透视表失败');
    } finally {
      setLoading(false);
    }
  }, [buildCurrentConfig, dataSource, rows, cols, values, filters, startDate, endDate, brand, storeIds, keyword, templateName]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dataSource, rows, cols, values, filters, fetchData]);

  /* ========== 模板：系统预置 + 我的模板（迁移 0060） ========== */

  /**
   * 下拉选项 = 我的模板 + 系统预置。
   * 我的模板排在前面（业务人员高频使用自己保存的），系统预置加「预置」后缀区分，
   * 避免同名时用户误以为自己的模板被覆盖。
   */
  const mergedTemplates = useMemo(
    () => [
      ...myTemplates.map((t) => ({ name: t.name })),
      ...TEMPLATES.filter((t) => !myTemplates.some((m) => m.name === t.name)).map((t) => ({
        name: `${t.name}（预置）`,
        rawName: t.name,
      })),
    ],
    [myTemplates],
  );

  /**
   * 从一份查询配置恢复全部界面状态。
   * 系统预置 TEMPLATES 与个人模板结构一致（都是 PivotConfig 子集），
   * 故用同一套恢复逻辑，避免两处行为漂移。
   */
  const applyConfig = (
    name: string,
    tpl: {
      dataSource: string;
      rows: string[];
      cols: string[];
      values: Array<{ key: string; label: string; agg: string }>;
      filters?: Array<{ key: string; values: string[] }>;
      startDate?: string;
      endDate?: string;
      brand?: string;
      keyword?: string;
    },
  ) => {
    setTemplateName(name);
    setDataSource(tpl.dataSource as typeof dataSource);
    setRows(tpl.rows ?? []);
    setCols(tpl.cols ?? []);
    setValues((tpl.values ?? []) as typeof values);
    setFilters(
      (tpl.filters ?? []).map((f) => f.key),
    );
    // 时间窗：模板里存了就恢复，没存则保留当前选择（避免把用户设的区间清掉）
    if (tpl.startDate) setStartDate(tpl.startDate);
    if (tpl.endDate) setEndDate(tpl.endDate);
    if (tpl.brand !== undefined) setBrand(tpl.brand);
    if (tpl.keyword !== undefined) setKeyword(tpl.keyword);
  };

  /** 统一入口：系统预置与个人模板共用（按名称查找，个人模板优先） */
  const applyTemplate = (name: string) => {
    const mine = myTemplates.find((t) => t.name === name);
    if (mine) {
      applyConfig(name, mine.config);
      return;
    }
    const preset = TEMPLATES.find(
      (t) => t.name === name || `${t.name}（预置）` === name,
    );
    if (preset) applyConfig(preset.name, preset);
  };

  /** 载入「我最后一次查询」；从未保存过则保持默认，不打扰用户 */
  const loadLastQuery = useCallback(async () => {
    try {
      const cfg = await reportApi.getPivotLastQuery();
      if (cfg) {
        applyConfig('我最后一次查询', cfg);
        toast('已恢复上次查询');
      }
    } catch {
      // 恢复失败静默降级：不影响用户正常分析
    }
  }, []);

  /** 保存当前配置为我的模板 */
  const handleSaveTemplate = async (name: string) => {
    if (!name || !name.trim()) {
      toast('请输入模板名称');
      return;
    }
    try {
      await reportApi.savePivotTemplate({ name: name.trim(), config: buildCurrentConfig() });
      await loadMyTemplates();
      setTemplateName(name.trim());
      toast(`已保存模板「${name.trim()}」`);
    } catch (e) {
      toast(`保存失败：${(e as Error).message}`);
    }
  };

  /** 删除我的模板 */
  const handleDeleteTemplate = async (name: string) => {
    const tpl = myTemplates.find((t) => t.name === name);
    if (!tpl || tpl.isLastUsed) {
      if (tpl?.isLastUsed) toast('「我最后一次查询」由系统自动维护，无需删除');
      return;
    }
    try {
      await reportApi.deletePivotTemplate(tpl.id);
      await loadMyTemplates();
      if (templateName === name) setTemplateName('');
      toast(`已删除模板「${name}」`);
    } catch (e) {
      toast(`删除失败：${(e as Error).message}`);
    }
  };

  /** 拉取我的模板（排除「最后一次」——它由系统维护，不作为可管理模板展示） */
  const loadMyTemplates = useCallback(async () => {
    try {
      const list = await reportApi.listPivotTemplates();
      setMyTemplates(list.filter((t) => !t.isLastUsed));
    } catch {
      setMyTemplates([]);
    }
  }, []);

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
            templateOptions={mergedTemplates}
            onSaveMyTemplate={() => {
              // 用 prompt 收集模板名：透视工具栏已有足够控件，此处不再叠加一层弹窗
              const name = window.prompt('给这次分析起个名字（仅你可见）', templateName || '');
              if (name) handleSaveTemplate(name);
            }}
            onRestoreLastQuery={loadLastQuery}
            onDeleteMyTemplate={() => {
              if (templateName) handleDeleteTemplate(templateName);
            }}
            myTemplateNames={myTemplates.map((t) => t.name)}
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
