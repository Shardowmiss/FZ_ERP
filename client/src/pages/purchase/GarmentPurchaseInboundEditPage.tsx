import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseInbound, GarmentPurchaseOrder, Sku } from '@shared/api.interface';
import GarmentSkuMatrixTable, { type SkuQtyPriceMatrix, type MatrixMode } from './GarmentSkuMatrixTable';
import DocPage from '@client/src/components/DocPage/DocPage';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

interface StyleBlock {
  styleId: string;
  styleNo: string;
  styleName: string;
  skuList: Sku[];
  qtyPriceMatrix: SkuQtyPriceMatrix;
  orderSkuIdMap: Record<string, Record<string, string>>;
}

const BACK_PATH = '/purchase/garment-inbound';

type PageMode = 'new' | 'edit' | 'accept' | 'view';

const GarmentPurchaseInboundEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [formOrderId, setFormOrderId] = useState<string>('');
  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formInboundDate, setFormInboundDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [styleBlocks, setStyleBlocks] = useState<StyleBlock[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const [warehouseOptions, setWarehouseOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [approvedOrders, setApprovedOrders] = useState<GarmentPurchaseOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState<boolean>(false);

  const [inboundNo, setInboundNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // 扫码录入状态
  const [scanCode, setScanCode] = useState<string>('');

  const pageMode: PageMode = viewOnly
    ? 'view'
    : isNew
      ? 'new'
      : status === 'draft'
        ? 'edit'
        : status === 'approved'
          ? 'accept'
          : 'view';
  const matrixMode: MatrixMode = pageMode === 'new' ? 'edit' : pageMode;
  const showSave = !viewOnly && (isNew || status === 'draft');
  const headerDisabled = viewOnly || pageMode === 'accept' || pageMode === 'view';

  // Load options
  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [w] = await Promise.all([
          baseApi.warehouse.options(),
        ]);
        setWarehouseOptions(w);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  // Load approved orders for new mode
  useEffect(() => {
    if (isNew) {
      const loadOrders = async (): Promise<void> => {
        setLoadingOrders(true);
        try {
          const res = await garmentPurchaseApi.order.list({
            page: 1,
            pageSize: 100,
            status: 'approved',
          });
          setApprovedOrders(res.items);
        } catch (e) {
          toast(errMsg(e, '加载采购单失败'));
        } finally {
          setLoadingOrders(false);
        }
      };
      setFormInboundDate(new Date().toISOString().slice(0, 10));
      loadOrders();
      return;
    }
    // Load detail
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const inbound: GarmentPurchaseInbound = await garmentPurchaseApi.inbound.get(id);
        setInboundNo(inbound.inboundNo);
        setStatus(inbound.status);
        setFormOrderId(inbound.orderId);
        setFormWarehouseId(inbound.warehouseId);
        setFormInboundDate(inbound.inboundDate.slice(0, 10));
        setFormRemark(inbound.remark ?? '');
        const blocks = await buildStyleBlocksFromSkus(inbound.skus ?? []);
        setStyleBlocks(blocks);
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const buildStyleBlocksFromSkus = async (
    skus: {
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
      id?: string;
      acceptedQty?: number;
    }[],
  ): Promise<StyleBlock[]> => {
    const styleIds: string[] = Array.from(new Set(skus.map((s) => s.styleId)));
    const blocks: StyleBlock[] = [];
    for (const styleId of styleIds) {
      try {
        const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
        const styleSkusFromDoc = skus.filter((s) => s.styleId === styleId);
        const matrix: SkuQtyPriceMatrix = {};
        const orderSkuIdMap: Record<string, Record<string, string>> = {};
        for (const sku of styleSkus) {
          if (!matrix[sku.color]) matrix[sku.color] = {};
          if (!orderSkuIdMap[sku.color]) orderSkuIdMap[sku.color] = {};
          const existing = styleSkusFromDoc.find((s) => s.skuId === sku.id);
          matrix[sku.color][sku.size] = {
            qty: existing?.quantity || 0,
            price: existing?.price || 0,
            acceptedQty: existing?.acceptedQty || 0,
          };
          orderSkuIdMap[sku.color][sku.size] = existing?.id || '';
        }
        blocks.push({
          styleId,
          styleNo: styleSkusFromDoc[0]?.styleNo || '',
          styleName: '',
          skuList: styleSkus,
          qtyPriceMatrix: matrix,
          orderSkuIdMap,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const buildFromOrderSkus = async (
    skus: {
      id: string;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
      receivedQty: number;
    }[],
  ): Promise<StyleBlock[]> => {
    const styleIds: string[] = Array.from(new Set(skus.map((s) => s.styleId)));
    const blocks: StyleBlock[] = [];
    for (const styleId of styleIds) {
      try {
        const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
        const orderStyleSkus = skus.filter((s) => s.styleId === styleId);
        const matrix: SkuQtyPriceMatrix = {};
        const orderSkuIdMap: Record<string, Record<string, string>> = {};
        for (const sku of styleSkus) {
          if (!matrix[sku.color]) matrix[sku.color] = {};
          if (!orderSkuIdMap[sku.color]) orderSkuIdMap[sku.color] = {};
          const existing = orderStyleSkus.find((s) => s.skuId === sku.id);
          const remaining = existing
            ? Math.max(0, existing.quantity - existing.receivedQty)
            : 0;
          matrix[sku.color][sku.size] = {
            qty: remaining,
            price: existing?.price || 0,
            acceptedQty: 0,
          };
          orderSkuIdMap[sku.color][sku.size] = existing?.id || '';
        }
        blocks.push({
          styleId,
          styleNo: orderStyleSkus[0]?.styleNo || '',
          styleName: '',
          skuList: styleSkus,
          qtyPriceMatrix: matrix,
          orderSkuIdMap,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const handleOrderChange = async (orderId: string): Promise<void> => {
    setFormOrderId(orderId);
    if (!orderId) {
      setStyleBlocks([]);
      return;
    }
    try {
      const order = await garmentPurchaseApi.order.get(orderId);
      const blocks = await buildFromOrderSkus(order.skus ?? []);
      setStyleBlocks(blocks);
    } catch (e) {
      toast(errMsg(e, '加载订单明细失败'));
    }
  };

  const handleMatrixChange = (
    styleId: string,
    color: string,
    size: string,
    field: 'qty' | 'acceptedQty',
    value: number,
  ): void => {
    setStyleBlocks((prev) =>
      prev.map((b: StyleBlock) => {
        if (b.styleId !== styleId) return b;
        const colorObj = b.qtyPriceMatrix[color] || {};
        const existing = colorObj[size] || { qty: 0, price: 0, acceptedQty: 0 };
        const updated =
          field === 'acceptedQty'
            ? { ...existing, acceptedQty: value }
            : { ...existing, qty: value };
        return {
          ...b,
          qtyPriceMatrix: {
            ...b.qtyPriceMatrix,
            [color]: { ...colorObj, [size]: updated },
          },
        };
      }),
    );
  };

  const buildSkus = (): {
    orderSkuId: string;
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
  }[] => {
    const result: {
      orderSkuId: string;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
    }[] = [];
    for (const block of styleBlocks) {
      for (const sku of block.skuList) {
        const cell = block.qtyPriceMatrix[sku.color]?.[sku.size];
        const qty = cell?.qty || 0;
        const price = cell?.price || 0;
        const orderSkuId = block.orderSkuIdMap[sku.color]?.[sku.size] || '';
        if (qty > 0) {
          result.push({
            orderSkuId,
            styleId: block.styleId,
            styleNo: block.styleNo,
            skuId: sku.id,
            color: sku.color,
            size: sku.size,
            quantity: qty,
            price,
          });
        }
      }
    }
    return result;
  };

  // 验收明细：返回各单元格累计验收数量（按入库单明细 id）
  const buildAcceptItems = (): { id: string; acceptedQty: number }[] => {
    const result: { id: string; acceptedQty: number }[] = [];
    for (const block of styleBlocks) {
      for (const sku of block.skuList) {
        const cell = block.qtyPriceMatrix[sku.color]?.[sku.size];
        const sid = block.orderSkuIdMap[sku.color]?.[sku.size] || '';
        if (!sid) continue;
        result.push({ id: sid, acceptedQty: cell?.acceptedQty || 0 });
      }
    }
    return result;
  };

  const validateForm = (): boolean => {
    if (isNew && !formOrderId) {
      toast('请选择采购订单');
      return false;
    }
    if (!formWarehouseId) {
      toast('请选择仓库');
      return false;
    }
    if (!formInboundDate) {
      toast('请选择入库日期');
      return false;
    }
    const skus = buildSkus();
    if (skus.length === 0) {
      toast('请填写入库数量');
      return false;
    }
    return true;
  };

  const handleSave = async (): Promise<void> => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      if (isNew) {
        const skus = buildSkus();
        const warehouse = warehouseOptions.find((w) => w.id === formWarehouseId);
        await garmentPurchaseApi.inbound.create({
          orderId: formOrderId,
          warehouseId: formWarehouseId,
          warehouseName: warehouse?.name || '',
          inboundDate: formInboundDate,
          remark: formRemark || undefined,
          skus,
        });
      } else {
        const skus = buildSkus().map((s) => ({ ...s, orderSkuId: s.orderSkuId || undefined }));
        const warehouse = warehouseOptions.find((w) => w.id === formWarehouseId);
        await garmentPurchaseApi.inbound.update(id!, {
          warehouseId: formWarehouseId,
          warehouseName: warehouse?.name || '',
          inboundDate: formInboundDate,
          remark: formRemark || undefined,
          skus,
        });
      }
      toast('保存成功');
      navigate(BACK_PATH);
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  // 扫码录入：解析条码 → 命中本单明细 → 验收数量 +1（超量弹确认）
  const inboundSkuCellMap = useMemo(() => {
    const map: Record<string, { styleId: string; color: string; size: string }> = {};
    for (const b of styleBlocks) {
      for (const sku of b.skuList) {
        const sid = b.orderSkuIdMap[sku.color]?.[sku.size] || '';
        if (sid) map[sid] = { styleId: b.styleId, color: sku.color, size: sku.size };
      }
    }
    return map;
  }, [styleBlocks]);

  const handleScan = async (): Promise<void> => {
    const code = scanCode.trim();
    if (!code || !id) return;
    try {
      const res = await garmentPurchaseApi.inbound.resolveBarcode(id, code);
      if (!res.found || !res.inboundSkuId) {
        toast.error(res.message || '该商品不存在');
        setScanCode('');
        return;
      }
      const cellInfo = inboundSkuCellMap[res.inboundSkuId];
      if (!cellInfo) {
        toast.error('该商品不存在');
        setScanCode('');
        return;
      }
      const { styleId, color, size } = cellInfo;
      const block = styleBlocks.find((b) => b.styleId === styleId);
      const cell = block?.qtyPriceMatrix[color]?.[size];
      const current = cell?.acceptedQty || 0;
      const planned = res.plannedQty ?? cell?.qty ?? 0;
      const next = current + 1;
      if (next > planned) {
        const ok = window.confirm(
          `验收数量 ${next} 超出本单计划数量 ${planned}，是否继续录入？`,
        );
        if (!ok) {
          setScanCode('');
          return;
        }
      }
      setStyleBlocks((prev) =>
        prev.map((b) => {
          if (b.styleId !== styleId) return b;
          const colorObj = b.qtyPriceMatrix[color] || {};
          const existing = colorObj[size] || { qty: 0, price: 0, acceptedQty: 0 };
          return {
            ...b,
            qtyPriceMatrix: {
              ...b.qtyPriceMatrix,
              [color]: { ...colorObj, [size]: { ...existing, acceptedQty: next } },
            },
          };
        }),
      );
      setScanCode('');
    } catch (e) {
      toast(errMsg(e, '扫码解析失败'));
    }
  };

  const handleSaveAcceptance = async (): Promise<void> => {
    if (!id) return;
    const items = buildAcceptItems();
    if (items.length === 0) {
      toast('无验收明细');
      return;
    }
    setSaving(true);
    try {
      await garmentPurchaseApi.inbound.saveAcceptance(id, { skus: items });
      toast('验收进度已保存');
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteAcceptance = async (): Promise<void> => {
    if (!id) return;
    setSaving(true);
    try {
      await garmentPurchaseApi.inbound.completeAcceptance(id);
      toast('完成验收');
      navigate(BACK_PATH);
    } catch (e) {
      toast(errMsg(e, '完成验收失败'));
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalAmount = 0;
    for (const block of styleBlocks) {
      for (const color of Object.keys(block.qtyPriceMatrix)) {
        for (const size of Object.keys(block.qtyPriceMatrix[color])) {
          const cell = block.qtyPriceMatrix[color][size];
          totalQty += cell?.qty || 0;
          totalAmount += (cell?.qty || 0) * (cell?.price || 0);
        }
      }
    }
    return { totalQty, totalAmount };
  }, [styleBlocks]);

  const isLoading = isNew && loadingOrders;

  const headerForm = (
    <div className="grid grid-cols-4 gap-4">
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          采购订单<span className="text-red-500">*</span>
        </label>
        <select
          value={formOrderId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            void handleOrderChange(e.target.value);
          }}
          disabled={viewOnly || !isNew}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">请选择</option>
          {approvedOrders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orderNo} - {o.supplierName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          仓库<span className="text-red-500">*</span>
        </label>
        <select
          value={formWarehouseId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setFormWarehouseId(e.target.value)
          }
          disabled={headerDisabled}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">请选择</option>
          {warehouseOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} - {w.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          入库日期<span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={formInboundDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormInboundDate(e.target.value)
          }
          disabled={headerDisabled}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">备注</label>
        <input
          type="text"
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormRemark(e.target.value)
          }
          disabled={headerDisabled}
          placeholder="请输入备注"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
    </div>
  );

  const scanBar = pageMode === 'accept' && (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={scanCode}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScanCode(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleScan();
          }
        }}
        placeholder="扫描条形码录入验收数量（回车）"
        className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
      />
      <Button size="sm" variant="outline" onClick={() => void handleScan()}>
        解析
      </Button>
    </div>
  );

  const detailContent = (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-700">明细</h2>

      {pageMode === 'accept' && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
          验收模式：扫描条形码自动识别款式/颜色/尺码并在对应「验收数量」+1；不在本单内将提示「该商品不存在」，超出计划数量将询问是否继续。
        </div>
      )}

      {scanBar}

      {styleBlocks.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-300 rounded">
          {viewOnly ? '暂无款号数据' : '请选择采购订单'}
        </div>
      )}

      {styleBlocks.map((block: StyleBlock) => (
        <div
          key={block.styleId}
          className="border border-gray-200 rounded-lg overflow-hidden"
        >
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800">
                {block.styleNo}
              </span>
              <span className="text-gray-500 text-sm">{block.styleName}</span>
              <span className="text-xs text-gray-500 ml-auto">
                {pageMode === 'accept' ? '验收数量可录入' : '单价从采购单带入，不可修改'}
              </span>
            </div>
          </div>
          <div className="p-3">
            <GarmentSkuMatrixTable
              skuList={block.skuList}
              matrix={block.qtyPriceMatrix}
              onChange={(color, size, field, value) =>
                handleMatrixChange(block.styleId, color, size, field, value)
              }
              readOnly={pageMode === 'view'}
              mode={matrixMode}
            />
          </div>
        </div>
      ))}

      {styleBlocks.length > 0 && (
        <div className="flex items-center justify-end gap-6 pt-2 text-sm">
          <div className="text-gray-600">
            总数量：
            <span className="font-medium text-gray-800 ml-1">
              {totals.totalQty}
            </span>
          </div>
          <div className="text-gray-600">
            总金额：
            <span className="font-medium text-primary ml-1 text-base">
              ¥ {totals.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  const acceptActions =
    pageMode === 'accept' ? (
      <>
        <Button size="sm" variant="outline" onClick={() => void handleSaveAcceptance()} disabled={saving}>
          保存验收进度
        </Button>
        <Button size="sm" onClick={() => void handleCompleteAcceptance()} disabled={saving}>
          完成验收
        </Button>
      </>
    ) : null;

  return (
    <DocPage
      title="采购入库"
      docNo={inboundNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={showSave ? handleSave : undefined}
      saving={saving}
      extraActions={acceptActions}
      header={loading || isLoading ? <div className="text-center py-8 text-gray-400">加载中...</div> : headerForm}
    >
      {loading || isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        detailContent
      )}
    </DocPage>
  );
};

export default GarmentPurchaseInboundEditPage;
