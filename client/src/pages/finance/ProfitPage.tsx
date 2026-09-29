import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

interface ProfitAnalysis {
  orderNo: string;
  customerName: string;
  salesAmount: number;
  materialCost: number;
  outboundCost: number;
  profit: number;
  profitRate: number;
  items: ProfitAnalysisItem[];
}

interface ProfitAnalysisItem {
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

const ProfitPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [analysis, setAnalysis] = useState<ProfitAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      const res = await axiosForBackend.get('/api/sales/order?pageSize=100&status=approved');
      setOrders(res.data.items || []);
    } catch (error) {
      logger.error('加载订单失败', error);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedOrderId) {
      toast('请选择销售订单');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await axiosForBackend.get(`/api/finance/profit/order?orderId=${selectedOrderId}`);
      setAnalysis(res.data);
    } catch (error) {
      logger.error('毛利分析失败', error);
      toast('分析失败');
      setAnalysis(null);
    }
    setAnalyzing(false);
  };

  const handleExport = () => {
    if (!analysis) {
      toast('请先进行毛利分析');
      return;
    }
    try {
      const data = analysis.items.map((it: ProfitAnalysisItem) => ({
        skuCode: it.skuCode,
        styleNo: it.styleNo,
        color: it.color,
        size: it.size,
        quantity: it.quantity,
        unitPrice: it.unitPrice.toFixed(2),
        salesAmount: it.salesAmount.toFixed(2),
        unitCost: it.unitCost.toFixed(2),
        costAmount: it.costAmount.toFixed(2),
        unitProfit: it.unitProfit.toFixed(2),
        profit: it.profit.toFixed(2),
        profitRate: it.salesAmount > 0 ? ((it.profit / it.salesAmount) * 100).toFixed(1) + '%' : '0.0%',
      }));
      exportTableToCSV('毛利分析明细', data as unknown as Record<string, unknown>[], {
        skuCode: 'SKU编码',
        styleNo: '款号',
        color: '颜色',
        size: '尺码',
        quantity: '数量',
        unitPrice: '单价',
        salesAmount: '金额',
        unitCost: '单位成本',
        costAmount: '总成本',
        unitProfit: '单位毛利',
        profit: '总毛利',
        profitRate: '毛利率',
      });
    } catch (error) {
      logger.error('导出毛利分析失败', error);
      toast(errMsg(error, '导出失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-800">订单毛利分析</h1>
        </div>

      <div className="flex flex-wrap gap-3 items-end mb-6 p-4 bg-gray-50 rounded">
        <div>
          <label className="block text-sm text-gray-600 mb-1">选择销售订单 *</label>
          <select
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm w-72 focus:outline-none focus:border-blue-500"
          >
            <option value="">请选择已审核的销售订单</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo} - {o.customerName} - ¥{o.totalAmount?.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={!selectedOrderId || analyzing}
          className="px-6 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing ? '分析中...' : '开始分析'}
        </button>
        <button
          onClick={handleExport}
          disabled={!analysis}
          className="px-6 py-2 bg-white text-gray-700 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          导出
        </button>
      </div>

      {analysis ? (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-600 mb-1">销售金额</div>
              <div className="text-2xl font-semibold text-blue-700">¥{analysis.salesAmount.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <div className="text-sm text-orange-600 mb-1">总成本</div>
              <div className="text-2xl font-semibold text-orange-700">¥{(analysis.materialCost + analysis.outboundCost).toFixed(2)}</div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-sm text-green-600 mb-1">毛利</div>
              <div className="text-2xl font-semibold text-green-700">¥{analysis.profit.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <div className="text-sm text-purple-600 mb-1">毛利率</div>
              <div className="text-2xl font-semibold text-purple-700">{analysis.profitRate.toFixed(2)}%</div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-3">成本构成</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">物料成本：</span>
                <span className="text-gray-800 font-medium">¥{analysis.materialCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">出库成本：</span>
                <span className="text-gray-800 font-medium">¥{analysis.outboundCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">合计成本：</span>
                 <span className="text-gray-800 font-medium">¥{(analysis.materialCost + analysis.outboundCost).toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">SKU明细</h3>
            <TableContainer>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 font-medium">
                    <th className="px-3 py-2 text-left">SKU编码</th>
                    <th className="px-3 py-2 text-left">款号</th>
                    <th className="px-3 py-2 text-left">颜色</th>
                    <th className="px-3 py-2 text-left">尺码</th>
                    <th className="px-3 py-2 text-right">数量</th>
                    <th className="px-3 py-2 text-right">单价</th>
                    <th className="px-3 py-2 text-right">金额</th>
                    <th className="px-3 py-2 text-right">单位成本</th>
                    <th className="px-3 py-2 text-right">总成本</th>
                    <th className="px-3 py-2 text-right">单位毛利</th>
                    <th className="px-3 py-2 text-right">总毛利</th>
                    <th className="px-3 py-2 text-right">毛利率</th>
                  </tr>
                </thead>
                 <tbody>
                   {analysis.items?.map((sku) => (
                     <tr key={sku.skuCode} className="border-t border-gray-200">
                       <td className="px-3 py-2 text-gray-700">{sku.skuCode}</td>
                       <td className="px-3 py-2 text-gray-600">{sku.styleNo}</td>
                       <td className="px-3 py-2 text-gray-600">{sku.color}</td>
                       <td className="px-3 py-2 text-gray-600">{sku.size}</td>
                       <td className="px-3 py-2 text-right">{sku.quantity.toFixed(0)}</td>
                       <td className="px-3 py-2 text-right">¥{sku.unitPrice.toFixed(2)}</td>
                       <td className="px-3 py-2 text-right">¥{sku.salesAmount.toFixed(2)}</td>
                       <td className="px-3 py-2 text-right text-orange-600">¥{sku.unitCost.toFixed(2)}</td>
                       <td className="px-3 py-2 text-right text-orange-600">¥{sku.costAmount.toFixed(2)}</td>
                       <td className="px-3 py-2 text-right text-green-600">¥{sku.unitProfit.toFixed(2)}</td>
                       <td className="px-3 py-2 text-right text-green-600 font-medium">¥{sku.profit.toFixed(2)}</td>
                       <td className="px-3 py-2 text-right">{sku.salesAmount > 0 ? ((sku.profit / sku.salesAmount) * 100).toFixed(1) : '0.0'}%</td>
                     </tr>
                   ))}
                 </tbody>
                 <tfoot>
                   <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
                     <td colSpan={4} className="px-3 py-2 text-gray-700">合计</td>
                      <td className="px-3 py-2 text-right">
                        {analysis.items?.reduce((sum, s) => sum + s.quantity, 0).toFixed(0) || 0}
                      </td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right text-blue-700">¥{analysis.salesAmount.toFixed(2)}</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right text-orange-700">¥{analysis.outboundCost.toFixed(2)}</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right text-green-700">¥{analysis.profit.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{analysis.profitRate.toFixed(1)}%</td>
                   </tr>
                 </tfoot>
               </table>
             </TableContainer>
           </div>

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <strong>毛利计算公式：</strong>
            <br />
            销售金额 − 物料成本 − 出库成本 = 毛利
            <br />
            毛利率 = 毛利 ÷ 销售金额 × 100%
          </div>
        </div>
      ) : (
        <div className="py-16 text-center text-gray-400">
          请选择销售订单后点击"开始分析"查看毛利情况
        </div>
      )}
      </div>
    </div>
  );
};

export default ProfitPage;
