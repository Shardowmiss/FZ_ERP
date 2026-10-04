import { useState, useRef } from 'react';
import { Search, User, Tag, WifiOff } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import * as masterData from '@client/src/api/master-data';
import * as stockApi from '@client/src/api/stock';
import type { Style, StockMatrix, Member, Employee } from '@shared/api.interface';
import type { SkuLite } from '@client/src/lib/offline/master-data-cache';

import { STORE_ID } from '@client/src/lib/store';

const LEVEL_COLORS: Record<string, string> = {
  normal: 'bg-gray-400',
  silver: 'bg-primary',
  gold: 'bg-yellow-500',
  black: 'bg-orange-600',
};

const LEVEL_NAMES: Record<string, string> = {
  normal: '普通',
  silver: '银卡',
  gold: '金卡',
  black: '黑卡',
};

interface PosSidebarProps {
  hotStyles?: Style[];
  member: Member | null;
  employee: Employee | null;
  isOffline?: boolean;
  localStyleCount?: number;
  onOpenMember: () => void;
  onClearMember: () => void;
  onOpenEmployee: () => void;
  onClearEmployee: () => void;
  onSelectStyle: (style: Style, matrix: StockMatrix) => void;
  onSearchLocal?: (keyword: string) => Style[];
  /** 扫码命中 SKU 时直接加购（1 件），避免"扫完还要再点格子" */
  onScanAdd?: (sku: SkuLite) => void;
}

