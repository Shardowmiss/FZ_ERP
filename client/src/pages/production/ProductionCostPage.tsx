import React, { useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type { ProductionCostResult, ProductionCostItem, Bom } from '@shared/api.interface';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui';

const ProductionCostPage: React.FC = () => {
  const [styleId, setStyleId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [bomVersion, setBomVersion] = useState<string>('');
  const [bomList, setBomList] = useState<Bom[]>([]);
  const [styleOptions, setStyleOptions] = useState<{ id: string; styleNo: string; name: string }[]>([]);
  const [result, setResult] = useState<ProductionCostResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const loadStyles = async (): Promise<void> => {
      try {
        const styles = await baseApi.style.options();
        setStyleOptions(styles);
      } catch {
        // ignore
      }
    };
    loadStyles();
  }, []);

  const handleStyleChange = async (val: string): Promise<void> => {
    setStyleId(val);
    setBomVersion('');
    setResult(null);
    if (!val) {
      setBomList([]);
      return;
    }
    try {
      const boms = await productionApi.bom.byStyle(val);
      setBomList(boms);
      const activeBom = boms.find((b: Bom) => b.status === 'approved');
      if (activeBom) {
        setBomVersion(activeBom.version);
      } else if (boms.length > 0) {
        setBomVersion(boms[0].version);
      }
    } catch {
      toast('加载BOM版本失败');
    }
  };

  const handleCalculate = async (): Promise<void> => {
    if (!styleId) { toast('请选择款号'); return; }
    if (!quantity || quantity <= 0) { toast('请输入有效生产数量'); return; }
    setLoading(true);
    try {
      const params: { styleId: string; quantity: number; bomVersion?: string } = {
        styleId,
        quantity: Number(quantity),
      };
      if (bomVersion) params.bomVersion = bomVersion;
      const res = await productionApi.cost.calculate(params);
      setResult(res);
    } catch {
      toast('成本核算失败');
    } finally {
      setLoading(false);
    }
  };

  const renderGroup = (title: string, items: ProductionCostItem[], colorClass: string): React.ReactNode => {
    if (items.length === 0) return null;
    const groupTotal = items.reduce((sum: number, it: ProductionCostItem) => sum + it.totalCost, 0);
    return (
      <>
        <tr className={`${colorClass} text-gray-700`}>
          <td colSpan={9} className="py-2 px-3 font-medium text-sm">{title}</td>
        </tr>
        {items.map((it: ProductionCostItem, idx: number) => (
          <tr key={idx} className="border-b border-gray-100 h-10 hover:bg-gray-50">
            <td className="py-2 px-3">{it.materialCode}</td>
            <td className="py-2 px-3">{it.materialName}</td>
            <td className="py-2 px-3">{it.unit}</td>
            <td className="py-2 px-3">{it.bomType}</td>
            <td className="py-2 px-3 text-right">{it.usagePerPiece}</td>
            <td className="py-2 px-3 text-right">{it.lossRate}%</td>
            <td className="py-2 px-3 text-right">{it.unitCost.toFixed(4)}</td>
            <td className="py-2 px-3 text-right font-medium text-gray-700">{it.perPieceCost.toFixed(4)}</td>
            <td className="py-2 px-3 text-right font-medium text-blue-600">{it.totalCost.toFixed(2)}</td>
          </tr>
        ))}
        <tr className="bg-gray-50 text-gray-600">
          <td colSpan={8} className="py-2 px-3 font-medium text-right text-sm">小计：</td>
          <td className="py-2 px-3 font-medium text-right text-blue-600">¥ {groupTotal.toFixed(2)}</td>
        </tr>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* 参数区 */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">生产成本核算</h1>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">款号<span className="text-red-500">*</span></label>
            <select
              value={styleId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { void handleStyleChange(e.target.value); }}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-56"
            >
              <option value="">请选择款号</option>
              {styleOptions.map((s: { id: string; styleNo: string; name: string }) => (
                <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">生产数量</label>
            <input
              type="number"
              value={quantity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(Number(e.target.value))}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-40"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">BOM版本</label>
            <select
              value={bomVersion}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBomVersion(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-40"
            >
              <option value="">默认（激活版本）</option>
              {bomList.map((b: Bom) => (
                <option key={b.id} value={b.version}>
                  {b.version}{b.status === 'approved' ? '（已审）' : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => { void handleCalculate(); }}
            disabled={loading}
            className="px-5 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
          >
            <Calculator size={16} /> 核算
          </button>
        </div>
      </div>

      {result && (
        <>
          {/* 成本汇总卡片 */}
          <div className="grid grid-cols-5 gap-4" data-ai-section-type="card-stat">
            <div className="bg-white rounded-lg shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">主料成本</div>
              <div className="text-2xl font-semibold text-blue-600">¥ {result.mainMaterialCost.toFixed(2)}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">辅料成本</div>
              <div className="text-2xl font-semibold text-emerald-600">¥ {result.auxiliaryMaterialCost.toFixed(2)}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">包材成本</div>
              <div className="text-2xl font-semibold text-amber-600">¥ {result.packagingCost.toFixed(2)}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">单件成本</div>
              <div className="text-2xl font-semibold text-purple-600">¥ {result.perPieceCost.toFixed(4)}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">总物料成本</div>
              <div className="text-2xl font-semibold text-red-500">¥ {result.totalMaterialCost.toFixed(2)}</div>
            </div>
          </div>

          {/* 明细表格 */}
          <div className="bg-white rounded-lg shadow-sm p-5">
             <div className="flex items-center justify-between mb-3">
               <h2 className="text-base font-semibold text-gray-800">成本明细</h2>
              <div className="text-sm text-gray-600">
                款号：<span className="font-medium text-gray-800">{result.styleNo}</span>
                <span className="mx-3">款名：<span className="font-medium text-gray-800">{result.styleName}</span></span>
                <span>生产数量：<span className="font-medium text-gray-800">{result.quantity}</span></span>
                <span className="mx-3">BOM版本：<span className="font-medium text-gray-800">{result.bomVersion}</span></span>
              </div>
            </div>

            {result.items.length === 0 ? (
              <div className="text-center py-12 text-gray-400">暂无成本明细数据</div>
            ) : (
              <TableContainer>
               <table className="w-full text-sm border-0">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="text-left py-2.5 px-3 font-medium border-b border-gray-200">物料编码</th>
                    <th className="text-left py-2.5 px-3 font-medium border-b border-gray-200">物料名称</th>
                    <th className="text-left py-2.5 px-3 font-medium border-b border-gray-200 w-16">单位</th>
                    <th className="text-left py-2.5 px-3 font-medium border-b border-gray-200 w-20">类别</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-24">单件用量</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-20">损耗率(%)</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-24">单价</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-24">单件成本</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-28">总成本</th>
                  </tr>
                </thead>
                <tbody>
                  {renderGroup(
                    '主料',
                    result.items.filter((it: ProductionCostItem) => it.bomType === '主料'),
                    'bg-blue-50',
                  )}
                  {renderGroup(
                    '辅料',
                    result.items.filter((it: ProductionCostItem) => it.bomType === '辅料'),
                    'bg-emerald-50',
                  )}
                  {renderGroup(
                    '包材',
                    result.items.filter((it: ProductionCostItem) => it.bomType === '包材'),
                    'bg-amber-50',
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 text-gray-800">
                    <td colSpan={8} className="py-2.5 px-3 font-semibold text-right">总物料成本：</td>
                    <td className="py-2.5 px-3 font-semibold text-right text-red-500">¥ {result.totalMaterialCost.toFixed(2)}</td>
                  </tr>
                </tfoot>
               </table>
              </TableContainer>
             )}
          </div>
        </>
      )}
    </div>
  );
};

export default ProductionCostPage;
