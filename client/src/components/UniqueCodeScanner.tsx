import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import { Alert, AlertDescription } from '@client/src/components/ui/alert';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { SCAN_REJECT_TEXT, uniqueCodeApi } from '@client/src/api/uniqueCode';

/**
 * 扫码录入组件（唯一码引擎前端入口）
 *
 * 用法：单据录入页挂载本组件，每扫一个吊牌码即调用后端解析 + 校验，
 * 通过则回调 onAccepted 追加到明细，被拒则就地高亮提示拒绝原因（防串货拦截）。
 *
 * 支持三种模式：
 *  - parse     仅解析识别款色码（不校验库存），用于纯录入提速
 *  - outbound  出库/零售扫码校验（六拒绝：未入库/非本仓/非在库/款色码不符/重复扫/校验位错）
 *  - inbound   入库登记
 */
export interface ScannedItem {
  uniqueCode?: string;
  styleNo: string;
  color: string;
  size: string;
  skuId?: string;
}

export interface UniqueCodeScannerProps {
  /** scan 模式 */
  mode: 'parse' | 'outbound' | 'inbound';
  /** 单据类型（retail / sales_outbound / purchase_inbound / transfer ...） */
  docType: string;
  /** 单据号 */
  docId: string;
  /** 本单仓库（outbound 模式必填，用于串货校验） */
  warehouseId?: string;
  /** 扫码通过回调 */
  onAccepted?: (item: ScannedItem) => void;
  /** 占位提示 */
  placeholder?: string;
  /** 已扫过的码（用于本地去重提示） */
  scannedCodes?: string[];
}

const STATUS_LABEL: Record<string, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  in_stock: { text: '在库', variant: 'default' },
  out: { text: '已出库', variant: 'secondary' },
  sold: { text: '已售', variant: 'outline' },
  returned: { text: '已退回', variant: 'secondary' },
};

const UniqueCodeScanner: React.FC<UniqueCodeScannerProps> = ({
  mode,
  docType,
  docId,
  warehouseId,
  onAccepted,
  placeholder = '扫描或输入吊牌码（款号|颜色|尺码|唯一码）',
  scannedCodes = [],
}) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<ScannedItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 本地去重：同一单据内不允许重复扫同一个唯一码 */
  const isDupLocally = useCallback(
    (code?: string) => !!code && scannedCodes.includes(code),
    [scannedCodes],
  );

  const handleScan = useCallback(async () => {
    const raw = value.trim();
    if (!raw) return;
    setBusy(true);
    setLastError(null);
    setLastOk(null);
    try {
      // 1) 先解析（含校验位防伪）
      const parsed = await uniqueCodeApi.parse({ raw, validateChecksum: true });
      if (!parsed.matched) {
        setLastError(parsed.message || '吊牌码无法识别');
        return;
      }
      const base: ScannedItem = {
        uniqueCode: parsed.uniqueCode,
        styleNo: parsed.styleNo,
        color: parsed.color,
        size: parsed.size,
        skuId: parsed.skuId,
      };

      // 2) 按模式做库存校验 / 登记
      if (mode === 'parse') {
        if (isDupLocally(base.uniqueCode)) {
          setLastError('该唯一码已在本单据扫描过，请勿重复');
          return;
        }
        setLastOk(base);
        onAccepted?.(base);
        setValue('');
        inputRef.current?.focus();
        return;
      }

      if (mode === 'outbound') {
        if (!warehouseId) {
          setLastError('缺少发货仓库，无法做出库校验');
          return;
        }
        if (isDupLocally(base.uniqueCode)) {
          setLastError('该唯一码已在本单据扫描过，请勿重复');
          return;
        }
        const res = await uniqueCodeApi.scanOutbound({
          docType,
          docId,
          warehouseId,
          styleNo: base.styleNo,
          color: base.color,
          size: base.size,
          uniqueCode: base.uniqueCode || '',
        });
        if (!res.ok) {
          setLastError(SCAN_REJECT_TEXT[res.reason || ''] || res.message);
          return;
        }
        setLastOk(base);
        onAccepted?.(base);
        setValue('');
        inputRef.current?.focus();
        return;
      }

      // inbound
      await uniqueCodeApi.registerInbound({
        docType,
        docId,
        warehouseId: warehouseId || '',
        items: [
          {
            styleNo: base.styleNo,
            color: base.color,
            size: base.size,
            uniqueCode: base.uniqueCode,
            skuId: base.skuId,
          },
        ],
      });
      setLastOk(base);
      onAccepted?.(base);
      setValue('');
      inputRef.current?.focus();
    } catch (e: any) {
      logger.error('扫码失败', e);
      const msg = e?.response?.data?.message || e?.message || '扫码失败';
      setLastError(Array.isArray(msg) ? msg.join('；') : String(msg));
      toast.error('扫码失败');
    } finally {
      setBusy(false);
    }
  }, [value, mode, docType, docId, warehouseId, onAccepted, isDupLocally]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 扫码枪通常以回车结束
            if (e.key === 'Enter') {
              e.preventDefault();
              handleScan();
            }
          }}
          autoFocus
        />
        <Button type="button" onClick={handleScan} disabled={busy || !value.trim()}>
          {busy ? '校验中…' : '录入'}
        </Button>
      </div>

      {lastError && (
        <Alert variant="destructive">
          <AlertDescription>{lastError}</AlertDescription>
        </Alert>
      )}

      {lastOk && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="default">校验通过</Badge>
          <span>
            {lastOk.styleNo} / {lastOk.color} / {lastOk.size}
          </span>
          {lastOk.uniqueCode && <Badge variant="outline">{lastOk.uniqueCode}</Badge>}
        </div>
      )}

      {scannedCodes.length > 0 && (
        <div className="text-xs text-muted-foreground">本单已扫 {scannedCodes.length} 个唯一码</div>
      )}
    </div>
  );
};

export default UniqueCodeScanner;
export { STATUS_LABEL };
