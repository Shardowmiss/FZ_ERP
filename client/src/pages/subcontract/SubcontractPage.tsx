import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

interface Option { id: string; code: string; name: string; unit?: string; costPrice?: number }
interface OrderItem { id: string; skuId: string; skuCode: string; styleNo: string; color: string; size: string; quantity: number; unitPrice: number; amount: number; receivedQty: number }

const voidSubcontract = async (type: 'order' | 'issue' | 'receipt' | 'fee', id: string, load: () => void) => {
  if (!(await showConfirm('确定作废该单据吗？作废后不可恢复'))) return;
  try {
    await axiosForBackend.post(`/api/subcontract/${type}/${id}/void`);
    toast.success('作废成功');
    load();
  } catch (e) { logger.error('作废失败', e); toast(errMsg(e, '作废失败')); }
};

const TABS = [
  { key: 'order', label: '委外订单' },
  { key: 'issue', label: '委外发料' },
  { key: 'receipt', label: '委外回收' },
  { key: 'fee', label: '加工费' },
];

const SubcontractPage: React.FC = () => {
  const [tab, setTab] = useState('order');
  const [supplierOptions, setSupplierOptions] = useState<Option[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<Option[]>([]);
  const [materialOptions, setMaterialOptions] = useState<Option[]>([]);
  const [skuOptions, setSkuOptions] = useState<Option[]>([]);
  const [orderOptions, setOrderOptions] = useState<{ id: string; orderNo: string; supplierName: string }[]>([]);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const [sup, wh, mat, sku, ord] = await Promise.all([
        axiosForBackend.get('/api/base/supplier/options'),
        axiosForBackend.get('/api/base/warehouse/options'),
        axiosForBackend.get('/api/base/material/options'),
        axiosForBackend.get('/api/base/sku?page=1&pageSize=500'),
        axiosForBackend.get('/api/subcontract/order?page=1&pageSize=500'),
      ]);
      setSupplierOptions(sup.data || []);
      setWarehouseOptions(wh.data || []);
      setMaterialOptions(mat.data || []);
      const skuItems = (sku.data?.items || []) as any[];
      setSkuOptions(skuItems.map((s) => ({ id: s.id, code: s.skuCode, name: `${s.styleNo}/${s.color}/${s.size}` })));
      const ordItems = (ord.data?.items || []) as any[];
      setOrderOptions(ordItems.map((o) => ({ id: o.id, orderNo: o.orderNo, supplierName: o.supplierName })));
    } catch (error) {
      logger.error('加载选项失败', error);
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">委外加工管理</h1>
        </div>
        <div className="flex gap-2 border-b border-gray-200 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'order' && <OrderTab supplierOptions={supplierOptions} skuOptions={skuOptions} onChanged={loadOptions} />}
        {tab === 'issue' && <IssueTab orderOptions={orderOptions} warehouseOptions={warehouseOptions} materialOptions={materialOptions} onChanged={loadOptions} />}
        {tab === 'receipt' && <ReceiptTab orderOptions={orderOptions} warehouseOptions={warehouseOptions} skuOptions={skuOptions} onChanged={loadOptions} />}
        {tab === 'fee' && <FeeTab orderOptions={orderOptions} supplierOptions={supplierOptions} onChanged={loadOptions} />}
      </div>
    </div>
  );
};

