import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ShoppingCart } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { useOffline } from '@client/src/contexts/OfflineContext';
import { convertStockMatrixResult } from './pos-stock-utils';
import { buildOfflineSaleOrder } from './pos-offline-order-helper';
import SkuMatrix from './SkuMatrix';
import CartPanel from './CartPanel';
import PaymentDialog from './PaymentDialog';
import ReceiptDialog from './ReceiptDialog';
import MemberDialog from './MemberDialog';
import { EmployeeDialog, SuspendDialog } from './PosDialogs';
import PosSidebar from './PosSidebar';
import PosHeader from './PosHeader';
import * as membersApi from '@client/src/api/members';
import * as promotionsApi from '@client/src/api/promotions';
import * as salesApi from '@client/src/api/sales';
import * as erpIntegration from '@client/src/api/erp-integration';
import * as masterData from '@client/src/api/master-data';
import type {
  Style,
  StockMatrix,
  Member,
  Employee,
  SaleItem,
  SaleOrder,
  PromotionDiscountDetail,
  SuspendedOrder,
  ErpConnectionStatus,
} from '@shared/api.interface';
import { STORE_ID, STORE_NAME } from '@client/src/lib/store';
import {
  readPersistedCart,
  writePersistedCart,
  clearPersistedCart,
} from './pos-cart-persist';
import { useCurrentShift } from '@client/src/hooks/useCurrentShift';

