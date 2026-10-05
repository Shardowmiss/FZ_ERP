import { useState, useEffect } from 'react';
import { baseApi } from '@client/src/api/base';
import { logger } from '@lark-apaas/client-toolkit/logger';

export interface ReportFilterValues {
  startDate: string;
  endDate: string;
  partnerId: string;
  partnerType: string;
  keyword: string;
  brand: string;
  warehouseId: string;
}

interface ReportFilterProps {
  showWarehouse?: boolean;
  initialValues?: Partial<ReportFilterValues>;
  onSearch: (values: ReportFilterValues) => void;
  onReset: () => void;
}

const defaultValues: ReportFilterValues = {
  startDate: '',
  endDate: '',
  partnerId: '',
  partnerType: '',
  keyword: '',
  brand: '',
  warehouseId: '',
};

export default function ReportFilter({
  showWarehouse = false,
  initialValues,
  onSearch,
  onReset,
}: ReportFilterProps) {
  const [values, setValues] = useState<ReportFilterValues>({
    ...defaultValues,
    ...initialValues,
  });

  const [partnerOptions, setPartnerOptions] = useState<
    { id: string; name: string; type: string }[]
  >([]);
  const [brandOptions, setBrandOptions] = useState<
    { attrCode: string; attrName: string }[]
  >([]);
  const [warehouseOptions, setWarehouseOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [loadingPartners, setLoadingPartners] = useState(false);

  useEffect(() => {
    loadPartners();
    loadBrands();
    if (showWarehouse) {
      loadWarehouses();
    }
  }, [showWarehouse]);

  const loadPartners = async () => {
    setLoadingPartners(true);
    try {
      const [dealers, stores] = await Promise.all([
        baseApi.dealer.options(),
        baseApi.store.options(),
      ]);
      const merged: { id: string; name: string; type: string }[] = [
        ...dealers.map((d: { id: string; name: string }) => ({
          id: d.id,
          name: `经销商 - ${d.name}`,
          type: 'dealer',
        })),
        ...stores.map((s: { id: string; name: string }) => ({
          id: s.id,
          name: `门店 - ${s.name}`,
          type: 'store',
        })),
      ];
      setPartnerOptions(merged);
    } catch (e) {
      logger.error('加载往来单位失败', e);
    } finally {
      setLoadingPartners(false);
    }
  };

  const loadBrands = async () => {
    try {
      const res = await baseApi.styleAttribute.getAll('brand', true);
      setBrandOptions(
        res.map((b: { attrCode: string; attrName: string }) => ({
          attrCode: b.attrCode,
          attrName: b.attrName,
        })),
      );
    } catch (e) {
      logger.error('加载品牌失败', e);
    }
  };

  const loadWarehouses = async () => {
    try {
      const res = await baseApi.warehouse.list({
        page: 1,
        pageSize: 1000,
        status: 'active',
      });
      setWarehouseOptions(res.items);
    } catch (e) {
      logger.error('加载仓库失败', e);
    }
  };

  const handleChange = (field: keyof ReportFilterValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSearch = () => {
    onSearch(values);
  };

  const handleReset = () => {
    setValues({ ...defaultValues, ...initialValues });
    onReset();
  };

  const inputCls =
    'border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:border-primary/70';

  return (
    <div className="bg-white p-5 rounded border border-gray-200 mb-4">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">开始日期</label>
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => handleChange('startDate', e.target.value)}
            className={inputCls + ' w-40'}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">结束日期</label>
          <input
            type="date"
            value={values.endDate}
            onChange={(e) => handleChange('endDate', e.target.value)}
            className={inputCls + ' w-40'}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">往来单位/门店</label>
          <select
            value={values.partnerId}
            onChange={(e) => {
              const opt = partnerOptions.find(
                (p) => p.id === e.target.value,
              );
              setValues((prev) => ({
                ...prev,
                partnerId: e.target.value,
                partnerType: opt?.type || '',
              }));
            }}
            className={inputCls + ' w-52'}
            disabled={loadingPartners}
          >
            <option value="">全部</option>
            {partnerOptions.map((p) => (
              <option key={`${p.type}-${p.id}`} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">品牌</label>
          <select
            value={values.brand}
            onChange={(e) => handleChange('brand', e.target.value)}
            className={inputCls + ' w-36'}
          >
            <option value="">全部</option>
            {brandOptions.map((b) => (
              <option key={b.attrCode} value={b.attrCode}>
                {b.attrName}
              </option>
            ))}
          </select>
        </div>
        {showWarehouse && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">仓库</label>
            <select
              value={values.warehouseId}
              onChange={(e) => handleChange('warehouseId', e.target.value)}
              className={inputCls + ' w-40'}
            >
              <option value="">全部</option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">关键字</label>
          <input
            type="text"
            value={values.keyword}
            onChange={(e) => handleChange('keyword', e.target.value)}
            placeholder="单据号/款号/名称"
            className={inputCls + ' w-48'}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSearch}
            className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary transition-colors"
          >
            查询
          </button>
          <button
            onClick={handleReset}
            className="bg-white text-gray-700 px-4 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
