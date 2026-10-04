import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { omniApi } from '@client/src/api/omni';
import type {
  SalesChannel,
  OmniOrder,
  OmniOrderDetail,
  OmniAllocateResult,
} from '@shared/api.interface';
import { errMsg } from '@/utils/errMsg';

interface ItemRow {
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待审',
  approved: '已审',
  completed: '已完成',
};

const OmniPage: React.FC = () => {
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [orders, setOrders] = useState<OmniOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [channelId, setChannelId] = useState('');
  const [detail, setDetail] = useState<OmniOrderDetail | null>(null);
  const [allocateResult, setAllocateResult] = useState<OmniAllocateResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelCode, setNewChannelCode] = useState('');
  const [cForm, setCForm] = useState({ channelId: '', customerName: '', items: [{ skuCode: '', styleNo: '', color: '', size: '', quantity: 1, price: 0 }] as ItemRow[] });

  const loadChannels = async () => {
    try { setChannels(await omniApi.channels()); } catch (e) { toast('加载渠道失败'); }
  };
  const loadOrders = async () => {
    try {
      const r = await omniApi.orders(page, 20, status || undefined, channelId || undefined);
      setOrders(r?.list ?? []); setTotal(r?.total ?? 0);
    } catch (e) { toast(errMsg(e, '加载订单失败')); }
  };

  useEffect(() => { loadChannels(); }, []);
  useEffect(() => { loadOrders(); }, [page, status, channelId]);

  const addChannel = async () => {
    if (!newChannelName || !newChannelCode) { toast('请填写渠道名称与编码'); return; }
    try { await omniApi.createChannel({ name: newChannelName, channelCode: newChannelCode }); toast.success('渠道已添加'); setNewChannelName(''); setNewChannelCode(''); loadChannels(); } catch (e) { toast(errMsg(e, '添加失败')); }
  };

  const openDetail = async (id: string) => {
    try { setDetail(await omniApi.order(id)); setAllocateResult(null); } catch (e) { toast(errMsg(e, '加载明细失败')); }
  };

  const resolveSku = async (skuCode: string) => {
    try {
      const r = await axiosForBackend.get('/api/base/sku', { params: { keyword: skuCode, pageSize: 5 } });
      const items: any[] = r.data?.items || [];
      const m = items.find((s) => s.skuCode === skuCode) || items[0];
      return m ? { skuId: m.id, styleNo: m.styleNo, color: m.color, size: m.size } : null;
    } catch { return null; }
  };

  const createOrder = async () => {
    if (!cForm.channelId || !cForm.customerName) { toast('请选择渠道并填写客户'); return; }
    try {
      const items: any[] = [];
      for (const it of cForm.items) {
        if (!it.skuCode) continue;
        const m = await resolveSku(it.skuCode);
        if (!m) { toast(`SKU ${it.skuCode} 未找到`); return; }
        items.push({ ...m, quantity: it.quantity, price: it.price });
      }
      if (items.length === 0) { toast('请至少添加一个商品'); return; }
      await omniApi.createOrder({ channelId: cForm.channelId, customerName: cForm.customerName, items });
      toast.success('订单已创建');
      setShowCreate(false);
      setCForm({ channelId: '', customerName: '', items: [{ skuCode: '', styleNo: '', color: '', size: '', quantity: 1, price: 0 }] });
      loadOrders();
    } catch (e) { toast('创建失败'); }
  };

  const audit = async (id: string) => { try { await omniApi.audit(id); toast.success('已审单'); openDetail(id); loadOrders(); } catch (e) { toast(errMsg(e, '审单失败')); } };
  const allocate = async (id: string) => { try { setAllocateResult(await omniApi.allocate(id)); toast.success('已分配'); openDetail(id); } catch (e) { toast(errMsg(e, '分配失败')); } };
  const ship = async (id: string) => { try { await omniApi.ship(id); toast.success('已发货'); openDetail(id); loadOrders(); } catch (e) { toast(errMsg(e, '发货失败')); } };

  const updateItem = (idx: number, patch: Partial<ItemRow>) => {
    setCForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  };

  return (
    <div className="p-5 space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-800">全渠道 OMS</h1>
          <button onClick={() => setShowCreate((v) => !v)} className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600">
            {showCreate ? '收起' : '新建订单'}
          </button>
        </div>

        {showCreate && (
          <div className="border border-gray-200 rounded p-4 mb-4 space-y-3">
            <div className="flex gap-3 flex-wrap">
              <select value={cForm.channelId} onChange={(e) => setCForm({ ...cForm, channelId: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm">
                <option value="">选择渠道</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input placeholder="客户名称" value={cForm.customerName} onChange={(e) => setCForm({ ...cForm, customerName: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm" />
            </div>
            <div className="space-y-2">
              <div className="text-sm text-gray-600">商品明细（输入SKU编码自动匹配）</div>
              {cForm.items.map((it, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input placeholder="SKU编码" value={it.skuCode} onChange={(e) => updateItem(idx, { skuCode: e.target.value })} className="px-2 py-1 border border-gray-300 rounded text-xs w-32" />
                  <input placeholder="数量" type="number" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} className="px-2 py-1 border border-gray-300 rounded text-xs w-16" />
                  <input placeholder="单价" type="number" value={it.price} onChange={(e) => updateItem(idx, { price: Number(e.target.value) })} className="px-2 py-1 border border-gray-300 rounded text-xs w-20" />
                  {cForm.items.length > 1 && (
                    <button onClick={() => setCForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))} className="text-red-500 text-xs">删除</button>
                  )}
                </div>
              ))}
              <button onClick={() => setCForm((f) => ({ ...f, items: [...f.items, { skuCode: '', styleNo: '', color: '', size: '', quantity: 1, price: 0 }] }))} className="text-primary text-xs">+ 添加商品</button>
            </div>
            <button onClick={createOrder} className="px-4 py-2 bg-emerald-500 text-white rounded text-sm hover:bg-emerald-600">提交订单</button>
          </div>
        )}

        <div className="flex gap-3 flex-wrap items-end mb-3">
          <input placeholder="渠道编码" value={newChannelCode} onChange={(e) => setNewChannelCode(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm w-32" />
          <input placeholder="渠道名称" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm w-40" />
          <button onClick={addChannel} className="px-4 py-2 bg-gray-700 text-white rounded text-sm hover:bg-gray-800">添加渠道</button>
        </div>

        <div className="flex gap-3 flex-wrap items-end mb-3">
          <select value={channelId} onChange={(e) => { setChannelId(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="">全部渠道</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="">全部状态</option>
            <option value="pending">待审</option>
            <option value="approved">已审</option>
            <option value="completed">已完成</option>
          </select>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-medium">
              <th className="px-3 py-2 text-left">订单号</th>
              <th className="px-3 py-2 text-left">渠道</th>
              <th className="px-3 py-2 text-left">客户</th>
              <th className="px-3 py-2 text-right">金额</th>
              <th className="px-3 py-2 text-center">状态</th>
              <th className="px-3 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">暂无订单</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700">{o.orderNo}</td>
                  <td className="px-3 py-2 text-gray-600">{o.channelName}</td>
                  <td className="px-3 py-2 text-gray-700">{o.customerName}</td>
                  <td className="px-3 py-2 text-right text-gray-700">¥{Number(o.totalAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-center"><span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-600">{STATUS_LABEL[o.status] || o.status}</span></td>
                  <td className="px-3 py-2 text-center"><button onClick={() => openDetail(o.id)} className="text-primary text-xs">明细</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="text-xs text-gray-400 mt-2">共 {total} 单</div>
      </div>

      {detail && (
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-medium text-gray-800">订单明细 {detail.orderNo}</div>
            <div className="space-x-2">
              {detail.status === 'pending' && <button onClick={() => audit(detail.id)} className="px-3 py-1 bg-primary text-white rounded text-xs">审单</button>}
              {detail.status === 'approved' && <button onClick={() => allocate(detail.id)} className="px-3 py-1 bg-amber-500 text-white rounded text-xs">分配库存</button>}
              {detail.status === 'approved' && <button onClick={() => ship(detail.id)} className="px-3 py-1 bg-emerald-500 text-white rounded text-xs">发货</button>}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-medium">
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-center">颜色/尺码</th>
                <th className="px-3 py-2 text-right">数量</th>
                <th className="px-3 py-2 text-right">已分配</th>
                <th className="px-3 py-2 text-right">缺口</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 text-gray-700">{it.skuCode}</td>
                  <td className="px-3 py-2 text-center text-gray-500">{it.color}/{it.size}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{it.quantity}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{it.allocatedQty}</td>
                  <td className={`px-3 py-2 text-right ${Number(it.shortageQty) > 0 ? 'text-red-500' : 'text-gray-500'}`}>{it.shortageQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {allocateResult && (
            <div className="mt-3 text-xs text-gray-600">
              分配结果：共分配 {allocateResult.allocated}，缺口 {allocateResult.shortage} 件。
              {allocateResult.shortage > 0 && <span className="text-red-500">（存在缺货，请先补货）</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OmniPage;