export default function PosPage() {
  const [orderNo, setOrderNo] = useState<string>('待开单');
  const [networkStatus, setNetworkStatus] = useState<ErpConnectionStatus | null>(null);
  const [hotStyles, setHotStyles] = useState<Style[]>([]);

  // 离线状态
  const offline = useOffline();
  const isOffline = offline.effectivelyOffline;

  // F-5：当前班次。每笔交易必须归属到一个已开班的班次，
  // 否则班次的销售额/现金/退款统计恒为 0，长短款机制将完全失效。
  const {
    shiftId: currentShiftId,
    loading: shiftLoading,
    error: shiftError,
  } = useCurrentShift(STORE_ID, !isOffline);

  // 矩阵
  const [stockMatrix, setStockMatrix] = useState<StockMatrix | null>(null);
  const [currentStyle, setCurrentStyle] = useState<Style | null>(null);

  // 购物车（刷新后自动恢复，避免重新扫码）
  const [cart, setCart] = useState<SaleItem[]>(() => readPersistedCart()?.cart ?? []);
  const [discounts, setDiscounts] = useState<PromotionDiscountDetail[]>([]);
  const [totalDiscount, setTotalDiscount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 促销计算签名：仅当 "skuId:qty" 组合变化时才重新计算，避免回填行级折扣触发 setCart 导致的死循环
  const promoLastSig = useRef<string>('');

  // 会员 / 导购
  const [member, setMember] = useState<Member | null>(() => readPersistedCart()?.member ?? null);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);

  // 挂单 / 结算
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<SaleOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totals = useMemo(() => {
    const totalQty = cart.reduce((s: number, i: SaleItem) => s + i.qty, 0);
    const totalTagAmount = cart.reduce(
      (s: number, i: SaleItem) => s + i.tagPrice * i.qty,
      0,
    );
    return {
      totalQty,
      totalTagAmount,
      payAmount: Math.max(0, totalTagAmount - totalDiscount),
    };
  }, [cart, totalDiscount]);

  // 初始化
  useEffect(() => {
    erpIntegration
      .getStatus()
      .then((s) => setNetworkStatus(s))
      .catch((e) => logger.error('get erp status failed', e as Error));
    // 离线模式下从本地缓存取热销款；在线走 API
    if (isOffline) {
      const styles = offline.masterData.styles?.slice(0, 4) ?? [];
      setHotStyles(styles as unknown as Style[]);
    } else {
      masterData
        .getStyles({ status: 'active', page: 1, pageSize: 4 })
        .then((res) => setHotStyles(res.items ?? []))
        .catch((e) => logger.error('get hot styles failed', e as Error));
    }
  }, [isOffline]);

  // 促销计算：在线走服务端 API，离线走本地引擎
  useEffect(() => {
    if (cart.length === 0) {
      setDiscounts([]);
      setTotalDiscount(0);
      promoLastSig.current = '';
      return;
    }
    // 仅当购物车"商品+数量"组合变化时才重算；行级折扣回填改变的是 unitPrice，
    // 不影响签名，从而打断"setCart → effect → 再 calcPromotion → 再 setCart"的死循环。
    const sig = cart.map((i) => `${i.skuId}:${i.qty}`).join('|');
    if (sig === promoLastSig.current) return;
    promoLastSig.current = sig;

    // 离线模式：使用本地促销引擎（字段已在主数据快照中正确映射）
    if (isOffline) {
      try {
        const res = offline.calculatePromotions(
          cart.map((i) => ({
            skuId: i.skuId,
            styleId: i.styleId,
            qty: i.qty,
            unitPrice: i.tagPrice,
          })),
          { isMember: !!member },
        );
        setDiscounts(
          res.applicablePromotions.map((p) => ({
            promotionId: p.promotionId,
            promotionName: p.promotionName,
            promotionType: 'offline',
            discountAmount: p.discountAmount,
            applyToItems: [],
          })),
        );
        setTotalDiscount(res.totalDiscount);
        // 离线促销按行金额占比摊分回填，保证 lineAmount 与总额一致
        if (res.totalDiscount > 0) {
          const totalTag = cart.reduce((s, i) => s + i.tagPrice * i.qty, 0);
          setCart((prev) =>
            prev.map((item) => {
              const lineTag = item.tagPrice * item.qty;
              const disc =
                totalTag > 0
                  ? Math.round((lineTag / totalTag) * res.totalDiscount * 100) / 100
                  : 0;
              return {
                ...item,
                unitPrice: Math.max(0, item.tagPrice - disc / item.qty),
                discountAmount: disc,
                lineAmount: item.tagPrice * item.qty - disc,
              };
            }),
          );
        }
      } catch (err) {
        logger.error('offline calculate promotion failed', err as Error);
      }
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void calcPromotion();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, member, isOffline]);

  const calcPromotion = async () => {
    try {
      const result = await promotionsApi.calculatePromotions({
        storeId: STORE_ID,
        items: cart.map((i: SaleItem) => ({
          skuId: i.skuId,
          styleId: i.styleId,
          styleName: i.styleName,
          colorId: i.colorId,
          sizeId: i.sizeId,
          qty: i.qty,
          tagPrice: i.tagPrice,
          unitPrice: i.tagPrice,
          lineAmount: i.tagPrice * i.qty,
        })),
        memberId: member?.id,
        memberLevel: member?.level,
        totalAmount: totals.totalTagAmount,
      });
      setDiscounts(result.discounts);
      setTotalDiscount(result.totalDiscount);
      // 回填行级折扣
      if (result.discounts.length > 0) {
        const itemDiscMap = new Map<string, number>();
        for (const d of result.discounts) {
          if (d.applyToItems) {
            for (const ai of d.applyToItems) {
              itemDiscMap.set(
                ai.skuId,
                (itemDiscMap.get(ai.skuId) || 0) + ai.discountAmount,
              );
            }
          }
        }
        setCart((prev) =>
          prev.map((item: SaleItem) => {
            const disc = itemDiscMap.get(item.skuId) || 0;
            const unitDisc = disc / item.qty;
            return {
              ...item,
              unitPrice: item.tagPrice - unitDisc,
              discountAmount: disc,
              lineAmount: item.tagPrice * item.qty - disc,
            };
          }),
        );
      }
    } catch (err) {
      logger.error('calculate promotion failed', err as Error);
    }
  };

  // 选款（来自侧栏）
  const handleSelectStyle = (style: Style, matrix: StockMatrix) => {
    setCurrentStyle(style);
    setStockMatrix(matrix);
  };

  // 离线模式下选款（用本地库存矩阵）
  const handleSelectStyleOffline = useCallback((style: Style) => {
    const result = offline.getStockForStyle(style.id);
    if (!result) return;
    setCurrentStyle(style);
    setStockMatrix(convertStockMatrixResult(result));
  }, [offline]);

  // 扫码命中 SKU 直接加购 1 件（P1-6：避免"扫完还要再点格子"）
  const handleScanAddSku = useCallback(
    (sku: { id: string; styleId: string; colorId: string; sizeId: string }) => {
      const allStyles = offline.masterData.styles ?? [];
      const style = allStyles.find((s) => s.id === sku.styleId);
      const styleName = style?.name ?? sku.styleId;
      const tagPrice = style?.tagPrice ?? 0;
      const skuId = sku.id;
      setCart((prev) => {
        const existing = prev.find((i) => i.skuId === skuId);
        if (existing) {
          return prev.map((item) =>
            item.id === existing.id
              ? {
                  ...item,
                  qty: item.qty + 1,
                  lineAmount: item.unitPrice * (item.qty + 1),
                  discountAmount:
                    (item.tagPrice - item.unitPrice) * (item.qty + 1),
                }
              : item,
          );
        }
        return [
          ...prev,
          {
            id: skuId,
            skuId,
            styleId: sku.styleId,
            styleName,
            colorId: sku.colorId,
            sizeId: sku.sizeId,
            qty: 1,
            tagPrice,
            unitPrice: tagPrice,
            discountAmount: 0,
            lineAmount: tagPrice,
          },
        ];
      });
      toast.success(`已扫码加入：${styleName} ${sku.colorId}/${sku.sizeId}`);
    },
    [offline.masterData.styles],
  );

  // 加购
  const handleAddToCart = (params: {
    colorId: string;
    colorName: string;
    sizeId: string;
    qty: number;
  }) => {
    if (!currentStyle) return;
    const { colorId, sizeId, qty } = params;
    const skuId = `${currentStyle.id}-${colorId}-${sizeId}`;
    setCart((prev) => {
      const existing = prev.find(
        (i: SaleItem) =>
          i.styleId === currentStyle.id &&
          i.colorId === colorId &&
          i.sizeId === sizeId,
      );
      if (existing) {
        return prev.map((item: SaleItem) =>
          item.id === existing.id
            ? {
                ...item,
                qty: item.qty + qty,
                lineAmount: item.unitPrice * (item.qty + qty),
                discountAmount:
                  (item.tagPrice - item.unitPrice) * (item.qty + qty),
              }
            : item,
        );
      }
      return [
        ...prev,
        {
          id: skuId,
          skuId,
          styleId: currentStyle.id,
          styleName: currentStyle.name,
          colorId,
          sizeId,
          qty,
          tagPrice: currentStyle.tagPrice,
          unitPrice: currentStyle.tagPrice,
          discountAmount: 0,
          lineAmount: currentStyle.tagPrice * qty,
        },
      ];
    });
  };

  // 购物车操作
  const handleUpdateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item: SaleItem) => {
          if (item.id !== id) return item;
          const newQty = Math.max(1, item.qty + delta);
          return {
            ...item,
            qty: newQty,
            lineAmount: item.unitPrice * newQty,
            discountAmount: (item.tagPrice - item.unitPrice) * newQty,
          };
        })
        .filter((item: SaleItem) => item.qty > 0),
    );
  };

  const handleRemoveItem = (id: string) => {
    setCart((prev) => prev.filter((i: SaleItem) => i.id !== id));
  };

  const handleClearCart = () => {
    setCart([]);
    setDiscounts([]);
    setTotalDiscount(0);
    clearPersistedCart();
  };

  // 购物车/会员变化时落盘，刷新后可恢复（订单提交成功会走 handleClearCart 清空）
  useEffect(() => {
    writePersistedCart(cart, member);
  }, [cart, member]);

  // 结算
  const handleCheckout = () => {
    if (cart.length === 0) return;
    setPaymentOpen(true);
  };

  const handleConfirmPayment = async (
    payments: { payMethod: string; amount: number; changeAmount: number }[],
    roundingAmount: number = 0,
  ) => {
    if (submitting) return;

    // F-5：在线模式下必须归属到已开班班次，未开班不允许交易
    if (!isOffline && !currentShiftId) {
      toast.error('尚未开班，无法完成交易', {
        description: shiftError
          ? `班次信息不可用：${shiftError}`
          : '请先在「交接班」页面开班后再开始收银',
      });
      return;
    }

    setSubmitting(true);
    try {
      // P0-1：积分抵扣换算（100 分 = 1 元），必须显式下发，服务端据此核销会员积分
      const pointsPayYuan = payments
        .filter((p) => p.payMethod === 'points')
        .reduce((sum, p) => sum + p.amount, 0);
      const pointsUsed = Math.round(pointsPayYuan * 100);
      if (isOffline) {
        const orderData = {
          cart,
          payments,
          discounts,
          member,
          employee,
          totalTagAmount: totals.totalTagAmount,
          totalDiscount,
          payAmount: totals.payAmount,
          totalQty: totals.totalQty,
          // 同步到服务端时需要这两个字段才能复现正确的应付金额
          pointsUsed,
          roundingAmount,
          // F-5：离线单也需要班次归属（取自本地缓存），否则同步后班次统计仍会缺失
          shiftId: currentShiftId ?? undefined,
        };
        const clientId = await offline.createOfflineOrder({
          ...orderData,
          storeId: STORE_ID,
          memberId: member?.id,
          employeeId: employee?.id,
        });
        const order = buildOfflineSaleOrder(orderData, clientId);

        // 离线会员余额本地变动（储值/积分扣减，累计消费和积分增加）
        if (member) {
          const svAmt = payments.find((p) => p.payMethod === 'stored_value')?.amount ?? 0;
          const ptAmt = payments.find((p) => p.payMethod === 'points')?.amount ?? 0;
          const earned = Math.floor(totals.payAmount);
          setMember({
            ...member,
            storedValue: Math.max(0, Number(member.storedValue) - svAmt),
            points: Math.max(0, member.points - Math.floor(ptAmt * 100) + earned),
            totalSpent: Number(member.totalSpent) + totals.payAmount,
            totalCount: member.totalCount + 1,
            lastPurchaseAt: new Date().toISOString(),
          });
        }

        setCurrentOrder(order);
        setPaymentOpen(false);
        setReceiptOpen(true);
        toast.success('离线交易已暂存，待联网后自动同步', {
          description: `单号：${clientId}`,
        });
      } else {
        const order = await salesApi.createOrder({
          storeId: STORE_ID,
          memberId: member?.id,
          employeeId: employee?.id,
          items: cart,
          payments: payments.map((p) => ({
            payMethod: p.payMethod,
            amount: p.amount,
            changeAmount: p.changeAmount,
          })),
          discounts: discounts.map((d) => ({
            promotionId: d.promotionId,
            name: d.promotionName,
            type: d.promotionType,
            amount: d.discountAmount,
          })),
          // P0-1：积分核销依据（服务端据此扣减会员积分）
          pointsUsed,
          // P2-3：抹零金额随单上报，服务端据此计算应付金额
          roundingAmount,
          // F-5：所属班次，缺失会导致班次销售额/现金统计恒为 0
          shiftId: currentShiftId ?? undefined,
        });
        setCurrentOrder(order);
        setPaymentOpen(false);
        setReceiptOpen(true);
        if (member) {
          membersApi
            .getMemberById(member.id)
            .then((m) => setMember(m))
            .catch(() => undefined);
        }
      }
    } catch (err) {
      logger.error('create order failed', err as Error);
      const msg = err instanceof Error ? err.message : '下单失败';
      toast.error(msg, {
        description: isOffline ? '请检查库存后重试' : '请稍后重试',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // P2-5：生成真实格式的本地单号（与服务端 XS+日期+时间+随机 结构一致）
  const genLocalOrderNo = useCallback((): string => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const d = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
    return `XS${d}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${String(
      Math.floor(Math.random() * 90) + 10,
    )}`;
  }, []);

  const handleReceiptDone = () => {
    setReceiptOpen(false);
    setCurrentOrder(null);
    handleClearCart();
    setOrderNo(genLocalOrderNo());
    setMember(null);
    setEmployee(null);
  };

  // 开单（购物车由空变非空）即生成单号，收银台不再一直显示「待开单」
  useEffect(() => {
    if (cart.length > 0 && (orderNo === '待开单' || !orderNo)) {
      setOrderNo(genLocalOrderNo());
    }
  }, [cart.length, orderNo, genLocalOrderNo]);

  // 挂单
  const handleSuspend = async () => {
    if (cart.length === 0) return;
    try {
      if (isOffline) {
        const suspendData = {
          cart,
          memberId: member?.id,
          employeeId: employee?.id,
          totalTagAmount: totals.totalTagAmount,
          payAmount: totals.payAmount,
          totalQty: totals.totalQty,
          storeId: STORE_ID,
        };
        const tempNo = await offline.createOfflineSuspended(suspendData);
        handleClearCart();
        setMember(null);
        setEmployee(null);
        toast.success('离线挂单已暂存', {
          description: `单号：${tempNo}`,
        });
      } else {
        await salesApi.suspendOrder({
          storeId: STORE_ID,
          memberId: member?.id,
          employeeId: employee?.id,
          items: cart,
          totalAmount: totals.payAmount,
        });
        handleClearCart();
        setMember(null);
        setEmployee(null);
      }
    } catch (err) {
      logger.error('suspend order failed', err as Error);
    }
  };

  const handleRestoreSuspended = (order: SuspendedOrder) => {
    setCart(order.items ?? []);
    if (order.memberId) {
      membersApi
        .getMemberById(order.memberId)
        .then((m) => setMember(m))
        .catch(() => setMember(null));
    }
  };

  // P2-2：键盘快捷键，提升收银台操作效率
  useEffect(() => {
    const dialogOpen =
      paymentOpen || receiptOpen || memberDialogOpen || suspendDialogOpen || employeeDialogOpen;

    const onKeyDown = (e: KeyboardEvent): void => {
      // 弹窗打开 / 焦点在输入框时不响应，避免误触
      if (dialogOpen) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (isEditable) return;

      switch (e.key) {
        case 'F2': // 会员
          e.preventDefault();
          setMemberDialogOpen(true);
          break;
        case 'F3': // 挂单
          e.preventDefault();
          if (cart.length > 0) void handleSuspend();
          break;
        case 'F4': // 结算
          e.preventDefault();
          handleCheckout();
          break;
        case 'Escape': // 清空购物车
          if (cart.length > 0 && window.confirm('确认清空当前购物车？')) {
            handleClearCart();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    paymentOpen,
    receiptOpen,
    memberDialogOpen,
    suspendDialogOpen,
    employeeDialogOpen,
    cart.length,
    handleSuspend,
    handleCheckout,
  ]);

  // 网络状态：优先用 OfflineContext，降级用 ERP 连接状态
  const isOnline = !offline.effectivelyOffline && networkStatus?.mode !== 'offline';
  const localStyleCount = offline.masterData.styles?.length ?? 0;

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <PosHeader
        orderNo={orderNo}
        isOnline={isOnline}
        hasItems={cart.length > 0}
        offlinePendingCount={offline.pendingCount}
        onSuspend={handleSuspend}
        onOpenSuspendDialog={() => setSuspendDialogOpen(true)}
      />

      {/* 快捷键提示（配合 P2-2 键盘快捷键） */}
      <div className="px-4 py-1 bg-white border-b border-pos-line text-[10px] text-pos-ink-3 flex items-center gap-3 flex-shrink-0">
        <span>快捷键：</span>
        <span><kbd className="px-1 border border-pos-line rounded">F2</kbd> 会员</span>
        <span><kbd className="px-1 border border-pos-line rounded">F3</kbd> 挂单</span>
        <span><kbd className="px-1 border border-pos-line rounded">F4</kbd> 结算</span>
        <span><kbd className="px-1 border border-pos-line rounded">Esc</kbd> 清空</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <PosSidebar
          hotStyles={isOffline ? ((offline.masterData.styles?.slice(0, 4) ?? []) as unknown as Style[]) : hotStyles}
          member={member}
          employee={employee}
          isOffline={isOffline}
          localStyleCount={localStyleCount}
          onOpenMember={() => setMemberDialogOpen(true)}
          onClearMember={() => setMember(null)}
          onOpenEmployee={() => setEmployeeDialogOpen(true)}
          onClearEmployee={() => setEmployee(null)}
          onSelectStyle={isOffline ? handleSelectStyleOffline : handleSelectStyle}
          onSearchLocal={offline.searchStyles as unknown as (kw: string) => Style[]}
          onScanAdd={handleScanAddSku}
        />

        {/* 中栏 */}
        {stockMatrix && currentStyle ? (
          <SkuMatrix
            matrix={stockMatrix}
            styleTagPrice={currentStyle.tagPrice}
            isOffline={isOffline}
            onClose={() => {
              setStockMatrix(null);
              setCurrentStyle(null);
            }}
            onAddToCart={handleAddToCart}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-pos-ink-3">
            <div className="text-center">
              <ShoppingCart size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">扫码或搜索商品开始收银</p>
            </div>
          </div>
        )}

        {/* 右栏 */}
        <CartPanel
          items={cart}
          totalQty={totals.totalQty}
          totalTagAmount={totals.totalTagAmount}
          totalDiscount={totalDiscount}
          payAmount={totals.payAmount}
          discounts={discounts}
          isOffline={isOffline}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
          onClear={handleClearCart}
          onCheckout={handleCheckout}
          onSuspend={handleSuspend}
        />
      </div>

      <MemberDialog
        open={memberDialogOpen}
        onOpenChange={setMemberDialogOpen}
        onSelect={setMember}
      />
      <EmployeeDialog
        open={employeeDialogOpen}
        onOpenChange={setEmployeeDialogOpen}
        onSelect={setEmployee}
      />
      <SuspendDialog
        open={suspendDialogOpen}
        onOpenChange={setSuspendDialogOpen}
        onRestore={handleRestoreSuspended}
        isOffline={isOffline}
      />
      <PaymentDialog
        open={paymentOpen}
        onClose={() => !submitting && setPaymentOpen(false)}
        onConfirm={handleConfirmPayment}
        payAmount={totals.payAmount}
        member={member}
        employee={employee}
        items={cart}
        isOffline={isOffline}
      />
      <ReceiptDialog
        open={receiptOpen}
        order={currentOrder}
        storeName={STORE_NAME}
        isOffline={isOffline}
        tempOrderNo={currentOrder?.orderNo}
        onClose={() => undefined}
        onDone={handleReceiptDone}
      />
    </div>
  );
}
