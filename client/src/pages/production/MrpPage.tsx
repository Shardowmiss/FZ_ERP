import React, { useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type { MrpResult, MrpResultItem, Bom } from '@shared/api.interface';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';

const MrpPage: React.FC = () => {
  const [styleId, setStyleId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [bomVersion, setBomVersion] = useState<string>('');
  const [bomList, setBomList] = useState<Bom[]>([]);
  const [styleOptions, setStyleOptions] = useState<{ id: string; styleNo: string; name: string }[]>([]);
  const [result, setResult] = useState<MrpResult | null>(null);
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
    } catch (e) {
      toast(errMsg(e, '加载BOM版本失败'));
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
      const res = await productionApi.mrp.calculate(params);
      setResult(res);
    } catch (e) {
      toast(errMsg(e, 'MRP计算失败'));
    } finally {
      setLoading(false);
    }
  };

  const mainItems = result?.items.filter((it: MrpResultItem) => it.bomType === '主料') ?? [];
  const auxItems = result?.items.filter((it: MrpResultItem) => it.bomType === '辅料') ?? [];
  const pkgItems = result?.items.filter((it: MrpResultItem) => it.bomType === '包材') ?? [];

  const sumNetDemand = (items: MrpResultItem[]): number =>
    items.reduce((sum: number, it: MrpResultItem) => sum + it.netDemand, 0);

  return (
    <div className="space-y-4">
      {/* 参数区 */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">物料需求计算（MRP）</h1>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">款号<span className="text-red-500">*</span></label>
            <select
              value={styleId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { void handleStyleChange(e.target.value); }}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary w-56"
            >
              <option value="">请选择款号</option>
              {styleOptions.map((s: { id: string; styleNo: string; name: string }) => (
                <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">生产数量<span className="text-red-500">*</span></label>
            <input
              type="number"
              value={quantity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(Number(e.target.value))}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary w-40"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">BOM版本</label>
            <select
              value={bomVersion}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBomVersion(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary w-40"
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
            className="px-5 py-1.5 text-sm bg-primary text-white rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
          >
            <Calculator size={16} /> 计算
          </button>
        </div>
      </div>

      {/* 结果区 */}
      {result && (
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-600">
              款号：<span className="font-medium text-gray-800">{result.styleNo}</span>
              <span className="mx-3">款名：<span className="font-medium text-gray-800">{result.styleName}</span></span>
              <span>生产数量：<span className="font-medium text-gray-800">{result.productionQty}</span></span>
              <span className="mx-3">BOM版本：<span className="font-medium text-gray-800">{result.bomVersion}</span></span>
            </div>
          </div>

          {result.items.length === 0 ? (
            <div className="text-center py-12 text-gray-400">暂无物料需求数据</div>
          ) : (
            <>
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
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-24">毛需求</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-24">现库存</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-24">净需求</th>
                    <th className="text-right py-2.5 px-3 font-medium border-b border-gray-200 w-28">建议采购量</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it: MrpResultItem) => (
                    <tr key={it.materialId} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                      <td className="py-2 px-3">{it.materialCode}</td>
                      <td className="py-2 px-3">{it.materialName}</td>
                      <td className="py-2 px-3">{it.unit}</td>
                      <td className="py-2 px-3">{it.bomType}</td>
                      <td className="py-2 px-3 text-right">{it.usagePerPiece}</td>
                      <td className="py-2 px-3 text-right">{it.lossRate}%</td>
                      <td className="py-2 px-3 text-right font-medium text-gray-800">{it.grossDemand.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right">{it.stockQty}</td>
                      <td className="py-2 px-3 text-right font-medium text-blue-600">{it.netDemand.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right font-medium text-orange-600">{it.suggestedPurchaseQty.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 text-gray-600">
                    <td colSpan={8} className="py-2.5 px-3 font-medium text-right">主料需求合计：</td>
                    <td className="py-2.5 px-3 font-medium text-right text-blue-600">{sumNetDemand(mainItems).toFixed(3)}</td>
                    <td className="py-2.5 px-3 font-medium text-right text-orange-600">
                      {mainItems.reduce((s: number, it: MrpResultItem) => s + it.suggestedPurchaseQty, 0).toFixed(3)}
                    </td>
                  </tr>
                  <tr className="bg-gray-50 text-gray-600">
                    <td colSpan={8} className="py-2.5 px-3 font-medium text-right">辅料需求合计：</td>
                    <td className="py-2.5 px-3 font-medium text-right text-blue-600">{sumNetDemand(auxItems).toFixed(3)}</td>
                    <td className="py-2.5 px-3 font-medium text-right text-orange-600">
                      {auxItems.reduce((s: number, it: MrpResultItem) => s + it.suggestedPurchaseQty, 0).toFixed(3)}
                    </td>
                  </tr>
                  <tr className="bg-gray-50 text-gray-600">
                    <td colSpan={8} className="py-2.5 px-3 font-medium text-right">包材需求合计：</td>
                    <td className="py-2.5 px-3 font-medium text-right text-blue-600">{sumNetDemand(pkgItems).toFixed(3)}</td>
                    <td className="py-2.5 px-3 font-medium text-right text-orange-600">
                      {pkgItems.reduce((s: number, it: MrpResultItem) => s + it.suggestedPurchaseQty, 0).toFixed(3)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              </TableContainer>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MrpPage;
