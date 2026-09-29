import { useState, useEffect, useMemo } from 'react';
import { pricingApi } from '@client/src/api/pricing';
import { toast } from 'sonner';
import { Plus, Trash2, Tags, Percent, Ticket } from 'lucide-react';

type Tab = 'priceList' | 'promotion' | 'coupon';

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>('priceList');

  /* ---------- 价格表 ---------- */
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [plForm, setPlForm] = useState({
    code: '',
    name: '',
    type: 'store',
    scopeId: '',
    priority: '0',
  });
  const [selectedPl, setSelectedPl] = useState<string | null>(null);
  const [plItems, setPlItems] = useState<any[]>([]);
  const [itemForm, setItemForm] = useState({
    skuCode: '',
    styleNo: '',
    tagPrice: '',
    price: '',
  });

  /* ---------- 促销 ---------- */
  const [promotions, setPromotions] = useState<any[]>([]);
  const [promoForm, setPromoForm] = useState({
    code: '',
    name: '',
    type: 'full_reduction',
    threshold: '',
    reduceAmount: '',
    discountRate: '1',
    beginDate: '',
    endDate: '',
  });

  /* ---------- 优惠券 ---------- */
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponForm, setCouponForm] = useState({
    code: '',
    name: '',
    type: 'full_reduction',
    value: '',
    discountRate: '1',
    minSpend: '0',
  });

  const loadPriceLists = async () => {
    try {
      const res = await pricingApi.listPriceLists({ page: 1, pageSize: 100 });
      setPriceLists((res as any)?.items || []);
    } catch (e: any) {
      toast.error(e?.message || '加载价格表失败');
    }
  };
  const loadPromotions = async () => {
    try {
      const res = await pricingApi.listPromotions({ page: 1, pageSize: 100 });
      setPromotions((res as any)?.items || []);
    } catch (e: any) {
      toast.error(e?.message || '加载促销失败');
    }
  };
  const loadCoupons = async () => {
    try {
      const res = await pricingApi.listCoupons({ page: 1, pageSize: 100 });
      setCoupons((res as any)?.items || []);
    } catch (e: any) {
      toast.error(e?.message || '加载优惠券失败');
    }
  };

  useEffect(() => {
    loadPriceLists();
    loadPromotions();
    loadCoupons();
  }, []);

  const loadPlItems = async (id: string) => {
    try {
      const detail = await pricingApi.getPriceList(id);
      setPlItems((detail as any)?.items || []);
    } catch {
      setPlItems([]);
    }
  };

  const createPriceList = async () => {
    if (!plForm.code || !plForm.name) return toast.error('编码和名称为必填');
    try {
      await pricingApi.createPriceList({
        ...plForm,
        priority: Number(plForm.priority) || 0,
        scopeId: plForm.scopeId || undefined,
      });
      toast.success('价格表已创建');
      setPlForm({ code: '', name: '', type: 'store', scopeId: '', priority: '0' });
      await loadPriceLists();
    } catch (e: any) {
      toast.error(e?.message || '创建失败');
    }
  };

  const deletePriceList = async (id: string) => {
    try {
      await pricingApi.deletePriceList(id);
      toast.success('已删除');
      if (selectedPl === id) {
        setSelectedPl(null);
        setPlItems([]);
      }
      await loadPriceLists();
    } catch (e: any) {
      toast.error(e?.message || '删除失败');
    }
  };

  const addPlItem = async () => {
    if (!selectedPl) return toast.error('请先选择价格表');
    if (!itemForm.skuCode && !itemForm.styleNo) return toast.error('SKU编码或款号必填其一');
    try {
      await pricingApi.addPriceListItems(selectedPl, [
        {
          skuCode: itemForm.skuCode || undefined,
          styleNo: itemForm.styleNo || undefined,
          tagPrice: Number(itemForm.tagPrice) || 0,
          price: Number(itemForm.price) || 0,
        },
      ]);
      toast.success('已添加价格明细');
      setItemForm({ skuCode: '', styleNo: '', tagPrice: '', price: '' });
      await loadPlItems(selectedPl);
    } catch (e: any) {
      toast.error(e?.message || '添加失败');
    }
  };

  const createPromotion = async () => {
    if (!promoForm.code || !promoForm.name) return toast.error('编码和名称为必填');
    try {
      await pricingApi.createPromotion({
        ...promoForm,
        threshold: Number(promoForm.threshold) || 0,
        reduceAmount: Number(promoForm.reduceAmount) || 0,
        discountRate: Number(promoForm.discountRate) || 1,
        beginDate: promoForm.beginDate || undefined,
        endDate: promoForm.endDate || undefined,
      });
      toast.success('促销已创建');
      setPromoForm({
        code: '',
        name: '',
        type: 'full_reduction',
        threshold: '',
        reduceAmount: '',
        discountRate: '1',
        beginDate: '',
        endDate: '',
      });
      await loadPromotions();
    } catch (e: any) {
      toast.error(e?.message || '创建失败');
    }
  };

  const deletePromotion = async (id: string) => {
    try {
      await pricingApi.deletePromotion(id);
      toast.success('已删除');
      await loadPromotions();
    } catch (e: any) {
      toast.error(e?.message || '删除失败');
    }
  };

  const createCoupon = async () => {
    if (!couponForm.code || !couponForm.name) return toast.error('编码和名称为必填');
    try {
      await pricingApi.createCoupon({
        ...couponForm,
        value: Number(couponForm.value) || 0,
        discountRate: Number(couponForm.discountRate) || 1,
        minSpend: Number(couponForm.minSpend) || 0,
      });
      toast.success('优惠券已创建');
      setCouponForm({
        code: '',
        name: '',
        type: 'full_reduction',
        value: '',
        discountRate: '1',
        minSpend: '0',
      });
      await loadCoupons();
    } catch (e: any) {
      toast.error(e?.message || '创建失败');
    }
  };

  const deleteCoupon = async (id: string) => {
    try {
      await pricingApi.deleteCoupon(id);
      toast.success('已删除');
      await loadCoupons();
    } catch (e: any) {
      toast.error(e?.message || '删除失败');
    }
  };

  const tabs = useMemo(
    () => [
      { key: 'priceList' as Tab, label: '价格表', icon: <Tags className="w-4 h-4" /> },
      { key: 'promotion' as Tab, label: '促销活动', icon: <Percent className="w-4 h-4" /> },
      { key: 'coupon' as Tab, label: '优惠券', icon: <Ticket className="w-4 h-4" /> },
    ],
    [],
  );

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">价格与促销管理</h1>

      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex items-center gap-1 px-4 py-2 -mb-px border-b-2 ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500'
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'priceList' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="bg-gray-50 p-3 rounded mb-3">
              <div className="font-medium mb-2">新建价格表</div>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded px-2 py-1.5" placeholder="编码" value={plForm.code} onChange={(e) => setPlForm({ ...plForm, code: e.target.value })} />
                <input className="border rounded px-2 py-1.5" placeholder="名称" value={plForm.name} onChange={(e) => setPlForm({ ...plForm, name: e.target.value })} />
                <select className="border rounded px-2 py-1.5" value={plForm.type} onChange={(e) => setPlForm({ ...plForm, type: e.target.value })}>
                  <option value="store">门店价</option>
                  <option value="channel">渠道价</option>
                  <option value="member">会员价</option>
                  <option value="customer">客户价</option>
                </select>
                <input className="border rounded px-2 py-1.5" placeholder="适用对象ID(可选)" value={plForm.scopeId} onChange={(e) => setPlForm({ ...plForm, scopeId: e.target.value })} />
                <input className="border rounded px-2 py-1.5" placeholder="优先级" type="number" value={plForm.priority} onChange={(e) => setPlForm({ ...plForm, priority: e.target.value })} />
                <button className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded px-2" onClick={createPriceList}>
                  <Plus className="w-4 h-4" /> 创建
                </button>
              </div>
            </div>

            <table className="w-full text-sm border rounded overflow-hidden">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left px-3 py-2">编码</th>
                  <th className="text-left px-3 py-2">名称</th>
                  <th className="text-left px-3 py-2">类型</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {priceLists.map((pl) => (
                  <tr
                    key={pl.id}
                    className={`border-t cursor-pointer ${selectedPl === pl.id ? 'bg-blue-50' : ''}`}
                    onClick={() => {
                      setSelectedPl(pl.id);
                      loadPlItems(pl.id);
                    }}
                  >
                    <td className="px-3 py-2">{pl.code}</td>
                    <td className="px-3 py-2">{pl.name}</td>
                    <td className="px-3 py-2">{pl.type}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="text-red-500" onClick={(e) => { e.stopPropagation(); deletePriceList(pl.id); }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="font-medium mb-2">价格明细{selectedPl ? '（已选价格表）' : '（请选择左侧价格表）'}</div>
            <div className="bg-gray-50 p-3 rounded mb-3">
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded px-2 py-1.5" placeholder="SKU编码" value={itemForm.skuCode} onChange={(e) => setItemForm({ ...itemForm, skuCode: e.target.value })} />
                <input className="border rounded px-2 py-1.5" placeholder="款号" value={itemForm.styleNo} onChange={(e) => setItemForm({ ...itemForm, styleNo: e.target.value })} />
                <input className="border rounded px-2 py-1.5" placeholder="吊牌价" type="number" value={itemForm.tagPrice} onChange={(e) => setItemForm({ ...itemForm, tagPrice: e.target.value })} />
                <input className="border rounded px-2 py-1.5" placeholder="售价" type="number" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} />
                <button className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded px-2 col-span-2" onClick={addPlItem}>
                  <Plus className="w-4 h-4" /> 添加明细
                </button>
              </div>
            </div>
            <table className="w-full text-sm border rounded overflow-hidden">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-right px-3 py-2">吊牌价</th>
                  <th className="text-right px-3 py-2">售价</th>
                </tr>
              </thead>
              <tbody>
                {plItems.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-3 py-2">{it.skuCode || it.styleNo}</td>
                    <td className="px-3 py-2 text-right">{Number(it.tagPrice).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(it.price).toFixed(2)}</td>
                  </tr>
                ))}
                {plItems.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-gray-400 py-4">暂无明细</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'promotion' && (
        <div>
          <div className="bg-gray-50 p-3 rounded mb-3">
            <div className="font-medium mb-2">新建促销活动</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <input className="border rounded px-2 py-1.5" placeholder="编码" value={promoForm.code} onChange={(e) => setPromoForm({ ...promoForm, code: e.target.value })} />
              <input className="border rounded px-2 py-1.5" placeholder="名称" value={promoForm.name} onChange={(e) => setPromoForm({ ...promoForm, name: e.target.value })} />
              <select className="border rounded px-2 py-1.5" value={promoForm.type} onChange={(e) => setPromoForm({ ...promoForm, type: e.target.value })}>
                <option value="full_reduction">满减</option>
                <option value="percentage">折扣</option>
                <option value="fixed_price">特价</option>
              </select>
              <input className="border rounded px-2 py-1.5" placeholder="门槛金额" type="number" value={promoForm.threshold} onChange={(e) => setPromoForm({ ...promoForm, threshold: e.target.value })} />
              <input className="border rounded px-2 py-1.5" placeholder="减免金额" type="number" value={promoForm.reduceAmount} onChange={(e) => setPromoForm({ ...promoForm, reduceAmount: e.target.value })} />
              <input className="border rounded px-2 py-1.5" placeholder="折扣率(0~1)" type="number" step="0.01" value={promoForm.discountRate} onChange={(e) => setPromoForm({ ...promoForm, discountRate: e.target.value })} />
              <input className="border rounded px-2 py-1.5" type="date" value={promoForm.beginDate} onChange={(e) => setPromoForm({ ...promoForm, beginDate: e.target.value })} />
              <input className="border rounded px-2 py-1.5" type="date" value={promoForm.endDate} onChange={(e) => setPromoForm({ ...promoForm, endDate: e.target.value })} />
              <button className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded px-2" onClick={createPromotion}>
                <Plus className="w-4 h-4" /> 创建
              </button>
            </div>
          </div>
          <table className="w-full text-sm border rounded overflow-hidden">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left px-3 py-2">编码</th>
                <th className="text-left px-3 py-2">名称</th>
                <th className="text-left px-3 py-2">类型</th>
                <th className="text-right px-3 py-2">门槛/减免</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">{p.code}</td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2">{p.type}</td>
                  <td className="px-3 py-2 text-right">
                    {p.type === 'percentage'
                      ? `折扣 ${Number(p.discountRate)}`
                      : `满${Number(p.threshold)}减${Number(p.reduceAmount)}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-red-500" onClick={() => deletePromotion(p.id)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'coupon' && (
        <div>
          <div className="bg-gray-50 p-3 rounded mb-3">
            <div className="font-medium mb-2">新建优惠券</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <input className="border rounded px-2 py-1.5" placeholder="编码" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} />
              <input className="border rounded px-2 py-1.5" placeholder="名称" value={couponForm.name} onChange={(e) => setCouponForm({ ...couponForm, name: e.target.value })} />
              <select className="border rounded px-2 py-1.5" value={couponForm.type} onChange={(e) => setCouponForm({ ...couponForm, type: e.target.value })}>
                <option value="full_reduction">满减券</option>
                <option value="discount">折扣券</option>
              </select>
              <input className="border rounded px-2 py-1.5" placeholder="面额/减免" type="number" value={couponForm.value} onChange={(e) => setCouponForm({ ...couponForm, value: e.target.value })} />
              <input className="border rounded px-2 py-1.5" placeholder="折扣率(0~1)" type="number" step="0.01" value={couponForm.discountRate} onChange={(e) => setCouponForm({ ...couponForm, discountRate: e.target.value })} />
              <input className="border rounded px-2 py-1.5" placeholder="最低消费" type="number" value={couponForm.minSpend} onChange={(e) => setCouponForm({ ...couponForm, minSpend: e.target.value })} />
              <button className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded px-2" onClick={createCoupon}>
                <Plus className="w-4 h-4" /> 创建
              </button>
            </div>
          </div>
          <table className="w-full text-sm border rounded overflow-hidden">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left px-3 py-2">编码</th>
                <th className="text-left px-3 py-2">名称</th>
                <th className="text-left px-3 py-2">类型</th>
                <th className="text-right px-3 py-2">面额/折扣</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">{c.code}</td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">{c.type}</td>
                  <td className="px-3 py-2 text-right">
                    {c.type === 'discount' ? `折扣 ${Number(c.discountRate)}` : `¥${Number(c.value)}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-red-500" onClick={() => deleteCoupon(c.id)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
