import { useState } from 'react';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { useOffline } from '@client/src/contexts/OfflineContext';
import * as masterDataApi from '@client/src/api/master-data';
import * as inventoryApi from '@client/src/api/inventory';
import type { Style } from '@shared/api.interface';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { STORE_ID, STORE_NAME } from '@client/src/lib/store';

interface CreateReqDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateReqDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateReqDialogProps) {
  const [styleSearch, setStyleSearch] = useState('');
  const [styleResults, setStyleResults] = useState<Style[]>([]);
  const [styleId, setStyleId] = useState('');
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const offline = useOffline();
  const isOffline = offline.effectivelyOffline;

  const handleSearch = async (keyword: string) => {
    setStyleSearch(keyword);
    if (!keyword.trim()) {
      setStyleResults([]);
      return;
    }
    try {
      const res = await masterDataApi.getStyles({
        keyword,
        page: 1,
        pageSize: 10,
      });
      setStyleResults(res.items ?? []);
    } catch (error) {
      logger.error('search styles for req failed', error as Error);
    }
  };

  const handleSelectStyle = (s: Style) => {
    setStyleId(s.id);
    setStyleSearch(`${s.id} · ${s.name}`);
    setStyleResults([]);
  };

  const handleSubmit = async () => {
    if (!styleId || qty <= 0) return;
    setSubmitting(true);
    try {
      const reqData = {
        storeId: STORE_ID,
        items: [
          {
            styleId,
            colorId: 'ALL',
            sizeId: 'ALL',
            skuId: `${styleId}-ALL-ALL`,
            reqQty: qty,
          },
        ],
      };
      if (isOffline) {
        const clientId = await offline.createOfflineTransferRequest(reqData);
        toast.success('离线暂存 · 联网后自动上传', {
          description: `要货申请（临时号 ${clientId.slice(-8)}）`,
        });
        onOpenChange(false);
        setStyleId('');
        setStyleSearch('');
        setQty(1);
        onCreated();
        return;
      }
      await inventoryApi.createTransferRequest(reqData);
      onOpenChange(false);
      setStyleId('');
      setStyleSearch('');
      setQty(1);
      onCreated();
    } catch (error) {
      logger.error('create transfer request failed', error as Error);
      toast.error('要货申请提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    onOpenChange(false);
    setStyleId('');
    setStyleSearch('');
    setStyleResults([]);
    setQty(1);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建要货申请</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm text-pos-ink-3 mb-1 block">
              选择款式
            </label>
            <div className="relative">
              <input
                type="text"
                value={styleSearch}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="输入款号/品名搜索"
                className="w-full h-10 px-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent"
              />
              {styleResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-pos-line rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                  {styleResults.map((s) => (
                    <div
                      key={s.id}
                      onMouseDown={() => handleSelectStyle(s)}
                      className="px-3 py-2 text-sm hover:bg-pos-paper cursor-pointer border-b border-pos-line-soft last:border-0"
                    >
                      {s.id} · {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {styleId && (
            <div>
              <label className="text-sm text-pos-ink-3 mb-1 block">
                申请数量
              </label>
              <div className="flex items-center gap-3 py-1">
                <button
                  onClick={() => setQty((p) => Math.max(1, p - 1))}
                  className="w-8 h-8 flex items-center justify-center border border-pos-line rounded-md text-pos-ink-3 hover:text-pos-ink"
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1) setQty(v);
                  }}
                  className="w-20 h-8 text-center text-sm border border-pos-line rounded-md"
                />
                <button
                  onClick={() => setQty((p) => p + 1)}
                  className="w-8 h-8 flex items-center justify-center border border-pos-line rounded-md text-pos-ink-3 hover:text-pos-ink"
                >
                  <Plus size={14} />
                </button>
                <span className="text-sm text-pos-ink-3">件</span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!styleId || submitting}>
            {submitting ? '提交中...' : '提交申请'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CreateStocktakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateStocktakeDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateStocktakeDialogProps) {
  const [type, setType] = useState('full');
  const [submitting, setSubmitting] = useState(false);
  const offline = useOffline();
  const isOffline = offline.effectivelyOffline;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const stkData = {
        storeId: STORE_ID,
        type,
        items: [],
      };
      if (isOffline) {
        const clientId = await offline.createOfflineStocktake(stkData);
        toast.success('离线暂存 · 联网后自动上传', {
          description: `盘点单（临时号 ${clientId.slice(-8)}）`,
        });
        onOpenChange(false);
        setType('full');
        onCreated();
        return;
      }
      await inventoryApi.createStocktake(stkData);
      onOpenChange(false);
      setType('full');
      onCreated();
    } catch (error) {
      logger.error('create stocktake failed', error as Error);
      toast.error('创建盘点单失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    onOpenChange(false);
    setType('full');
  };

  const options = [
    { value: 'full', label: '全盘', desc: '对门店所有商品进行全面盘点' },
    { value: 'partial', label: '抽盘', desc: '按品类或区域抽样盘点' },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新建盘点</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm text-pos-ink-3 mb-2 block">
              盘点类型
            </label>
            <div className="space-y-2">
              {options.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    type === opt.value
                      ? 'border-pos-accent bg-pos-accent/5'
                      : 'border-pos-line hover:bg-pos-paper/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="stocktakeType"
                    value={opt.value}
                    checked={type === opt.value}
                    onChange={() => setType(opt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-pos-ink">
                      {opt.label}
                    </div>
                    <div className="text-xs text-pos-ink-3 mt-0.5">
                      {opt.desc}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '创建中...' : '创建盘点单'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TransferLine {
  styleId: string;
  styleName: string;
  qty: number;
}

interface CreateTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateTransferDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateTransferDialogProps) {
  const [toLocation, setToLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [styleSearch, setStyleSearch] = useState('');
  const [styleResults, setStyleResults] = useState<Style[]>([]);
  const [curQty, setCurQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const offline = useOffline();
  const isOffline = offline.effectivelyOffline;

  const handleSearch = async (keyword: string) => {
    setStyleSearch(keyword);
    if (!keyword.trim()) {
      setStyleResults([]);
      return;
    }
    try {
      const res = await masterDataApi.getStyles({ keyword, page: 1, pageSize: 10 });
      setStyleResults(res.items ?? []);
    } catch (error) {
      logger.error('search styles for transfer failed', error as Error);
    }
  };

  const handleSelectStyle = (s: Style) => {
    setLines((prev) => [
      ...prev,
      { styleId: s.id, styleName: s.name, qty: curQty },
    ]);
    setStyleSearch('');
    setStyleResults([]);
  };

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setToLocation('');
    setRemark('');
    setLines([]);
    setStyleSearch('');
    setStyleResults([]);
    setCurQty(1);
  };

  const handleClose = () => {
    if (submitting) return;
    onOpenChange(false);
    reset();
  };

  const handleSubmit = async () => {
    if (!toLocation.trim() || lines.length === 0) return;
    if (isOffline) {
      toast.error('离线状态下无法创建调拨出库单');
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        storeId: STORE_ID,
        fromLocation: STORE_NAME,
        toLocation: toLocation.trim(),
        remark: remark.trim() || undefined,
        items: lines.map((l) => ({
          skuId: `${l.styleId}-ALL-ALL`,
          styleId: l.styleId,
          colorId: 'ALL',
          sizeId: 'ALL',
          plannedQty: l.qty,
        })),
      };
      await inventoryApi.createTransfer(data);
      toast.success('调拨出库单已创建', {
        description: `调出至 ${toLocation.trim()}`,
      });
      onOpenChange(false);
      reset();
      onCreated();
    } catch (error) {
      logger.error('create transfer failed', error as Error);
      toast.error('创建调拨出库单失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建调拨出库单</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm text-pos-ink-3 mb-1 block">调出至（目标门店/仓库）</label>
            <input
              type="text"
              value={toLocation}
              onChange={(e) => setToLocation(e.target.value)}
              placeholder="如：杭州湖滨银泰总仓 / 文二西路店"
              className="w-full h-10 px-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent"
            />
          </div>

          <div>
            <label className="text-sm text-pos-ink-3 mb-1 block">调出商品</label>
            <div className="relative">
              <input
                type="text"
                value={styleSearch}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="输入款号/品名搜索并添加到明细"
                className="w-full h-10 px-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent"
              />
              {styleResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-pos-line rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                  {styleResults.map((s) => (
                    <div
                      key={s.id}
                      onMouseDown={() => handleSelectStyle(s)}
                      className="px-3 py-2 text-sm hover:bg-pos-paper cursor-pointer border-b border-pos-line-soft last:border-0"
                    >
                      {s.id} · {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-3">
              <span className="text-sm text-pos-ink-3">本次添加数量</span>
              <button
                onClick={() => setCurQty((p) => Math.max(1, p - 1))}
                className="w-8 h-8 flex items-center justify-center border border-pos-line rounded-md text-pos-ink-3 hover:text-pos-ink"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                value={curQty}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1) setCurQty(v);
                }}
                className="w-20 h-8 text-center text-sm border border-pos-line rounded-md"
              />
              <button
                onClick={() => setCurQty((p) => p + 1)}
                className="w-8 h-8 flex items-center justify-center border border-pos-line rounded-md text-pos-ink-3 hover:text-pos-ink"
              >
                <Plus size={14} />
              </button>
              <span className="text-sm text-pos-ink-3">件</span>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="border border-pos-line rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-pos-paper">
                  <tr>
                    <th className="text-left font-semibold text-pos-ink px-3 py-2">款式</th>
                    <th className="text-right font-semibold text-pos-ink px-3 py-2">数量</th>
                    <th className="text-center font-semibold text-pos-ink px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={l.styleId + idx} className="border-t border-pos-line-soft">
                      <td className="px-3 py-2 text-pos-ink">{l.styleId} · {l.styleName}</td>
                      <td className="px-3 py-2 text-right text-pos-ink tabular-nums">{l.qty}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => removeLine(idx)}
                          className="text-pos-ink-3 hover:text-pos-danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="text-sm text-pos-ink-3 mb-1 block">备注（可选）</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="如：换季调配"
              className="w-full h-10 px-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!toLocation.trim() || lines.length === 0 || submitting}
          >
            {submitting ? '提交中...' : '创建调拨出库单'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
