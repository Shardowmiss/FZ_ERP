import { useState, useEffect, useMemo } from 'react';
import { baseApi } from '@client/src/api/base';
import { posApi, type PosSession } from '@client/src/api/pos';
import { pricingApi, type ResolvedPrice } from '@client/src/api/pricing';
import { toast } from 'sonner';
import { Plus, Trash2, Power, LogOut, ShoppingCart } from 'lucide-react';

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

interface CartItem {
  key: string;
  skuId: string;
  skuCode: string;
  styleNo?: string;
  quantity: number;
  unitPrice: number;
  tagPrice: number;
  promotionName?: string;
}

const PAY_METHODS = [
  { value: 'cash', label: '现金' },
  { value: 'wechat', label: '微信' },
  { value: 'alipay', label: '支付宝' },
  { value: 'card', label: '银行卡' },
  { value: 'other', label: '其他' },
];

export default function CashierPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState('');

  const [openSession, setOpenSession] = useState<PosSession | null>(null);
  const [openAmount, setOpenAmount] = useState('0');
  const [closeAmount, setCloseAmount] = useState('0');
  const [sessionLoading, setSessionLoading] = useState(false);

  const [skuInput, setSkuInput] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [adding, setAdding] = useState(false);

  const [payMethod, setPayMethod] = useState('cash');
  const [payAmount, setPayAmount] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastOrderNo, setLastOrderNo] = useState('');
  // 报价（含整单满减），用于展示应付与优惠，并作为结算金额依据
  const [quote, setQuote] = useState<{
    subtotal: number;
    discountAmount: number;
    payable: number;
    orderPromotion?: { id: string; name: string; reduceAmount: number } | null;
  } | null>(null);

  useEffect(() => {
    baseApi.store
      .options()
      .then((list: StoreOption[]) => {
        setStores(list);
        if (list.length > 0 && !storeId) setStoreId(list[0].id);
      })
      .catch(() => toast.error('加载门店失败'));
  }, []);

  const refreshSession = async (sid: string) => {
    if (!sid) {
      setOpenSession(null);
      return;
    }
    try {
      const s = await posApi.getOpenSession(sid);
      setOpenSession(s);
    } catch {
      setOpenSession(null);
    }
  };

  useEffect(() => {
    if (storeId) refreshSession(storeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // 购物车/门店变化时拉取报价（含整单满减），保证展示金额与后端结算一致
  useEffect(() => {
    if (!storeId || cart.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    posApi
      .quote({
        storeId,
        items: cart.map((it) => ({ skuId: it.skuId, quantity: it.quantity })),
      })
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, storeId]);

  const subtotal = useMemo(
    () => cart.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0),
    [cart],
  );

  const handleOpenSession = async () => {
    if (!storeId) return toast.error('请先选择门店');
    setSessionLoading(true);
    try {
      const res = await posApi.openSession({
        storeId,
        openAmount: Number(openAmount) || 0,
      });
      toast.success(res.existed ? '已存在未关班次，已为你打开' : '开班成功');
      await refreshSession(storeId);
    } catch (e: any) {
      toast.error(e?.message || '开班失败');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleCloseSession = async () => {
    if (!openSession) return;
    try {
      await posApi.closeSession(openSession.id as string, {
        closeAmount: Number(closeAmount) || 0,
      });
      toast.success('关班成功');
      setOpenSession(null);
    } catch (e: any) {
      toast.error(e?.message || '关班失败');
    }
  };

  const handleAddSku = async () => {
    const code = skuInput.trim();
    const qty = Number(qtyInput) || 1;
    if (!code) return toast.error('请输入SKU编码或SKU ID');
    if (!storeId) return toast.error('请先选择门店');
    setAdding(true);
    try {
      const resolved: ResolvedPrice = await pricingApi.resolve({
        skuCode: code,
        storeId,
      });
      if (!resolved.skuId) {
        toast.error('未找到该商品');
        return;
      }
      const item: CartItem = {
        key: `${resolved.skuId}-${Date.now()}`,
        skuId: resolved.skuId,
        skuCode: resolved.skuCode || code,
        styleNo: resolved.styleNo,
        quantity: qty,
        unitPrice: resolved.finalPrice,
        tagPrice: resolved.tagPrice,
        promotionName: resolved.appliedPromotion?.name,
      };
      setCart((prev) => [...prev, item]);
      setSkuInput('');
      setQtyInput('1');
    } catch (e: any) {
      toast.error(e?.message || '计价失败');
    } finally {
      setAdding(false);
    }
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) =>
          it.key === key ? { ...it, quantity: Math.max(1, it.quantity + delta) } : it,
        )
        .filter((it) => it.quantity > 0),
    );
  };

  const removeItem = (key: string) => {
    setCart((prev) => prev.filter((it) => it.key !== key));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return toast.error('购物车为空');
    if (!storeId) return toast.error('请先选择门店');
    // 应付金额以服务端报价为准（已含整单满减）；若顾客输入实收大于应付，则按实收（产生找零）
    const payable = quote?.payable ?? subtotal;
    const tendered = Number(payAmount) > payable ? Number(payAmount) : payable;
    setCheckingOut(true);
    try {
      const res = await posApi.checkout({
        storeId,
        sessionId: openSession?.id,
        items: cart.map((it) => ({ skuId: it.skuId, quantity: it.quantity })),
        payMethods: [
          {
            method: payMethod,
            amount: tendered.toFixed(2),
          },
        ],
        receivedAmount: tendered,
      });
      setLastOrderNo((res as any)?.retailNo || (res as any)?.orderNo || '');
      toast.success('收银成功');
      setCart([]);
      setPayAmount('');
      setQuote(null);
      await refreshSession(storeId);
    } catch (e: any) {
      toast.error(e?.message || '结算失败');
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" /> 门店收银台
        </h1>
      </div>

      {/* 门店与班次 */}
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-gray-50 p-3 rounded">
        <div>
          <label className="block text-xs text-gray-500 mb-1">门店</label>
          <select
            className="border rounded px-2 py-1.5 w-56"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {openSession ? (
          <div className="flex items-center gap-3">
            <div className="text-sm">
              <span className="text-green-600 font-medium">班次进行中</span>
              <div className="text-gray-500">
                开班备用金 ¥{Number(openSession.openAmount).toFixed(2)} ·{' '}
                {String(openSession.storeName)}
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">闭班实点现金</label>
                <input
                  className="border rounded px-2 py-1.5 w-32"
                  value={closeAmount}
                  onChange={(e) => setCloseAmount(e.target.value)}
                  type="number"
                />
              </div>
              <button
                className="flex items-center gap-1 bg-red-500 text-white px-3 py-1.5 rounded"
                onClick={handleCloseSession}
              >
                <LogOut className="w-4 h-4" /> 关班
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">开班备用金</label>
              <input
                className="border rounded px-2 py-1.5 w-32"
                value={openAmount}
                onChange={(e) => setOpenAmount(e.target.value)}
                type="number"
              />
            </div>
            <button
              className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded"
              onClick={handleOpenSession}
              disabled={sessionLoading}
            >
              <Power className="w-4 h-4" /> 开班
            </button>
          </div>
        )}
      </div>

      {lastOrderNo && (
        <div className="mb-3 p-2 bg-green-50 text-green-700 rounded text-sm">
          最近一笔交易单号：{lastOrderNo}
        </div>
      )}

      {/* 加购 */}
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">SKU编码 / SKU ID</label>
          <input
            className="border rounded px-2 py-1.5 w-64"
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            placeholder="扫码或输入"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSku();
            }}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">数量</label>
          <input
            className="border rounded px-2 py-1.5 w-20"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            type="number"
          />
        </div>
        <button
          className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded"
          onClick={handleAddSku}
          disabled={adding}
        >
          <Plus className="w-4 h-4" /> 加购
        </button>
      </div>

      {/* 购物车 */}
      <table className="w-full text-sm border rounded overflow-hidden mb-3">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left px-3 py-2">SKU</th>
            <th className="text-left px-3 py-2">款号</th>
            <th className="text-right px-3 py-2">吊牌价</th>
            <th className="text-right px-3 py-2">售价</th>
            <th className="text-center px-3 py-2">数量</th>
            <th className="text-right px-3 py-2">小计</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {cart.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-gray-400 py-6">
                暂无商品
              </td>
            </tr>
          )}
          {cart.map((it) => (
            <tr key={it.key} className="border-t">
              <td className="px-3 py-2">{it.skuCode}</td>
              <td className="px-3 py-2">{it.styleNo || '-'}</td>
              <td className="px-3 py-2 text-right">¥{it.tagPrice.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                ¥{it.unitPrice.toFixed(2)}
                {it.promotionName && (
                  <div className="text-xs text-orange-500">{it.promotionName}</div>
                )}
              </td>
              <td className="px-3 py-2 text-center">
                <button
                  className="px-2 text-gray-500"
                  onClick={() => changeQty(it.key, -1)}
                >
                  -
                </button>
                <span className="mx-2">{it.quantity}</span>
                <button
                  className="px-2 text-gray-500"
                  onClick={() => changeQty(it.key, 1)}
                >
                  +
                </button>
              </td>
              <td className="px-3 py-2 text-right">
                ¥{(it.unitPrice * it.quantity).toFixed(2)}
              </td>
              <td className="px-3 py-2 text-center">
                <button className="text-red-500" onClick={() => removeItem(it.key)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 结算 */}
      <div className="flex flex-wrap items-end justify-between gap-3 bg-gray-50 p-3 rounded">
        <div className="text-lg font-semibold space-y-1">
          <div>
            小计：<span className="text-gray-700">¥{(quote?.subtotal ?? subtotal).toFixed(2)}</span>
          </div>
          {quote && quote.discountAmount > 0 && (
            <div className="text-sm text-orange-600">
              满减优惠（{quote.orderPromotion?.name || '促销'}）：-¥{quote.discountAmount.toFixed(2)}
            </div>
          )}
          <div>
            应付：
            <span className="text-red-600 text-xl">
              ¥{(quote?.payable ?? subtotal).toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">支付方式</label>
            <select
              className="border rounded px-2 py-1.5 w-32"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
            >
              {PAY_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">实收金额</label>
            <input
              className="border rounded px-2 py-1.5 w-32"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              type="number"
              placeholder={subtotal.toFixed(2)}
            />
          </div>
          <button
            className="bg-red-500 text-white px-5 py-1.5 rounded font-medium"
            onClick={handleCheckout}
            disabled={checkingOut || cart.length === 0}
          >
            结算收款
          </button>
        </div>
      </div>
    </div>
  );
}