export default function PosSidebar({
  hotStyles = [],
  member,
  employee,
  isOffline = false,
  localStyleCount = 0,
  onOpenMember,
  onClearMember,
  onOpenEmployee,
  onClearEmployee,
  onSelectStyle,
  onSearchLocal,
  onScanAdd,
}: PosSidebarProps) {
  const [scanValue, setScanValue] = useState('');
  const [searchResults, setSearchResults] = useState<Style[]>([]);
  const [searching, setSearching] = useState(false);
  // 扫码枪特征识别：连续快速输入 + 回车；记录上次按键时间，间隔 < 50ms 视为设备输入
  const lastKeyTimeRef = useRef<number>(0);
  const typingRef = useRef<{ fast: boolean }>({ fast: false });

  const isLikelyScanner = (): boolean => {
    const now = Date.now();
    const fast = now - lastKeyTimeRef.current < 50;
    lastKeyTimeRef.current = now;
    typingRef.current.fast = fast;
    return fast;
  };

  const handleSearch = async () => {
    if (!scanValue.trim()) return;
    const kw = scanValue.trim();

    // 离线模式：从本地缓存搜索
    if (isOffline && onSearchLocal) {
      const results = onSearchLocal(kw);
      setSearchResults(results);
      return;
    }

    // 条码：优先按条码/SKU 精确匹配，命中后直接加购（扫描枪场景）
    const looksLikeBarcode = /^[A-Za-z0-9-_]{6,}$/.test(kw);
    if (looksLikeBarcode) {
      try {
        const skus = await masterData.searchSkus(kw);
        if (skus.length > 0) {
          const sku = skus[0];
          // 若父组件支持扫码直接加购，则直接加购 1 件；否则退回"打开矩阵"的旧行为
          if (onScanAdd) {
            onScanAdd(sku);
            setScanValue('');
            setSearchResults([]);
            return;
          }
          const styles = await masterData.getStyles({ keyword: sku.styleId, page: 1, pageSize: 1 });
          const style = (styles.items ?? []).find((s) => s.id === sku.styleId);
          if (style) {
            const matrix = await stockApi.getStockMatrix(style.id, STORE_ID);
            onSelectStyle(style, matrix);
          }
          setScanValue('');
          setSearchResults([]);
          return;
        }
      } catch (err) {
        logger.error('search sku by barcode failed', err as Error);
      }
    }

    setSearching(true);
    try {
      const res = await masterData.getStyles({ keyword: kw, page: 1, pageSize: 20 });
      setSearchResults(res.items ?? []);
    } catch (err) {
      logger.error('search styles failed', err as Error);
    } finally {
      setSearching(false);
    }
  };

  const handleStyleClick = async (style: Style) => {
    // 离线模式：直接通知父组件，由父组件从本地缓存计算库存矩阵
    if (isOffline) {
      onSelectStyle(style, {} as StockMatrix);
      return;
    }
    try {
      const matrix = await stockApi.getStockMatrix(style.id, STORE_ID);
      onSelectStyle(style, matrix);
    } catch (err) {
      logger.error('get stock matrix failed', err as Error);
    }
  };

  return (
    <div className="w-[280px] border-r border-pos-line bg-white flex flex-col flex-shrink-0">
      {/* 搜索 */}
      <div className="p-3 border-b border-pos-line">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
          <input
            type="text"
            value={scanValue}
            onChange={(e) => {
              isLikelyScanner();
              setScanValue(e.target.value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={isOffline ? '搜索本地缓存商品' : '扫码/款号/品名/拼音码'}
            className="w-full h-9 pl-9 pr-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20"
          />
        </div>
        {searching && <div className="text-xs text-pos-ink-3 mt-2">搜索中...</div>}
        {isOffline && searchResults.length === 0 && !searching && scanValue.trim() && (
          <div className="text-xs text-pos-ink-3 mt-2">本地缓存未找到匹配商品</div>
        )}
        {searchResults.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto border border-pos-line-soft rounded-md">
            {searchResults.map((style) => (
              <div
                key={style.id}
                onClick={() => handleStyleClick(style)}
                 className="px-2 py-1.5 text-xs hover:bg-pos-accent-light/50 cursor-pointer border-b border-pos-line-soft last:border-0"
              >
                <div className="text-pos-ink font-medium truncate">{style.id} · {style.name}</div>
                <div className="text-pos-ink-3 mt-0.5 tabular-nums">¥{style.tagPrice}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 会员 */}
      <div className="p-3 border-b border-pos-line">
        {member ? (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`w-5 h-5 rounded-full ${LEVEL_COLORS[member.level] || 'bg-gray-400'} flex items-center justify-center text-white text-[10px] font-medium`}>
                {(LEVEL_NAMES[member.level] || '普通').charAt(0)}
              </div>
              <span className="text-sm font-medium text-pos-ink truncate flex-1">
                {member.name || member.phone}
              </span>
              <button onClick={onClearMember} className="text-xs text-pos-ink-3 hover:text-pos-danger">
                清除
              </button>
            </div>
            <div className="flex gap-3 text-[11px] text-pos-ink-3">
              <span>积分 <span className="text-pos-ink tabular-nums">{member.points}</span></span>
              <span>储值 <span className="text-pos-ink tabular-nums">¥{Number(member.storedValue).toFixed(0)}</span></span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <User size={14} className="text-pos-ink-3" />
            <span className="text-pos-ink-3">散客</span>
            <button onClick={onOpenMember} className="ml-auto text-xs text-pos-accent hover:underline">
              识别会员
            </button>
          </div>
        )}
      </div>

      {/* 导购 */}
      <div className="p-3 border-b border-pos-line">
        {employee ? (
          <div className="flex items-center gap-2 text-sm">
            <Tag size={14} className="text-pos-ink-3" />
            <span className="text-pos-ink font-medium">导购：{employee.name}</span>
            <button onClick={onClearEmployee} className="ml-auto text-xs text-pos-ink-3 hover:text-pos-danger">
              清除
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <Tag size={14} className="text-pos-ink-3" />
            <span className="text-pos-ink-3">导购：未指派</span>
            <button onClick={onOpenEmployee} className="ml-auto text-xs text-pos-accent hover:underline">
              选择
            </button>
          </div>
        )}
      </div>

      {/* 热销 */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2 text-xs text-pos-ink-3 bg-pos-paper/50 border-b border-pos-line flex items-center justify-between">
          <span>{isOffline ? '本地缓存商品' : '热销款推荐'}</span>
          {isOffline && (
            <span className="flex items-center gap-1 text-pos-warn">
              <WifiOff size={10} />
              {localStyleCount}款
            </span>
          )}
        </div>
        {hotStyles.map((style) => (
          <div
            key={style.id}
            onClick={() => handleStyleClick(style)}
             className="px-3 py-2.5 border-b border-pos-line-soft text-sm text-pos-ink hover:bg-pos-accent-light/50 cursor-pointer transition-colors"
          >
            <div className="font-medium truncate">{style.id} · {style.name}</div>
            <div className="text-xs text-pos-ink-3 mt-0.5 tabular-nums">¥{style.tagPrice} · {style.colorIds.length}色</div>
          </div>
        ))}
      </div>
    </div>
  );
}