// ============ 委外订单 ============
const OrderTab: React.FC<{ supplierOptions: Option[]; skuOptions: Option[]; onChanged: () => void }> = ({ supplierOptions, skuOptions, onChanged }) => {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState('');
  const [rows, setRows] = useState<{ skuId: string; quantity: string; unitPrice: string }[]>([{ skuId: '', quantity: '', unitPrice: '' }]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axiosForBackend.get('/api/subcontract/order?page=1&pageSize=100');
      // 列表返回的是简表，详情含明细；这里展示简表并支持展开查询
      setList(res.data.items || []);
    } catch (e) { logger.error('加载失败', e); toast('加载失败'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const addRow = () => setRows([...rows, { skuId: '', quantity: '', unitPrice: '' }]);
  const updateRow = (i: number, k: keyof typeof rows[0], v: string) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!supplierId) { toast('请选择供应商'); return; }
    const items = rows.filter((r) => r.skuId && Number(r.quantity) > 0).map((r) => ({ skuId: r.skuId, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice) || 0 }));
    if (items.length === 0) { toast('请至少添加一条明细'); return; }
    try {
      await axiosForBackend.post('/api/subcontract/order', { supplierId, orderDate, deliveryDate: deliveryDate || undefined, items });
      toast.success('委外订单已创建');
      setShowForm(false);
      setRows([{ skuId: '', quantity: '', unitPrice: '' }]);
      load();
      onChanged();
    } catch (e) { logger.error('创建失败', e); toast('创建失败'); }
  };

  const approve = async (id: string) => {
    try { await axiosForBackend.post(`/api/subcontract/order/${id}/approve`); toast.success('已审核'); load(); }
    catch (e) { logger.error('审核失败', e); toast(errMsg(e, '审核失败')); }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
          {showForm ? '收起' : '新建委外订单'}
        </button>
      </div>
      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="">选择供应商</option>
              {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} placeholder="交期" className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={r.skuId} onChange={(e) => updateRow(i, 'skuId', e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm">
                  <option value="">选择SKU</option>
                  {skuOptions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
                <input type="number" placeholder="数量" value={r.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)} className="w-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                <input type="number" placeholder="单价" value={r.unitPrice} onChange={(e) => updateRow(i, 'unitPrice', e.target.value)} className="w-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                <button onClick={() => removeRow(i)} className="text-red-500 text-xs px-2">删除</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addRow} className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm">+ 添加明细</button>
            <button onClick={submit} className="px-4 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">提交</button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
            <th className="px-3 py-2 text-left">单号</th>
            <th className="px-3 py-2 text-left">供应商</th>
            <th className="px-3 py-2 text-left">订单日期</th>
            <th className="px-3 py-2 text-right">数量</th>
            <th className="px-3 py-2 text-right">金额</th>
            <th className="px-3 py-2 text-center">状态</th>
            <th className="px-3 py-2 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <tr><td colSpan={7} className="py-6 text-center text-gray-400">加载中...</td></tr>
            : list.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-gray-400">暂无委外订单</td></tr>
            : list.map((o) => (
              <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700 font-mono text-xs">{o.orderNo}</td>
                <td className="px-3 py-2 text-gray-700">{o.supplierName}</td>
                <td className="px-3 py-2 text-gray-600">{o.orderDate}</td>
                <td className="px-3 py-2 text-right text-gray-700">{Number(o.totalQuantity).toFixed(3)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{Number(o.totalAmount).toFixed(2)}</td>
                <td className="px-3 py-2 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-3 py-2 text-center">
                  {o.status === 'draft' && <button onClick={() => approve(o.id)} className="text-blue-600 text-xs px-2">审核</button>}
                  {o.status === 'draft' && <button onClick={() => voidSubcontract('order', o.id, load)} className="text-red-500 text-xs px-2">作废</button>}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ 委外发料 ============
const IssueTab: React.FC<{ orderOptions: any[]; warehouseOptions: Option[]; materialOptions: Option[]; onChanged: () => void }> = ({ orderOptions, warehouseOptions, materialOptions, onChanged }) => {
  const [list, setList] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<{ materialId: string; quantity: string }[]>([{ materialId: '', quantity: '' }]);

  const load = async () => {
    try { const res = await axiosForBackend.get('/api/subcontract/issue?page=1&pageSize=100'); setList(res.data.items || []); }
    catch (e) { logger.error('加载失败', e); toast('加载失败'); }
  };
  useEffect(() => { load(); }, []);
  const addRow = () => setRows([...rows, { materialId: '', quantity: '' }]);
  const updateRow = (i: number, k: 'materialId' | 'quantity', v: string) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!orderId || !warehouseId) { toast('请选择委外订单与仓库'); return; }
    const items = rows.filter((r) => r.materialId && Number(r.quantity) > 0).map((r) => ({ materialId: r.materialId, quantity: Number(r.quantity) }));
    if (items.length === 0) { toast('请至少添加一条明细'); return; }
    try {
      await axiosForBackend.post('/api/subcontract/issue', { orderId, warehouseId, issueDate, items });
      toast.success('发料单已创建'); setShowForm(false); setRows([{ materialId: '', quantity: '' }]); load();
    } catch (e) { logger.error('创建失败', e); toast('创建失败'); }
  };
  const approve = async (id: string) => {
    try { await axiosForBackend.post(`/api/subcontract/issue/${id}/approve`); toast.success('已审核，扣减物料库存'); load(); }
    catch (e) { logger.error('审核失败', e); toast(errMsg(e, '审核失败')); }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">{showForm ? '收起' : '新建发料单'}</button>
      </div>
      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="">选择委外订单</option>
              {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.orderNo} - {o.supplierName}</option>)}
            </select>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="">选择发料仓库</option>
              {warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={r.materialId} onChange={(e) => updateRow(i, 'materialId', e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm">
                  <option value="">选择物料</option>
                  {materialOptions.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
                </select>
                <input type="number" placeholder="数量" value={r.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)} className="w-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                <button onClick={() => removeRow(i)} className="text-red-500 text-xs px-2">删除</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addRow} className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm">+ 添加明细</button>
            <button onClick={submit} className="px-4 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">提交</button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
            <th className="px-3 py-2 text-left">发料单号</th>
            <th className="px-3 py-2 text-left">供应商</th>
            <th className="px-3 py-2 text-left">仓库</th>
            <th className="px-3 py-2 text-left">发料日期</th>
            <th className="px-3 py-2 text-center">状态</th>
            <th className="px-3 py-2 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-400">暂无发料单</td></tr>
            : list.map((o) => (
              <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700 font-mono text-xs">{o.issueNo}</td>
                <td className="px-3 py-2 text-gray-700">{o.supplierName}</td>
                <td className="px-3 py-2 text-gray-600">{o.warehouseName}</td>
                <td className="px-3 py-2 text-gray-600">{o.issueDate}</td>
                <td className="px-3 py-2 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-3 py-2 text-center">
                  {o.status === 'draft' && <button onClick={() => approve(o.id)} className="text-blue-600 text-xs px-2">审核(扣料)</button>}
                  {o.status === 'draft' && <button onClick={() => voidSubcontract('issue', o.id, load)} className="text-red-500 text-xs px-2">作废</button>}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ 委外回收 ============
const ReceiptTab: React.FC<{ orderOptions: any[]; warehouseOptions: Option[]; skuOptions: Option[]; onChanged: () => void }> = ({ orderOptions, warehouseOptions, skuOptions, onChanged }) => {
  const [list, setList] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<{ skuId: string; quantity: string; qualifiedQty: string }[]>([{ skuId: '', quantity: '', qualifiedQty: '' }]);

  const load = async () => {
    try { const res = await axiosForBackend.get('/api/subcontract/receipt?page=1&pageSize=100'); setList(res.data.items || []); }
    catch (e) { logger.error('加载失败', e); toast('加载失败'); }
  };
  useEffect(() => { load(); }, []);
  const addRow = () => setRows([...rows, { skuId: '', quantity: '', qualifiedQty: '' }]);
  const updateRow = (i: number, k: 'skuId' | 'quantity' | 'qualifiedQty', v: string) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!orderId || !warehouseId) { toast('请选择委外订单与仓库'); return; }
    const items = rows.filter((r) => r.skuId && Number(r.quantity) > 0).map((r) => ({ skuId: r.skuId, quantity: Number(r.quantity), qualifiedQty: Number(r.qualifiedQty) || Number(r.quantity) }));
    if (items.length === 0) { toast('请至少添加一条明细'); return; }
    try {
      await axiosForBackend.post('/api/subcontract/receipt', { orderId, warehouseId, receiptDate, items });
      toast.success('回收单已创建'); setShowForm(false); setRows([{ skuId: '', quantity: '', qualifiedQty: '' }]); load();
    } catch (e) { logger.error('创建失败', e); toast('创建失败'); }
  };
  const approve = async (id: string) => {
    try { await axiosForBackend.post(`/api/subcontract/receipt/${id}/approve`); toast.success('已审核，增加成衣库存'); load(); }
    catch (e) { logger.error('审核失败', e); toast(errMsg(e, '审核失败')); }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">{showForm ? '收起' : '新建回收单'}</button>
      </div>
      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="">选择委外订单</option>
              {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.orderNo} - {o.supplierName}</option>)}
            </select>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="">选择入库仓库</option>
              {warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={r.skuId} onChange={(e) => updateRow(i, 'skuId', e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm">
                  <option value="">选择SKU</option>
                  {skuOptions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
                <input type="number" placeholder="回收数" value={r.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)} className="w-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                <input type="number" placeholder="合格数" value={r.qualifiedQty} onChange={(e) => updateRow(i, 'qualifiedQty', e.target.value)} className="w-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                <button onClick={() => removeRow(i)} className="text-red-500 text-xs px-2">删除</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addRow} className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm">+ 添加明细</button>
            <button onClick={submit} className="px-4 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">提交</button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
            <th className="px-3 py-2 text-left">回收单号</th>
            <th className="px-3 py-2 text-left">供应商</th>
            <th className="px-3 py-2 text-left">仓库</th>
            <th className="px-3 py-2 text-left">回收日期</th>
            <th className="px-3 py-2 text-center">状态</th>
            <th className="px-3 py-2 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-400">暂无回收单</td></tr>
            : list.map((o) => (
              <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700 font-mono text-xs">{o.receiptNo}</td>
                <td className="px-3 py-2 text-gray-700">{o.supplierName}</td>
                <td className="px-3 py-2 text-gray-600">{o.warehouseName}</td>
                <td className="px-3 py-2 text-gray-600">{o.receiptDate}</td>
                <td className="px-3 py-2 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-3 py-2 text-center">
                  {o.status === 'draft' && <button onClick={() => approve(o.id)} className="text-blue-600 text-xs px-2">审核(入库)</button>}
                  {o.status === 'draft' && <button onClick={() => voidSubcontract('receipt', o.id, load)} className="text-red-500 text-xs px-2">作废</button>}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ 加工费 ============
const FeeTab: React.FC<{ orderOptions: any[]; supplierOptions: Option[]; onChanged: () => void }> = ({ orderOptions, supplierOptions, onChanged }) => {
  const [list, setList] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [feeType, setFeeType] = useState('processing');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const load = async () => {
    try { const res = await axiosForBackend.get('/api/subcontract/fee?page=1&pageSize=100'); setList(res.data || []); }
    catch (e) { logger.error('加载失败', e); toast('加载失败'); }
  };
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!orderId) { toast('请选择委外订单'); return; }
    if (Number(quantity) <= 0) { toast('数量必须大于0'); return; }
    try {
      await axiosForBackend.post('/api/subcontract/fee', { orderId, feeType, quantity: Number(quantity), unitPrice: Number(unitPrice) || 0 });
      toast.success('加工费已录入'); setShowForm(false); setQuantity(''); setUnitPrice(''); load();
    } catch (e) { logger.error('创建失败', e); toast('创建失败'); }
  };
  const settle = async (id: string) => {
    try { await axiosForBackend.post(`/api/subcontract/fee/${id}/settle`); toast.success('已结算，生成应付账款'); load(); onChanged(); }
    catch (e) { logger.error('结算失败', e); toast('结算失败'); }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">{showForm ? '收起' : '录入加工费'}</button>
      </div>
      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200">
          <div className="grid grid-cols-4 gap-3">
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="">选择委外订单</option>
              {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.orderNo} - {o.supplierName}</option>)}
            </select>
            <select value={feeType} onChange={(e) => setFeeType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="processing">加工费</option>
              <option value="transport">运费</option>
              <option value="other">其他</option>
            </select>
            <input type="number" placeholder="数量(件)" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
            <input type="number" placeholder="单价" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={submit} className="px-4 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">提交</button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
            <th className="px-3 py-2 text-left">费用类型</th>
            <th className="px-3 py-2 text-left">供应商</th>
            <th className="px-3 py-2 text-right">数量</th>
            <th className="px-3 py-2 text-right">单价</th>
            <th className="px-3 py-2 text-right">金额</th>
            <th className="px-3 py-2 text-center">状态</th>
            <th className="px-3 py-2 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-gray-400">暂无加工费</td></tr>
            : list.map((o) => (
              <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700">{o.feeType}</td>
                <td className="px-3 py-2 text-gray-700">{o.supplierName}</td>
                <td className="px-3 py-2 text-right text-gray-700">{Number(o.quantity).toFixed(3)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{Number(o.unitPrice).toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{Number(o.amount).toFixed(2)}</td>
                <td className="px-3 py-2 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-3 py-2 text-center">
                  {o.status === 'pending' && <button onClick={() => settle(o.id)} className="text-blue-600 text-xs px-2">结算</button>}
                  {o.status === 'pending' && <button onClick={() => voidSubcontract('fee', o.id, load)} className="text-red-500 text-xs px-2">作废</button>}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    approved: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    settled: 'bg-blue-100 text-blue-700',
    completed: 'bg-purple-100 text-purple-700',
    cancelled: 'bg-red-100 text-red-600',
  };
  const label: Record<string, string> = { draft: '草稿', approved: '已审核', pending: '待结算', settled: '已结算', completed: '完成', cancelled: '已作废' };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${map[status] || 'bg-gray-100 text-gray-600'}`}>{label[status] || status}</span>;
};

export default SubcontractPage;
